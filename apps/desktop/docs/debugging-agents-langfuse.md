# Debugging Agent Completion with Langfuse

This guide explains how to debug agent completion issues using Langfuse traces.

## Quick Start

1. **Enable debug logging**: `pnpm dev -- -dl` (LLM debug) or `pnpm dev -- -dt` (tools debug)
2. **Check Langfuse dashboard** for traces with high iteration counts or `wasAborted: true`

## Architecture Overview

### Key Files
| File | Purpose |
|------|---------|
| `src/main/langfuse-service.ts` | Langfuse SDK wrapper, trace/span/generation management |
| `src/main/llm.ts` | Agent loop, completion logic, trace lifecycle |
| `src/main/llm-fetch.ts` | LLM API calls, generation tracing, `needsMoreWork` logic |
| `src/main/mcp-service.ts` | Tool execution, tool span tracing |

### What Gets Traced

1. **Agent Session Traces** - One per user request
   - Input: user transcript
   - Metadata: `maxIterations`, `hasHistory`, `profileId`, `profileName`
   - Output: final content
   - End metadata: `totalIterations`, `wasAborted`

2. **LLM Generations** - Each LLM call within a trace
   - Model name and provider
   - Input messages (system + conversation)
   - Output (content + tool calls as JSON)
   - Token usage (when available)

3. **Tool Spans** - Each MCP tool execution
   - Tool name and arguments
   - Result or error
   - Nested under the parent trace

## Agent Completion Logic

The agent loop in `llm.ts` (line ~947) runs until one of these conditions:

### Normal Completion Paths
| Condition | Location | Trace Indicator |
|-----------|----------|-----------------|
| `needsMoreWork === false` + no tool calls | llm.ts:1401-1575 | Low iteration count, no errors |
| Substantive response without tools | llm.ts:1609-1627 | `totalIterations: 1-2` typically |
| Verification passed | llm.ts:1465-1575 | Verification generation with `isComplete: true` |
| Empty completion verified | llm.ts:1263-1358 | `earlyCompletion: true` in metadata |

### Failure/Stop Paths
| Condition | Location | Trace Indicator |
|-----------|----------|-----------------|
| Max iterations hit | llm.ts:2682-2701 | `totalIterations === maxIterations` |
| Kill switch activated | llm.ts:952-978 | `wasAborted: true` |
| Verification loop | llm.ts:1513-1548 | Multiple verification generations |

## The `needsMoreWork` Flag

This flag controls whether the agent continues iterating:

```
needsMoreWork = true   → Continue loop (tool calls always set this)
needsMoreWork = false  → Attempt to complete (runs verification if enabled)
needsMoreWork = undefined → Heuristics decide (see llm.ts:1578-1703)
```

**Set in `llm-fetch.ts`:**
- Line 588: Tool calls → `needsMoreWork: true`
- Line 614-616: JSON response without tool calls and undefined → defaults to `true`
- Line 648: Text with tool markers → `needsMoreWork: true`
- Line 656: Plain text → `needsMoreWork: undefined`

## Common Issues & What to Check

### 1. Agent Hits Max Iterations
**Symptoms**: `totalIterations` equals `maxIterations` in trace metadata

**Check in Langfuse**:
- Look at the last few LLM generations - is `needsMoreWork` never `false`?
- Are verification calls returning `isComplete: false`?
- Is the LLM stuck in a tool-calling loop?

**Common causes**:
- Verification too strict (rejects valid completions)
- LLM not setting `needsMoreWork: false` in response
- Tool errors causing retry loops

### 2. Agent Completes Too Early
**Symptoms**: Agent stops before task is done

**Check in Langfuse**:
- Did verification pass when it shouldn't have?
- Was `needsMoreWork: false` set prematurely?
- Look for `hasSubstantiveContent` false positives

### 3. Verification Loops
**Symptoms**: Multiple "Verifying completion" generations in trace

**Check in Langfuse**:
- Filter for generations with name containing "Verification"
- Check `missingItems` and `reason` in verification responses
- Is the same verification failing repeatedly?

### 4. Tool Execution Failures
**Symptoms**: Tool spans with errors, retries visible

**Check in Langfuse**:
- Filter spans by level "ERROR"
- Check `statusMessage` on failed spans
- Look for patterns in which tools fail

## Useful Langfuse Filters

```
# Find incomplete traces
metadata.wasAborted = true

# Find max-iteration hits  
metadata.totalIterations >= 10

# Find specific profile issues
tags contains "profile:ProfileName"

# Find verification failures
name contains "Verification" AND level = "ERROR"
```

## Config Options Affecting Completion

| Config Key | Default | Effect |
|------------|---------|--------|
| `mcpMaxIterations` | 10 | Hard limit on agent loop iterations |
| `mcpVerifyCompletionEnabled` | true | Enables LLM verification before completing |
| `mcpVerifyRetryCount` | 1 | Retries for verification calls |
| `mcpFinalSummaryEnabled` | true | Requests summary after tool execution |

## Adding Custom Debug Points

To add more tracing, use these functions from `langfuse-service.ts`:

```typescript
import { createToolSpan, endToolSpan, createLLMGeneration, endLLMGeneration } from "./langfuse-service"

// For custom spans (e.g., verification logic)
const spanId = randomUUID()
createToolSpan(sessionId, spanId, { name: "Custom Check", input: { ... } })
// ... do work ...
endToolSpan(spanId, { output: result, level: "DEFAULT" })
```

---

# Deep Dive: Known Issues Analysis

The following sections document specific reliability issues discovered through code analysis.

## Issue Category 1: Completion Logic Reliability

### 8 Competing Completion Paths

The agent has multiple ways to complete, with complex precedence:

| Path | Location | Condition |
|------|----------|-----------|
| Kill switch | ~978, 1105, 1173, etc. | `shouldStopSession()` |
| Empty completion | ~1340 | `needsMoreWork === false` + empty content |
| Explicit completion | ~1570 | `explicitlyComplete && !hasToolCalls` + verified |
| Substantive response | ~1623 | `hasAnyResponse && needsMoreWork !== true` |
| Tool results + response | ~1659, 1698 | `hasToolResultsInCurrentTurn && hasSubstantiveResponse` |
| Post-tool completion | ~2412 | `agentIndicatedDone && allToolsSuccessful` |
| General stop | ~2624 | `needsMoreWork !== false` failed + verified |
| Max iterations | ~2698 | `iteration >= maxIterations` |

**Risk**: Response could match multiple conditions; ordering matters.

### Missing Case: `explicitlyComplete && hasToolCalls && !allToolsSuccessful`

If LLM sets `needsMoreWork: false` but tool execution fails, behavior is undefined - falls through to `shouldContinue` check unexpectedly.

### `noOpCount` State Issues

- Not reset on explicit completion paths
- Scattered resets across code (lines 1441, 1527, 1679, 1724, 2353, 2605)
- Can remain stale if verification fails and `continue` is called

---

## Issue Category 2: Verification Loop Problems

### `verificationFailCount` Only Used in ONE Code Path

| Location | Has `verificationFailCount++` | Has special handling |
|----------|------------------------------|---------------------|
| Lines 1513-1529 | ✅ Yes | ✅ Nudge for no tools |
| Lines 2346-2354 | ❌ **No** | ❌ Only `noOpCount = 0` |
| Lines 2598-2607 | ❌ **No** | ❌ Only `noOpCount = 0` |

**Result**: Anti-loop protection only works in first completion path.

### No Hard Limit on Verification Failures

Agent will loop until `maxIterations` if verifier keeps returning `isComplete: false` with slightly different responses each time.

### Verification Prompt Too Strict

The "intent detection" rule can reject valid completions:
- "Let me know if you need anything else" → Marked INCOMPLETE
- Only sees last 10 messages → May miss earlier completion

### Nudge Feedback Loop

1. Verifier rejects → adds nudge with vague "missing items"
2. LLM responds addressing those items
3. Verifier sees nudge in history → still rejects
4. Repeat until max iterations

---

## Issue Category 3: `needsMoreWork` Flag Handling

### Asymmetric Behavior Between JSON and Plain Text

| Response Type | `needsMoreWork` Value |
|---------------|----------------------|
| Plain text | `undefined` (heuristics decide) |
| JSON without `needsMoreWork` | Forced to `true` |
| Native tool calls | Always `true` |
| JSON tool calls | Preserved from JSON (could be `false`!) |
| Streaming | Always `undefined` |

**Problem**: JSON response `{"content": "Hello"}` forces `needsMoreWork: true` even for simple greetings, while plain text "Hello" uses heuristics and can complete.

### JSON + Tool Calls Inconsistency

- Native AI SDK tool calls → `needsMoreWork: true` always
- JSON `{"toolCalls": [...], "needsMoreWork": false}` → Preserved as `false`

This means JSON tool calls might skip execution continuation.

---

## Issue Category 4: Tool Failure Impact

### No Tool-Specific Failure Counter

Unlike `noOpCount` and `verificationFailCount`, there's no tracking for repeated failures of the same tool. Agent can call a failing tool indefinitely.

### Context Pollution from Errors

Both raw error AND analysis/recovery summary get added to history:
```
Tool execution errors occurred:
... error details ...
Recovery suggestions: Try alternative approaches...
```

This bloats context rapidly with repeated errors.

### No Graceful Exit on Unrecoverable Errors

Tool errors still set `needsMoreWork: true`, forcing continuation even when:
- Permission denied (won't self-resolve)
- Resource not found (won't appear)
- Authentication failed (needs user action)

---

## Issue Category 5: Context Budget Problems

### Critical Information Loss via `drop_middle`

When context exceeds limits, strategy drops middle messages keeping only:
- System prompt
- First user message
- Last N messages (default 3, can drop to 1.5)

**Consequence**: Tool results from early iterations get discarded → `hasToolResultsSoFar` returns `false` → Agent gets nudged to use tools it already used → **Infinite loop**

### Conversation Growth Pattern

| Iteration | Context State | Risk |
|-----------|--------------|------|
| 1-2 | Fits fine | None |
| 3-5 | Growing (nudges, verifications) | Moderate |
| 6+ | Shrinking kicks in | Tool results lost |
| 7+ | Completion checks fail | Loop begins |

### Token Estimation Inaccuracy

Uses 4 chars ≈ 1 token estimate. Doesn't account for:
- JSON structure overhead
- Special characters / Unicode
- Tool schemas

Could trigger aggressive shrinking too early or allow context overflow.

---

## Recommendations Summary

### High Priority Fixes

1. **Add `verificationFailCount++`** to ALL verification failure paths
2. **Track tool execution separately** from conversation history for `hasToolResultsSoFar`
3. **Add hard limit** on verification failures (force complete after 3-5)
4. **Preserve at least one tool result** in `drop_middle` strategy

### Medium Priority Fixes

1. **Unify `needsMoreWork` handling** - Return `undefined` for JSON without tool calls
2. **Track per-tool failure count** - Exclude tool after 3+ failures
3. **Soften verification prompt** - Accept "Let me know if..." as complete
4. **Add context warning** when aggressive shrinking occurs

### Code Quality

1. **Consolidate verification logic** into single helper function
2. **Consider state machine** for completion logic
3. **Add Langfuse spans** for each completion path entry

