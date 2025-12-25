# [Refactor] Consolidate LLM abstraction layer

## Problem

The LLM integration is spread across multiple overlapping files totaling **4,366 LOC**:
- `llm-fetch.ts` (1,631 LOC) - Raw API calls, retry logic, model compatibility
- `llm.ts` (2,735 LOC) - Agent mode, tool calling, context extraction

These files have significant overlap and unclear boundaries:
- Both handle provider-specific logic (OpenAI, Groq, Gemini)
- Both deal with structured output/JSON parsing
- Retry logic in `llm-fetch.ts` but error recovery in `llm.ts`
- Model capability detection duplicated

## Current State

```
llm-fetch.ts:
├── HttpError class
├── apiCallWithRetry()
├── Model capability caching
├── makeOpenAICompatibleCall()
├── makeGeminiCall()
├── Structured output fallback
└── verifyCompletionWithFetch()

llm.ts:
├── Tool capability patterns
├── extractContextFromHistory()
├── analyzeToolErrors()
├── postProcessTranscript()
├── processTranscriptWithTools()
├── processTranscriptWithAgentMode()
└── Agent loop with progress
```

## Proposed Solution

Reorganize into a clean provider abstraction:

```
apps/desktop/src/main/llm/
├── index.ts                 # Unified public API
├── providers/
│   ├── base.ts              # Abstract LLMProvider interface
│   ├── openai.ts            # OpenAI/OpenRouter implementation
│   ├── groq.ts              # Groq implementation
│   └── gemini.ts            # Gemini implementation
├── retry.ts                 # Generic retry with backoff (reusable)
├── structured-output.ts     # JSON schema handling
├── agent/
│   ├── agent-loop.ts        # Main agent iteration
│   ├── tool-execution.ts    # Tool calling logic
│   └── context-extraction.ts # History analysis
└── types.ts                 # LLM-specific types
```

### Key Changes

1. **Provider Interface**: Single interface all providers implement
```typescript
interface LLMProvider {
  id: string
  makeCall(messages: Message[], options?: CallOptions): Promise<LLMResponse>
  supportsStructuredOutput(): boolean
  getModelCapabilities(): ModelCapabilities
}
```

2. **Extract Retry Logic**: Generic utility usable by other services
```typescript
// retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T>
```

3. **Separate Agent Logic**: Agent mode becomes its own focused module

## Benefits

- **Clear Provider Abstraction**: Easy to add new LLM providers
- **Reusable Retry Logic**: Can use for MCP, remote server, etc.
- **Testable Components**: Each module can be unit tested
- **Smaller Files**: Max 400-500 LOC per file

## Acceptance Criteria

- [ ] Create `llm/providers/` with base interface
- [ ] Migrate OpenAI provider
- [ ] Migrate Groq provider
- [ ] Migrate Gemini provider
- [ ] Extract retry utility
- [ ] Separate agent loop from LLM calls
- [ ] Update all imports
- [ ] Add provider-specific tests
- [ ] No file exceeds 500 LOC

## Labels

`refactor`, `tech-debt`, `architecture`
