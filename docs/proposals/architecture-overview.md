# Reliable Tool Calling Architecture for Multi-Provider LLM Support

## Executive Summary

This document proposes a layered architecture for reliable tool calling across all LLM providers (OpenAI, Groq, Gemini, OpenRouter/Claude/Llama). The goal is to achieve consistent, reliable tool execution regardless of model capabilities.

---

## Current State Analysis

### Provider Landscape

| Provider    | Native Tools | JSON Schema | JSON Object | Text Only |
|-------------|:------------:|:-----------:|:-----------:|:---------:|
| OpenAI      | ✅           | ✅          | ✅          | ✅        |
| Groq        | ❌           | ✅          | ✅          | ✅        |
| Gemini      | ✅           | ❌          | ❌          | ✅        |
| OpenRouter  | varies       | varies      | varies      | ✅        |
| Claude (OR) | ✅           | ❌          | ❌          | ✅        |
| Llama (OR)  | ❌           | ❌          | ❌          | ✅        |

### Current Implementation Issues

1. **Tightly coupled provider logic** in `llm-fetch.ts` with fallback chains mixed into API calls
2. **XML detection is reactive** - normalizes XML *after* receiving response rather than preventing it
3. **No native tool calling support** - OpenAI SDK's `tools` parameter is unused
4. **Runtime capability discovery** is limited - only caches JSON schema/object support
5. **Verification loop** is expensive - calls LLM twice when once might suffice

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AGENT LOOP (llm.ts)                            │
│   Orchestrates conversation flow, tool execution, progress reporting        │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LAYER 4: FALLBACK STRATEGIES                         │
│   • Retry with different output mode                                        │
│   • Escalate to more capable model                                          │
│   • Degrade gracefully to text-only                                         │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 3: VALIDATION + REPAIR LOOP                        │
│   • JSON schema validation (Zod)                                            │
│   • XML → JSON normalization                                                │
│   • failed_generation recovery                                              │
│   • LLM self-correction retry (max 2 attempts)                              │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 2: RESPONSE NORMALIZATION                          │
│   • Native tool_calls → canonical JSON envelope                             │
│   • XML patterns → JSON extraction                                          │
│   • Markdown fences → JSON extraction                                       │
│   • Raw JSON → envelope wrapping                                            │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 1: PROVIDER ADAPTERS                               │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐│
│   │   OpenAI    │  │    Groq     │  │   Gemini    │  │     OpenRouter      ││
│   │  Adapter    │  │   Adapter   │  │   Adapter   │  │      Adapter        ││
│   ├─────────────┤  ├─────────────┤  ├─────────────┤  ├─────────────────────┤│
│   │native tools │  │json_schema  │  │generateCont │  │per-model detection  ││
│   │json_schema  │  │json_object  │  │ext+parse    │  │native/json/text     ││
│   │json_object  │  │text+parse   │  │             │  │                     ││
│   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Provider Adapters

### Purpose
Encapsulate provider-specific API differences and capability detection.

### Interface

```typescript
interface ProviderAdapter {
  readonly providerId: string;
  readonly capabilities: ModelCapabilities;
  
  // Execute a chat completion with best available method
  complete(request: ChatRequest): Promise<RawProviderResponse>;
  
  // Detect capabilities for a specific model
  detectCapabilities(modelId: string): Promise<ModelCapabilities>;
}

interface ModelCapabilities {
  supportsNativeTools: boolean;
  supportsJsonSchema: boolean;
  supportsJsonObject: boolean;
  maxContextTokens: number;
  emitsXmlToolCalls: boolean;  // Known to emit XML despite instructions
}

type ChatRequest = {
  messages: Message[];
  tools?: ToolDefinition[];
  responseFormat?: 'native_tools' | 'json_schema' | 'json_object' | 'text';
  schema?: JSONSchema;  // For json_schema mode
};
```

### Implementation Strategy

```typescript
// Provider registry
const adapters: Map<string, ProviderAdapter> = new Map([
  ['openai', new OpenAIAdapter()],
  ['groq', new GroqAdapter()],
  ['gemini', new GeminiAdapter()],
  ['openrouter', new OpenRouterAdapter()],
]);

// OpenRouter adapter with per-model detection
class OpenRouterAdapter implements ProviderAdapter {
  private modelCapabilityCache = new Map<string, ModelCapabilities>();
  
  async detectCapabilities(modelId: string): Promise<ModelCapabilities> {
    // Check cache first
    if (this.modelCapabilityCache.has(modelId)) {
      return this.modelCapabilityCache.get(modelId)!;
    }
    
    // Known model families
    const capabilities = this.getKnownCapabilities(modelId);
    this.modelCapabilityCache.set(modelId, capabilities);
    return capabilities;
  }
  
  private getKnownCapabilities(modelId: string): ModelCapabilities {
    // Claude models: native tools, no json_schema, may emit XML
    if (modelId.includes('claude')) {
      return {
        supportsNativeTools: true,
        supportsJsonSchema: false,
        supportsJsonObject: false,
        maxContextTokens: 200000,
        emitsXmlToolCalls: true,  // Claude often uses XML despite instructions
      };
    }
    // Llama models: text-only, no structured output
    if (modelId.includes('llama')) {
      return {
        supportsNativeTools: false,
        supportsJsonSchema: false,
        supportsJsonObject: false,
        maxContextTokens: 128000,
        emitsXmlToolCalls: false,
      };
    }
    // ... more model families
  }
}
```

---

## Layer 2: Response Normalization

### Purpose
Convert any raw provider response into our canonical `LLMToolCallResponse` envelope.

### Canonical Format

```typescript
interface LLMToolCallResponse {
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
  }>;
  content?: string;
  needsMoreWork?: boolean;
}
```

### Normalization Pipeline

```typescript
class ResponseNormalizer {
  normalize(raw: RawProviderResponse): LLMToolCallResponse {
    // Priority 1: Native tool_calls from OpenAI-compatible APIs
    if (raw.message?.tool_calls?.length) {
      return this.fromNativeToolCalls(raw.message.tool_calls, raw.message.content);
    }

    // Priority 2: Direct JSON envelope in content
    const content = raw.message?.content || '';
    const jsonEnvelope = this.extractJsonEnvelope(content);
    if (jsonEnvelope) {
      return jsonEnvelope;
    }

    // Priority 3: XML tool call patterns (Claude, some Llama)
    const xmlNormalized = this.normalizeXmlToolCalls(content);
    if (xmlNormalized) {
      return xmlNormalized;
    }

    // Priority 4: Plain text response
    return { content: content.trim(), needsMoreWork: undefined };
  }

  private normalizeXmlToolCalls(content: string): LLMToolCallResponse | null {
    // Handle multiple XML patterns Claude/other models emit
    const patterns = [
      /<function_calls>([\s\S]*?)<\/function_calls>/gi,
      /<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/gi,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return this.parseXmlToolCall(match[0]);
      }
    }
    return null;
  }
}
```

---

## Layer 3: Validation + Repair Loop

### Purpose
Ensure responses conform to our schema, with automatic repair for recoverable errors.

### Validation Pipeline

```typescript
import { z } from 'zod';

const ToolCallSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.any()),
});

const ResponseEnvelopeSchema = z.object({
  toolCalls: z.array(ToolCallSchema).optional(),
  content: z.string().optional(),
  needsMoreWork: z.boolean().optional(),
});

class ValidationRepairLoop {
  private maxRepairAttempts = 2;

  async validateAndRepair(
    response: LLMToolCallResponse,
    rawContent: string,
    adapter: ProviderAdapter,
    request: ChatRequest,
  ): Promise<LLMToolCallResponse> {

    // Attempt 1: Validate as-is
    const validation = ResponseEnvelopeSchema.safeParse(response);
    if (validation.success) {
      return this.validateToolNames(validation.data, request.tools);
    }

    // Attempt 2: Use failed_generation content if available
    if (rawContent && rawContent !== JSON.stringify(response)) {
      const recovered = this.extractFromFailedGeneration(rawContent);
      if (recovered) return recovered;
    }

    // Attempt 3: LLM self-correction
    for (let i = 0; i < this.maxRepairAttempts; i++) {
      const repaired = await this.requestLLMRepair(adapter, request, response);
      const revalidation = ResponseEnvelopeSchema.safeParse(repaired);
      if (revalidation.success) {
        return revalidation.data;
      }
    }

    // Final fallback: treat as plain text
    return { content: rawContent || '', needsMoreWork: undefined };
  }

  private validateToolNames(
    response: LLMToolCallResponse,
    availableTools?: ToolDefinition[]
  ): LLMToolCallResponse {
    if (!response.toolCalls || !availableTools) return response;

    // Filter out invalid tool calls
    const validToolNames = new Set(availableTools.map(t => t.name));
    response.toolCalls = response.toolCalls.filter(tc => {
      if (!validToolNames.has(tc.name)) {
        console.warn(`Unknown tool: ${tc.name}`);
        return false;
      }
      return true;
    });

    return response;
  }
}
```

---

## Layer 4: Fallback Strategies

### Purpose
When lower layers fail, provide graceful degradation paths.

### Strategy Hierarchy

```typescript
class FallbackManager {
  private strategies: FallbackStrategy[] = [
    new RetryWithDifferentFormat(),
    new EscalateToCapableModel(),
    new DegradeToTextOnly(),
  ];

  async executeWithFallbacks<T>(
    primaryAction: () => Promise<T>,
    context: FallbackContext,
  ): Promise<T> {
    let lastError: Error | null = null;

    // Try primary action
    try {
      return await primaryAction();
    } catch (error) {
      lastError = error as Error;
    }

    // Try each fallback strategy
    for (const strategy of this.strategies) {
      if (strategy.canHandle(lastError!, context)) {
        try {
          return await strategy.execute(context);
        } catch (error) {
          lastError = error as Error;
        }
      }
    }

    throw lastError;
  }
}

// Strategy 1: Retry with different output format
class RetryWithDifferentFormat implements FallbackStrategy {
  canHandle(error: Error, ctx: FallbackContext): boolean {
    return error.message.includes('json_schema') ||
           error.message.includes('response_format');
  }

  async execute(ctx: FallbackContext): Promise<LLMToolCallResponse> {
    const formats = ['json_schema', 'json_object', 'text'] as const;
    const currentIdx = formats.indexOf(ctx.currentFormat);

    for (let i = currentIdx + 1; i < formats.length; i++) {
      try {
        return await ctx.adapter.complete({
          ...ctx.request,
          responseFormat: formats[i],
        });
      } catch { continue; }
    }
    throw new Error('All format fallbacks exhausted');
  }
}
```

---

## Model Capability Detection Strategy

### Static Knowledge Base

```typescript
// Known model capabilities (updated periodically)
const MODEL_CAPABILITIES_DB: Record<string, Partial<ModelCapabilities>> = {
  // OpenAI models
  'gpt-4o': { supportsNativeTools: true, supportsJsonSchema: true },
  'gpt-4o-mini': { supportsNativeTools: true, supportsJsonSchema: true },

  // Claude models (via OpenRouter)
  'anthropic/claude-3.5-sonnet': {
    supportsNativeTools: true,
    supportsJsonSchema: false,
    emitsXmlToolCalls: true,  // Known to use XML despite instructions
  },

  // Llama models
  'meta-llama/llama-3.3-70b-instruct': {
    supportsNativeTools: false,
    supportsJsonSchema: false,
    emitsXmlToolCalls: false,
  },

  // Gemini models
  'gemini-1.5-pro': {
    supportsNativeTools: true,
    supportsJsonSchema: false,
  },
};
```

### Runtime Learning

```typescript
class CapabilityLearner {
  private cache = new Map<string, ModelCapabilities>();
  private CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  recordSuccess(modelId: string, capability: keyof ModelCapabilities): void {
    const current = this.cache.get(modelId) || this.getDefaults();
    current[capability] = true;
    current.lastTested = Date.now();
    this.cache.set(modelId, current);
  }

  recordFailure(modelId: string, capability: keyof ModelCapabilities): void {
    const current = this.cache.get(modelId) || this.getDefaults();
    current[capability] = false;
    current.lastTested = Date.now();
    this.cache.set(modelId, current);
  }

  getCapabilities(modelId: string): ModelCapabilities {
    // Priority: runtime cache > static DB > optimistic defaults
    const cached = this.cache.get(modelId);
    if (cached && Date.now() - cached.lastTested < this.CACHE_TTL) {
      return cached;
    }

    const static_ = MODEL_CAPABILITIES_DB[modelId];
    if (static_) {
      return { ...this.getDefaults(), ...static_ };
    }

    return this.getDefaults();
  }
}
```

---

## Per-Model Configuration

### Configuration Schema

```typescript
interface ModelConfig {
  modelId: string;

  // Output mode preference order
  preferredModes: ('native_tools' | 'json_schema' | 'json_object' | 'text')[];

  // XML handling
  expectXmlOutput: boolean;  // Pre-emptively enable XML normalization

  // Retry behavior
  maxRetries: number;
  retryWithDifferentFormat: boolean;

  // Prompting adjustments
  useStrictJsonInstructions: boolean;  // Add extra "no XML" instructions
}

// Default configuration (can be overridden per-model)
const DEFAULT_MODEL_CONFIG: ModelConfig = {
  modelId: '*',
  preferredModes: ['json_schema', 'json_object', 'text'],
  expectXmlOutput: false,
  maxRetries: 3,
  retryWithDifferentFormat: true,
  useStrictJsonInstructions: false,
};

// Claude-specific override
const CLAUDE_CONFIG: Partial<ModelConfig> = {
  preferredModes: ['native_tools', 'text'],  // Skip json_schema/object
  expectXmlOutput: true,
  useStrictJsonInstructions: true,
};
```

### UI Configuration (Optional Future Enhancement)

```yaml
# Example user-facing config.json addition
modelOverrides:
  "anthropic/claude-3.5-sonnet":
    preferNativeTools: true
    enableXmlNormalization: true
  "meta-llama/llama-3.3-70b":
    forceTextMode: true
```

---

## Migration Path

### Phase 1: Extract Layers (Non-Breaking)

1. **Create new files** without modifying existing code:
   - `apps/desktop/src/main/llm/adapters/` - Provider adapters
   - `apps/desktop/src/main/llm/normalizer.ts` - Response normalizer
   - `apps/desktop/src/main/llm/validator.ts` - Validation + repair
   - `apps/desktop/src/main/llm/fallback.ts` - Fallback strategies

2. **Move existing logic** from `llm-fetch.ts`:
   - `normalizeXmlToolCalls()` → `normalizer.ts`
   - `extractJsonObject()` → `normalizer.ts`
   - `modelCapabilityCache` → `adapters/capability-cache.ts`
   - Structured output fallback chain → `fallback.ts`

### Phase 2: Introduce Adapter Pattern

3. **Create adapter interface** matching current `makeOpenAICompatibleCall` signature
4. **Implement adapters** that wrap existing provider-specific logic
5. **Add orchestration layer** that routes through adapters

### Phase 3: Enable Native Tool Calling

6. **Update OpenAI adapter** to use native `tools` parameter for OpenAI models
7. **Add Claude adapter** with native tool calling via OpenRouter
8. **Update system prompts** to remove redundant tool format instructions when using native tools

### Phase 4: Optimize

9. **Remove redundant validation** when using native tools (provider handles it)
10. **Add streaming support** for tool call detection mid-stream
11. **Implement capability probing** for unknown models

---

## File Structure

```
apps/desktop/src/main/
├── llm/
│   ├── index.ts                    # Main orchestrator (replaces makeLLMCall)
│   ├── types.ts                    # Shared types
│   │
│   ├── adapters/
│   │   ├── index.ts                # Adapter registry
│   │   ├── base.ts                 # ProviderAdapter interface
│   │   ├── openai.ts               # OpenAI adapter
│   │   ├── groq.ts                 # Groq adapter
│   │   ├── gemini.ts               # Gemini adapter
│   │   ├── openrouter.ts           # OpenRouter adapter
│   │   └── capability-cache.ts     # Runtime capability learning
│   │
│   ├── normalizer/
│   │   ├── index.ts                # ResponseNormalizer class
│   │   ├── native-tools.ts         # Native tool_calls → envelope
│   │   ├── xml.ts                  # XML → envelope
│   │   └── json.ts                 # JSON extraction
│   │
│   ├── validator/
│   │   ├── index.ts                # ValidationRepairLoop class
│   │   ├── schemas.ts              # Zod schemas
│   │   └── repair.ts               # LLM self-correction logic
│   │
│   └── fallback/
│       ├── index.ts                # FallbackManager class
│       └── strategies.ts           # Individual strategies
│
├── llm-fetch.ts                    # DEPRECATED - thin wrapper for migration
├── llm.ts                          # Agent loop (minimal changes)
└── system-prompts.ts               # Updated for native tool mode
```

---

## Success Metrics

| Metric | Current State | Target |
|--------|---------------|--------|
| Tool call success rate (OpenAI) | ~95% | 99% |
| Tool call success rate (Claude) | ~70% (XML issues) | 95% |
| Tool call success rate (Llama) | ~60% | 85% |
| Average retries per successful call | 0.8 | 0.2 |
| Fallback usage rate | N/A | <5% |

---

## Open Questions

1. **Native tools for OpenRouter**: Should we enable native tool calling for all OpenRouter models, or only known-compatible ones?

2. **Streaming tool calls**: How do we detect tool calls mid-stream for models that emit them incrementally?

3. **Verification optimization**: Can we use the validation layer to skip the verification LLM call when we have high confidence?

4. **Model upgrade paths**: When a model fails repeatedly, should we automatically suggest/switch to a more capable model?

---

## Appendix: Current XML Patterns Observed

```xml
<!-- Pattern 1: Claude's preferred format -->
<function_calls>
<invoke name="read_file">
<parameter name="path">/etc/hosts</parameter>
</invoke>
</function_calls>

<!-- Pattern 2: Alternative invoke format -->
<function_calls>
[{"name": "read_file", "arguments": {"path": "/etc/hosts"}}]
</function_calls>

<!-- Pattern 3: Tool markers (some Llama fine-tunes) -->
<|tool_calls_section_begin|>
<|tool_call_begin|>read_file<|tool_call_end|>
<|tool_calls_section_end|>
```

All patterns should normalize to:
```json
{
  "toolCalls": [{"name": "read_file", "arguments": {"path": "/etc/hosts"}}],
  "content": "",
  "needsMoreWork": true
}
```
