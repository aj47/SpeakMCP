# Prompt Caching Design — SpeakMCP Refactoring Plan

## Executive Summary

SpeakMCP's agent loop sends the **same system prompt, tool definitions, and growing conversation history** on every API call within a session. With a typical 10-iteration agent session, this means the same multi-thousand-token prefix is re-processed from scratch each time. Anthropic's prompt caching can reduce the cost of re-read tokens by **90%** and significantly lower time-to-first-token latency.

However, the current architecture routes **all** LLM calls—including Claude models—through the Vercel AI SDK's OpenAI-compatible provider (`@ai-sdk/openai`). This abstraction strips away provider-specific features like `cache_control`. To unlock prompt caching, we need a targeted refactoring that introduces a native Anthropic path for Claude models while preserving the existing multi-provider support.

---

## 1. Current Architecture Analysis

### 1.1 Provider Layer (`ai-sdk-provider.ts`)

```
ProviderType = "openai" | "groq" | "gemini"
```

All providers, including Claude (via OpenRouter or other OpenAI-compatible proxies), use `createOpenAI()` from `@ai-sdk/openai`. There is no `@ai-sdk/anthropic` or `@anthropic-ai/sdk` dependency.

**Implication**: Even when users configure a Claude model (e.g., `claude-sonnet-4-5` via OpenRouter), the system has no way to send `cache_control` markers because the OpenAI Chat Completions API doesn't support them.

### 1.2 Message Construction (`llm.ts`, `system-prompts.ts`)

Each agent loop iteration builds messages as:
```
[
  { role: "system", content: systemPrompt },     // ~2-10K tokens, STABLE across iterations
  ...conversationHistory.map(entry => ...)         // GROWING, previous entries are stable
]
```

The system prompt (`constructSystemPrompt()`) includes:
- **Base prompt** (~400 tokens) — stable per session
- **Agent mode additions** (~300 tokens) — stable per session
- **ACP routing info** — stable per session
- **Skills instructions** — stable per session
- **Memories** (up to 30 entries) — stable per session
- **Tool server listings** — stable unless tools are excluded for failures
- **User guidelines** — stable per session
- **Persona properties** — stable per session

### 1.3 Tool Definitions (`llm-fetch.ts`)

`convertMCPToolsToAISDKTools()` converts MCP tools to AI SDK format on every call. Tool schemas (name, description, inputSchema) are stable across iterations unless a tool is excluded after repeated failures.

### 1.4 Context Budget (`context-budget.ts`)

`shrinkMessagesForLLM()` applies tiered strategies (truncation, summarization, message dropping) that can **mutate message content** mid-session. This is important because:
- Summarized messages will have different content than originals → cache miss
- Dropped messages change the sequence → cache miss after the drop point

### 1.5 Agent Loop (`llm.ts:processTranscriptWithAgentMode`)

A typical 10-iteration session makes **10+ LLM calls**, each re-sending:
- The full system prompt (~2-10K tokens)
- All tool definitions (~1-20K tokens depending on MCP server count)
- All previous conversation history (growing from ~100 to ~5K+ tokens)

**Only the last user message (the new tool result or nudge) changes between iterations.**

---

## 2. How Anthropic Prompt Caching Works

### 2.1 Core Mechanics

Cache is checked against the **prefix** of the request in order: `tools` → `system` → `messages`. A `cache_control: { type: "ephemeral" }` marker designates breakpoints.

- **Cache hit (read)**: 10% of base input token cost
- **Cache write**: 125% of base input token cost (first time only)
- **TTL**: 5 minutes by default (refreshed on use), 1-hour option at 2x cost
- **Max breakpoints**: 4 per request
- **Minimum tokens**: 1024 (Sonnet/Opus 4.x), 4096 (Opus 4.5/4.6, Haiku 4.5)

### 2.2 Automatic vs Explicit Caching

- **Automatic**: Single `cache_control` at request top-level, system auto-places breakpoint at last cacheable block. Best for simple multi-turn conversations.
- **Explicit**: Place `cache_control` on specific content blocks. Best for our use case where tools, system prompt, and conversation history change at different frequencies.

### 2.3 Cache Hierarchy for SpeakMCP

Optimal breakpoint placement for the agent loop:

```
Breakpoint 1: Last tool definition     → tools rarely change within a session
Breakpoint 2: End of system prompt     → system prompt is stable within a session
Breakpoint 3: End of conversation history (before latest message) → grows each iteration
Breakpoint 4: (reserved for automatic caching or future use)
```

### 2.4 What Invalidates Cache

| Change | Impact |
|--------|--------|
| Tool definitions change | Invalidates ALL cache (tools → system → messages) |
| System prompt changes | Invalidates system + messages cache |
| Earlier messages change | Invalidates from that point forward |
| `tool_choice` changes | Invalidates messages cache |

**Key concern for SpeakMCP**: The `shrinkMessagesForLLM()` function can summarize or drop earlier messages, which would invalidate the conversation cache. This needs careful handling.

---

## 3. Identified Caching Opportunities

### 3.1 Agent Loop (Highest Impact)

**Current cost profile** (10-iteration session, Claude Sonnet, ~5K token system+tools):

| Iteration | Input Tokens | Cost (no cache) |
|-----------|-------------|-----------------|
| 1 | 5,000 | $0.015 |
| 2 | 5,500 | $0.0165 |
| 3 | 6,200 | $0.0186 |
| ... | ... | ... |
| 10 | 10,000 | $0.030 |
| **Total** | **~75,000** | **~$0.225** |

**With prompt caching** (tools+system cached on iteration 1, conversation prefix cached each iteration):

| Iteration | Cache Read | Cache Write | New Tokens | Cost |
|-----------|-----------|-------------|------------|------|
| 1 | 0 | 5,000 | 100 | $0.019 (write) |
| 2 | 5,000 | 500 | 100 | $0.003 |
| 3 | 5,500 | 700 | 100 | $0.004 |
| ... | ... | ... | ... | ... |
| 10 | 9,500 | 500 | 100 | $0.005 |
| **Total** | | | | **~$0.050** |

**Estimated savings: ~78% cost reduction for agent sessions.**

### 3.2 Non-Agent Tool Calls (`processTranscriptWithTools`)

Single-shot calls benefit less, but if the same system prompt + tools are used within 5 minutes (which is common for voice dictation), cache reads save 90%.

### 3.3 MCP Sampling (`mcp-sampling.ts`)

Similar pattern — system prompt is rebuilt each time. Lower impact since sampling calls are less frequent.

### 3.4 Verification Calls (`verifyCompletionWithFetch`)

These use the same system prompt pattern. Cache would help if called within TTL window of the main agent call.

---

## 4. Proposed Architecture

### 4.1 Add Anthropic as a First-Class Provider

**New provider type:**
```typescript
// ai-sdk-provider.ts
export type ProviderType = "openai" | "groq" | "gemini" | "anthropic"
```

**New dependency:**
```
@ai-sdk/anthropic   — for Vercel AI SDK integration with native Anthropic features
```

The `@ai-sdk/anthropic` provider supports `cache_control` via `providerOptions`, which means we can use `cache_control` while staying within the Vercel AI SDK framework. This avoids rewriting the entire LLM call layer.

### 4.2 Cache-Aware Message Builder

Create a new module `prompt-cache.ts` that wraps message construction with cache breakpoints when the provider is Anthropic:

```typescript
// prompt-cache.ts

export interface CacheAwareRequest {
  system: SystemMessage[]           // Array of content blocks (not a single string)
  messages: MessageParam[]          // Messages with cache_control on strategic blocks
  tools: ToolDefinition[]           // Tools with cache_control on last item
  cacheControl?: { type: "ephemeral" }  // Top-level automatic caching
}

/**
 * Build a cache-optimized request for Anthropic models.
 * Uses up to 3 explicit breakpoints:
 *   1. End of tool definitions
 *   2. End of system prompt
 *   3. End of prior conversation history (before current turn)
 *
 * Falls back to plain format for non-Anthropic providers.
 */
export function buildCacheAwareRequest(
  providerId: ProviderType,
  systemPrompt: string,
  tools: MCPTool[],
  conversationHistory: ConversationEntry[],
  currentMessage: string,
): CacheAwareRequest { ... }
```

### 4.3 Refactored `convertMessages()` in `llm-fetch.ts`

Currently, `convertMessages()` collapses all system messages into a single string. For Anthropic, we need to preserve them as an array of content blocks so we can attach `cache_control`:

```typescript
// Before (current):
function convertMessages(messages) {
  system: systemMessages.join("\n\n"),  // Single string — no cache_control possible
  messages: otherMessages,
}

// After (for Anthropic):
function convertMessagesForAnthropic(messages) {
  system: [
    { type: "text", text: systemContent, cache_control: { type: "ephemeral" } }
  ],
  messages: otherMessages.map((msg, i) => {
    // Add cache_control to the second-to-last message (prior history boundary)
    if (i === otherMessages.length - 2) {
      return { ...msg, cache_control: { type: "ephemeral" } }
    }
    return msg
  }),
}
```

### 4.4 Stable System Prompt Construction

The system prompt must be **byte-identical** across iterations for cache hits. Current issues:

1. **`constructSystemPrompt()` is called multiple times** — once at session start, and again if tools are excluded. The excluded-tools rebuild changes the system prompt and invalidates the system cache.

2. **Tool listings embed tool counts** (e.g., `"AVAILABLE MCP SERVERS (47 tools total)"`). If a tool is excluded mid-session, this count changes → cache invalidation.

**Fix**: Separate the stable system prompt parts from the dynamic parts:

```typescript
// Stable part (cached):
const stableSystemPrompt = constructStableSystemPrompt(
  baseInstructions,
  agentModeAdditions,
  skillsInstructions,
  memories,
  userGuidelines,
  personaProperties,
)

// Dynamic part (not cached, appended after cache breakpoint):
const dynamicSystemPrompt = constructDynamicSystemPrompt(
  availableTools,    // Tool listings that may change
  relevantTools,
)
```

For the Anthropic path, these become two system content blocks:
```typescript
system: [
  { type: "text", text: stableSystemPrompt, cache_control: { type: "ephemeral" } },
  { type: "text", text: dynamicSystemPrompt },
]
```

### 4.5 Context Budget Integration

The `shrinkMessagesForLLM()` function currently mutates messages (summarization, dropping). This is **incompatible with prompt caching** because it changes previously-sent content, invalidating the cache.

**Strategy**: Apply context shrinking **only to content after the last cache breakpoint**, or switch to a **cache-first shrinking strategy**:

1. **Before shrinking**: Calculate if the request fits with cached prefix + new content
2. **If it fits**: Skip shrinking entirely (cache handles the cost optimization)
3. **If it doesn't fit**: Shrink only the newest messages, preserving cached prefix integrity
4. **Last resort**: Rebuild without cache (current behavior) if context is truly exceeded

This is a significant behavior change. With caching, we're trading context-budget token savings for cache-hit cost savings (90% cheaper reads vs. summarization LLM calls).

### 4.6 Tool Definition Stability

Tools should be sorted deterministically and serialized identically across iterations. Current `convertMCPToolsToAISDKTools()` iterates over the array in order, which is fine as long as `mcpService.getAvailableTools()` returns tools in a stable order.

**Fix**: Add explicit sorting by tool name before conversion, and cache the converted result per session:

```typescript
// Per-session tool cache
const sessionToolCache = new Map<string, ConvertedTools>()

function getOrConvertTools(sessionId: string, mcpTools: MCPTool[]): ConvertedTools {
  const sorted = [...mcpTools].sort((a, b) => a.name.localeCompare(b.name))
  const key = sorted.map(t => t.name).join(',')

  if (sessionToolCache.has(key)) return sessionToolCache.get(key)!

  const converted = convertMCPToolsToAISDKTools(sorted)
  sessionToolCache.set(key, converted)
  return converted
}
```

---

## 5. Implementation Phases

### Phase 1: Add Anthropic Provider (Foundation)

**Files to modify:**
- `ai-sdk-provider.ts` — Add "anthropic" provider type, `createAnthropic()` factory
- `config.ts` — Add `anthropicApiKey`, `anthropicBaseUrl` config fields
- `context-budget.ts` — Add Anthropic models to MODEL_REGISTRY (already partially there)
- `package.json` — Add `@ai-sdk/anthropic` dependency

**Files to add:**
- `prompt-cache.ts` — Cache-aware message builder module

**Scope**: Anthropic models work as a provider option. No caching yet — just establishing the native path.

### Phase 2: Implement Explicit Cache Breakpoints

**Files to modify:**
- `llm-fetch.ts` — Add `convertMessagesForAnthropic()` that preserves content block arrays with `cache_control`. Modify `makeLLMCallWithFetch()` to use cache-aware path for Anthropic.
- `system-prompts.ts` — Split `constructSystemPrompt()` into stable/dynamic parts
- `llm.ts` — Pass provider info to message construction so cache markers are added

**Key deliverable**: Agent loop iterations 2+ get cache hits on tools + system prompt.

### Phase 3: Conversation History Caching

**Files to modify:**
- `llm.ts` (`processTranscriptWithAgentMode`) — Add cache breakpoint at end of prior conversation history before each new iteration
- `context-budget.ts` — Modify `shrinkMessagesForLLM()` to be cache-aware (preserve cached prefix, shrink only new content)

**Key deliverable**: Each iteration caches the growing conversation prefix, so iteration N only processes the new tool result.

### Phase 4: Observability & Tuning

**Files to modify:**
- `llm-fetch.ts` — Extract and log `cache_read_input_tokens`, `cache_creation_input_tokens` from Anthropic responses
- `langfuse-service.ts` — Include cache metrics in Langfuse traces
- `diagnostics.ts` — Add cache hit rate monitoring

**Key deliverable**: Developers can see cache hit rates and cost savings in the UI and Langfuse.

---

## 6. Impact on Existing Features

### 6.1 Non-Anthropic Providers

**No changes.** The cache-aware path is only activated when `providerId === "anthropic"`. OpenAI, Groq, and Gemini paths remain identical.

### 6.2 Streaming (`makeLLMCallWithStreaming`)

Prompt caching works with streaming. The `@ai-sdk/anthropic` provider passes `cache_control` through. Cache metrics are available in `message_start` stream events.

### 6.3 MCP Sampling

Sampling calls (`mcp-sampling.ts`) can benefit from caching if they go through the Anthropic provider. Lower priority since they're less frequent.

### 6.4 Sub-Sessions / Internal Agents

Each sub-session gets its own conversation history but may share the same tools and a similar system prompt. If sub-sessions use the same Anthropic organization, they can benefit from shared cache entries (cache is org-scoped, not session-scoped).

### 6.5 Conversation Compaction (`conversationService.compactOnLoad`)

Compaction changes the conversation prefix (summarizes old messages). This will invalidate caches for resumed conversations. This is acceptable since compaction is a rare event (triggers only when messages > 20).

---

## 7. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| System prompt instability across iterations | Cache misses, no cost savings | Split into stable/dynamic parts (Phase 2) |
| Context shrinking invalidates cache | Cache misses for long conversations | Cache-aware shrinking strategy (Phase 3) |
| Tool order instability | Cache misses on tool definitions | Deterministic sorting by tool name |
| 5-min TTL expiry during slow tools | Cache miss after long tool execution | Use 1-hour TTL for agent sessions (configurable) |
| `@ai-sdk/anthropic` doesn't support all `cache_control` features | Partial caching only | Verify provider support; fall back to manual Anthropic SDK if needed |
| Breaking existing tests | Regression | Phase 1 is additive-only; existing providers unaffected |

---

## 8. Configuration

New config fields for user control:

```typescript
interface CacheConfig {
  // Enable/disable prompt caching (default: true for Anthropic)
  promptCachingEnabled: boolean

  // Cache TTL: "5m" | "1h" (default: "5m")
  promptCacheTTL: "5m" | "1h"

  // Whether to use cache-aware context shrinking (default: true)
  cacheAwareContextShrinking: boolean
}
```

---

## 9. Success Metrics

| Metric | Target |
|--------|--------|
| Cache hit rate (agent iterations 2+) | > 90% |
| Cost reduction per agent session (Anthropic) | 60-80% on input tokens |
| Time-to-first-token reduction (iterations 2+) | 30-50% for large prompts |
| Regression in non-Anthropic providers | 0 |

---

## 10. Summary

The highest-impact change is enabling Anthropic as a native provider and adding cache breakpoints to the agent loop. A 10-iteration agent session with 5K tokens of system+tools currently processes ~75K input tokens total. With caching, ~65K of those become cache reads at 10% cost, saving approximately **78% on input token costs** and reducing latency on every iteration after the first.

The refactoring is incremental and backwards-compatible. Phase 1 (add provider) and Phase 2 (cache breakpoints) deliver the majority of the value and can be shipped independently.
