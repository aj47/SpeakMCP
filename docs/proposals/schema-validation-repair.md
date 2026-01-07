# JSON Schema Validation & Self-Repair Loop Proposal

## Executive Summary

This document proposes a robust JSON validation and self-repair system for SpeakMCP's LLM tool call handling. The goal is to achieve **99%+ JSON schema adherence** even with models like Claude Haiku that occasionally produce malformed JSON or wrap responses in XML.

## Current State Analysis

### Existing Infrastructure

**1. Zod is Already Installed** (`zod: ^3.25.76`)

The codebase already uses Zod for validation in `structured-output.ts`:

```typescript
const LLMToolCallSchema = z.object({
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.record(z.any()),
  })).optional(),
  content: z.string().optional(),
  needsMoreWork: z.boolean().optional(),
})
```

**2. Existing Retry Logic** (`llm-fetch.ts`)

The codebase has robust HTTP retry infrastructure:
- `apiCallWithRetry()` - Exponential backoff with jitter
- Configurable via `apiRetryCount` (default: 3), `apiRetryBaseDelay` (1s), `apiRetryMaxDelay` (30s)
- Rate limit (429) retries indefinitely
- Retry progress callback for UI updates

**3. Existing JSON Extraction** (`llm-fetch.ts:249-287`)

- `normalizeXmlToolCalls()` - Handles `<function_calls>` XML wrappers
- `extractJsonObject()` - Brace-counting extraction with envelope preference
- `isToolCallEnvelope()` - Validates expected structure

**4. Existing Fallback Chain** (`llm-fetch.ts:936-1066`)

```
JSON Schema Mode → JSON Object Mode → Plain Text Mode
```

### Current Gaps

1. **No schema validation after extraction** - JSON is parsed but not validated against Zod schema
2. **No LLM self-repair loop** - When extraction fails, we fallback to plain text instead of asking LLM to fix
3. **Limited error feedback** - Failed generation content is captured but not used to guide repair
4. **No structured repair prompts** - No targeted error messages to help LLM understand what went wrong

## Recommended Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       LLM Response                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. XML Normalization (normalizeXmlToolCalls)                   │
│     - Handle <function_calls> wrappers                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. JSON Extraction (extractJsonObject)                         │
│     - Brace-counting extraction                                 │
│     - Prefer envelope objects                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Schema Validation (Zod)                                     │
│     - Validate against LLMToolCallSchema                        │
│     - Collect detailed error messages                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              ┌──────────┐        ┌──────────────┐
              │ Valid ✓  │        │ Invalid ✗    │
              └──────────┘        └──────────────┘
                    │                   │
                    ▼                   ▼
              ┌──────────┐        ┌──────────────┐
              │ Return   │        │ Repair Loop  │
              │ Response │        │ (max 2 tries)│
              └──────────┘        └──────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │ Build repair     │
                              │ prompt with:     │
                              │ - Original resp  │
                              │ - Zod errors     │
                              │ - Example format │
                              └──────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │ LLM Repair Call  │
                              │ (temperature=0)  │
                              └──────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │ Re-validate      │
                              │ (loop back)      │
                              └──────────────────┘
```

### Implementation: New Validation Module

Create `apps/desktop/src/main/schema-validation.ts`:

```typescript
import { z, ZodError } from "zod"
import { isDebugLLM, logLLM } from "./debug"
import { diagnosticsService } from "./diagnostics"

// Re-export the schema for consistency
export const LLMToolCallSchema = z.object({
  toolCalls: z.array(z.object({
    name: z.string().min(1, "Tool name cannot be empty"),
    arguments: z.record(z.any()),
  })).optional(),
  content: z.string().optional(),
  needsMoreWork: z.boolean().optional(),
})

export type LLMToolCallResponse = z.infer<typeof LLMToolCallSchema>

export interface ValidationResult {
  success: boolean
  data?: LLMToolCallResponse
  errors?: string[]
  rawInput?: unknown
}

/**
 * Validate parsed JSON against the tool call schema
 */
export function validateToolCallResponse(parsed: unknown): ValidationResult {
  const result = LLMToolCallSchema.safeParse(parsed)

  if (result.success) {
    return { success: true, data: result.data }
  }

  const errors = formatZodErrors(result.error)

  if (isDebugLLM()) {
    logLLM("Schema validation failed:", { errors, rawInput: parsed })
  }

  return { success: false, errors, rawInput: parsed }
}

/**
 * Format Zod errors into LLM-friendly repair instructions
 */
function formatZodErrors(error: ZodError): string[] {
  return error.errors.map(err => {
    const path = err.path.join(".")
    switch (err.code) {
      case "invalid_type":
        return `Field "${path}": Expected ${err.expected}, got ${err.received}`
      case "unrecognized_keys":
        return `Object has unrecognized keys: ${(err as any).keys?.join(", ")}`
      case "too_small":
        return `Field "${path}": Value is too small (min: ${(err as any).minimum})`
      default:
        return `Field "${path}": ${err.message}`
    }
  })
}

/**
 * Build a repair prompt that helps the LLM fix its response
 */
export function buildRepairPrompt(
  originalResponse: string,
  validationErrors: string[],
  attemptNumber: number
): string {
  return `Your previous response had JSON formatting errors. Please fix and return ONLY valid JSON.

## Errors Found
${validationErrors.map(e => `- ${e}`).join("\n")}

## Your Original Response
\`\`\`
${originalResponse.substring(0, 2000)}${originalResponse.length > 2000 ? "..." : ""}
\`\`\`

## Required Format
Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "toolCalls": [{"name": "tool_name", "arguments": {...}}],  // optional
  "content": "Your response text here",  // optional
  "needsMoreWork": false  // optional boolean
}

## Rules
1. All property names must be in double quotes
2. String values must use double quotes (escape inner quotes as \\")
3. No trailing commas
4. No comments in JSON
5. Return ONLY the JSON object, nothing else

Attempt ${attemptNumber}/2 - Please provide corrected JSON:`
}
```

### Integration with llm-fetch.ts

Modify `makeLLMCallAttempt()` to include validation and repair:

```typescript
// In llm-fetch.ts, after extractJsonObject()

import { validateToolCallResponse, buildRepairPrompt } from "./schema-validation"

async function makeLLMCallAttempt(
  messages: Array<{ role: string; content: string }>,
  chatProviderId: string,
  onRetryProgress?: RetryProgressCallback,
  sessionId?: string,
  repairAttempt: number = 0,  // NEW: Track repair attempts
  originalContent?: string,   // NEW: Original response for repair context
): Promise<LLMToolCallResponse> {
  // ... existing code to get response ...

  const jsonObject = extractJsonObject(content)

  if (jsonObject) {
    // NEW: Validate against Zod schema
    const validation = validateToolCallResponse(jsonObject)

    if (validation.success) {
      return validation.data!
    }

    // Validation failed - attempt self-repair if under limit
    const MAX_REPAIR_ATTEMPTS = 2
    if (repairAttempt < MAX_REPAIR_ATTEMPTS && validation.errors) {
      if (isDebugLLM()) {
        logLLM(`Schema validation failed, attempting repair (${repairAttempt + 1}/${MAX_REPAIR_ATTEMPTS})`)
      }

      const repairPrompt = buildRepairPrompt(
        content,
        validation.errors,
        repairAttempt + 1
      )

      const repairMessages = [
        ...messages,
        { role: "assistant", content: content },
        { role: "user", content: repairPrompt }
      ]

      // Recursive call with incremented repair attempt
      return makeLLMCallAttempt(
        repairMessages,
        chatProviderId,
        onRetryProgress,
        sessionId,
        repairAttempt + 1,
        content
      )
    }

    // Max repairs reached - log and return best effort
    diagnosticsService.logWarning(
      "llm-fetch",
      "Schema validation failed after max repair attempts",
      { errors: validation.errors, rawInput: validation.rawInput }
    )

    // Return partially valid response or fallback
    if (jsonObject.content || jsonObject.toolCalls) {
      return jsonObject as LLMToolCallResponse
    }
  }

  // ... existing fallback logic ...
}
```

### Error Message Templates

Create targeted error messages for common Claude Haiku issues:

```typescript
// Common error patterns and repair hints
export const REPAIR_HINTS: Record<string, string> = {
  // XML wrapper issue
  "function_calls":
    "Remove the <function_calls> XML wrapper. Return pure JSON only.",

  // Markdown code block issue
  "```json":
    "Remove markdown code block markers. Return pure JSON only.",

  // Missing quotes
  "Unexpected token":
    "Property names and string values must be in double quotes.",

  // Trailing comma
  "trailing comma":
    "Remove trailing commas before closing braces/brackets.",

  // Single quotes
  "single quote":
    "Use double quotes for strings, not single quotes.",

  // Unescaped newlines
  "newline":
    "Escape newlines in strings as \\n",
}

export function enhanceErrorMessages(errors: string[], rawResponse: string): string[] {
  const enhanced = [...errors]

  for (const [pattern, hint] of Object.entries(REPAIR_HINTS)) {
    if (rawResponse.toLowerCase().includes(pattern.toLowerCase())) {
      enhanced.push(`HINT: ${hint}`)
    }
  }

  return enhanced
}
```

## Configuration Options

Add new config options to `config.ts`:

```typescript
// Schema validation and repair settings
schemaRepairMaxAttempts: 2,      // Max LLM repair attempts
schemaRepairEnabled: true,       // Enable/disable repair loop
schemaValidationStrict: false,   // Strict mode rejects partial matches
```

## Integration Points

### 1. Existing Retry Logic

The repair loop integrates with existing retry infrastructure:
- HTTP retries (`apiCallWithRetry`) handle network/rate limit issues
- Schema repair loop handles response format issues
- These are orthogonal and can both be active

### 2. Existing Fallback Chain

The repair loop fits into the existing fallback chain:
```
JSON Schema Mode → [Schema Validation + Repair] → JSON Object Mode → Plain Text
```

### 3. Progress Reporting

Extend `RetryProgressCallback` to include repair status:
```typescript
export type RetryProgressCallback = (info: {
  isRetrying: boolean
  attempt: number
  maxAttempts?: number
  delaySeconds: number
  reason: string
  startedAt: number
  isSchemaRepair?: boolean  // NEW: Flag for schema repair vs HTTP retry
}) => void
```

## Testing Strategy

### Unit Tests

```typescript
describe("Schema Validation", () => {
  it("accepts valid tool call response", () => {
    const valid = { toolCalls: [{ name: "test", arguments: {} }] }
    expect(validateToolCallResponse(valid).success).toBe(true)
  })

  it("rejects invalid structure", () => {
    const invalid = { toolCalls: [{ name: 123 }] }  // name should be string
    const result = validateToolCallResponse(invalid)
    expect(result.success).toBe(false)
    expect(result.errors).toContain('Field "toolCalls.0.name": Expected string, got number')
  })

  it("provides LLM-friendly error messages", () => {
    const invalid = { content: 123 }  // should be string
    const result = validateToolCallResponse(invalid)
    expect(result.errors?.[0]).toMatch(/Expected string/)
  })
})

describe("Repair Prompt", () => {
  it("includes original response and errors", () => {
    const prompt = buildRepairPrompt('{"bad": json}', ["Unexpected token"], 1)
    expect(prompt).toContain("Unexpected token")
    expect(prompt).toContain('{"bad": json}')
  })
})
```

### Integration Tests

```typescript
describe("LLM Repair Loop", () => {
  it("repairs malformed JSON on first attempt", async () => {
    // Mock LLM to return XML-wrapped response first, then valid JSON
    const response = await makeLLMCallWithFetch(messages, "openai")
    expect(response.toolCalls).toBeDefined()
  })

  it("gives up after max repair attempts", async () => {
    // Mock LLM to always return invalid JSON
    // Should fallback to plain text after 2 repair attempts
  })
})
```

## Expected Outcomes

| Metric | Current | Target |
|--------|---------|--------|
| JSON parse success rate | ~85% | 95%+ |
| Schema validation rate | ~80% | 99%+ |
| Average repair attempts | N/A | <1.2 |
| Fallback to plain text | ~15% | <1% |

## Migration Path

1. **Phase 1**: Add `schema-validation.ts` module (non-breaking)
2. **Phase 2**: Integrate validation into `extractJsonObject` return path
3. **Phase 3**: Add repair loop with feature flag (`schemaRepairEnabled`)
4. **Phase 4**: Enable by default after testing
5. **Phase 5**: Add config UI for tuning repair parameters

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Repair loop adds latency | Max 2 attempts, fast validation |
| Repair prompts consume tokens | Truncate original response to 2000 chars |
| Infinite loops | Hard limit on repair attempts |
| Repair makes response worse | Validate each repair attempt |

## Conclusion

This proposal leverages existing Zod infrastructure and retry patterns to add a robust schema validation and self-repair layer. The key innovations are:

1. **Zod-based validation** with LLM-friendly error messages
2. **Self-repair loop** that teaches the LLM to fix its own mistakes
3. **Targeted repair prompts** with common error hints
4. **Graceful degradation** when repair fails

Implementation effort is estimated at 2-3 days, with most code being new additions rather than modifications to existing logic.

