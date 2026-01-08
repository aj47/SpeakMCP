# ACP Multi-Agent Router Simplification Plan

## Overview

The current PR (`feat/acp-multi-agent-router-v2`) adds ~11,000 LOC for multi-agent orchestration. This document outlines a plan to simplify the implementation by **removing the A2A protocol** (not needed) and **consolidating the remaining ACP code**.

### What We're Keeping
- **ACP (Agent Client Protocol)**: Stdio-based JSON-RPC for local agents (Auggie, Claude Code)
- **Internal Agent**: SpeakMCP sub-sessions (recursive delegation within same process)
- **Smart Router**: Capability-based routing decisions
- **UI Components**: Agent settings, delegation progress display

### What We're Removing
- **A2A (Agent-to-Agent Protocol)**: Google's HTTP-based protocol for remote agents
- **Webhook Server**: Push notifications for A2A (not needed without A2A)
- **A2A Task Manager**: Complex state management for remote tasks
- **A2A Agent Registry**: Discovery of remote agents

### Estimated Impact
- **Remove**: ~3,500 LOC
- **Simplify**: ~800 LOC reduction through consolidation
- **Final Savings**: ~4,300 LOC (from 11,243 to ~7,000)

---

## Architecture After Simplification

```
User Request
     │
     ▼
┌─────────────────────────────────────────────┐
│           ACP Router (Simplified)            │
│  - list_available_agents                     │
│  - delegate_to_agent                         │
│  - check_agent_status                        │
│  - spawn_agent / stop_agent                  │
│  - cancel_agent_run                          │
└─────────────────────────────────────────────┘
     │
     ├──────────────────┬──────────────────────┐
     ▼                  ▼                      ▼
┌──────────┐    ┌──────────────┐    ┌──────────────────┐
│ Internal │    │ ACP Stdio    │    │ (Future: Remote) │
│  Agent   │    │   Agents     │    │                  │
│          │    │              │    │                  │
│ SpeakMCP │    │ Auggie       │    │ HTTP-based       │
│ Sub-sess │    │ Claude Code  │    │ when needed      │
└──────────┘    └──────────────┘    └──────────────────┘
```

---

## Phase Breakdown

### Phase 1: Remove A2A Protocol (Independent - Can Start Immediately)

**Goal**: Delete all A2A-related code. No dependencies on other phases.

**Files to DELETE entirely**:
```
apps/desktop/src/main/a2a/a2a-client.ts           (687 lines)
apps/desktop/src/main/a2a/agent-registry.ts       (442 lines)
apps/desktop/src/main/a2a/task-manager.ts         (596 lines)
apps/desktop/src/main/a2a/webhook-server.ts       (353 lines)
apps/desktop/src/main/a2a/types.ts                (511 lines)
apps/desktop/src/main/a2a/a2a-router-tool-definitions.ts
apps/desktop/src/main/a2a/index.ts
```

**Files to MODIFY**:

1. **`apps/desktop/src/main/acp/acp-router-tools.ts`**
   - Remove imports from `../a2a`
   - Remove `handleA2ADelegation()` function (lines ~1318-1696)
   - Remove A2A checks in `handleDelegateToAgent()` (lines ~469-475)
   - Remove A2A handling in `handleCheckAgentStatus()` (lines ~767-811)
   - Remove `isA2A` flag handling throughout

2. **`apps/desktop/src/main/index.ts`**
   - Remove `initializeA2A()` call and import (lines ~151-163)
   - Remove A2A config handling

3. **`apps/desktop/src/main/acp/acp-smart-router.ts`**
   - Remove A2A agent imports and handling
   - Remove `isA2A` from `UnifiedAgent` interface
   - Remove `a2aAgentRegistry` usage

4. **`apps/desktop/src/shared/types.ts`**
   - Remove `A2AConfig` type if present
   - Remove `isA2A` from `ACPSubAgentState` if present

5. **`apps/desktop/src/main/config.ts`**
   - Remove `a2aConfig` from config schema if present

**Testing**: After removal, verify:
- [ ] App starts without errors
- [ ] Internal agent delegation works
- [ ] ACP stdio agent delegation works (if Auggie/Claude Code configured)
- [ ] TypeScript compiles with no errors

---

### Phase 2: Consolidate Delegation Handlers (Depends on Phase 1)

**Goal**: Merge the two remaining delegation handlers into a cleaner pattern.

**Current State** (after Phase 1):
- `handleInternalAgentDelegation()` - for internal sub-sessions
- `handleDelegateToAgent()` - for ACP stdio agents

Both share ~80% of the same logic:
1. Create run tracking state
2. Set up conversation
3. Execute (sync or async)
4. Track completion
5. Emit progress

**Changes to `apps/desktop/src/main/acp/acp-router-tools.ts`**:

1. Create a unified execution flow:
```typescript
async function handleDelegateToAgent(args, parentSessionId) {
  const runId = generateDelegationRunId();
  const subAgentState = createSubAgentState(runId, args, parentSessionId);
  
  // Determine executor type
  if (args.agentName === 'internal') {
    return executeInternalAgent(subAgentState, args);
  } else {
    return executeACPStdioAgent(subAgentState, args);
  }
}
```

2. Extract shared logic into helper functions:
   - `createSubAgentState(runId, args, parentSessionId): ACPSubAgentState`
   - `initializeConversation(runId, task): void`
   - `finalizeRun(runId, status, result): DelegationResult`

3. Simplify `executeInternalAgent()` and `executeACPStdioAgent()` to only contain protocol-specific logic

**Estimated reduction**: ~200-300 lines

---

### Phase 3: Simplify Run State Management (Depends on Phase 2)

**Goal**: Clean up the scattered state tracking Maps.

**Current State**:
```typescript
const delegatedRuns: Map<string, ACPSubAgentState> = new Map();
const sessionConversations: Map<string, ACPSubAgentMessage[]> = new Map();
const sessionToRunId: Map<string, string> = new Map();
const agentNameToActiveRunIds: Map<string, Set<string>> = new Map();
const lastEmitTime: Map<string, number> = new Map();
```

**Changes**:

1. Consolidate into a single `DelegatedRun` type that includes conversation:
```typescript
interface DelegatedRun extends ACPSubAgentState {
  conversation: ACPSubAgentMessage[];
  lastEmitTime: number;
}
const delegatedRuns: Map<string, DelegatedRun> = new Map();
```

2. Remove `sessionConversations` Map - store conversation inside `DelegatedRun`

3. Keep `sessionToRunId` for ACP session mapping (still needed for stdio agents)

4. Consider removing `agentNameToActiveRunIds` if session mapping is reliable

**Estimated reduction**: ~100-150 lines

---

### Phase 4: Clean Up Types (Can Run Parallel to Phase 3)

**Goal**: Remove unused A2A types and simplify remaining types.

**Files to modify**:

1. **`apps/desktop/src/main/acp/types.ts`**
   - Remove any A2A-related type references
   - Ensure `ACPSubAgentState` is clean and well-documented

2. **`apps/desktop/src/shared/types.ts`**
   - Remove `A2AConfig` and any A2A-related exports
   - Keep `ACPAgentConfig`, `ACPDelegationProgress`, `ACPSubAgentMessage`

3. **`apps/desktop/src/main/acp/acp-smart-router.ts`**
   - Simplify `UnifiedAgent` interface (remove `isA2A`, `baseUrl`)
   - Remove A2A-specific matching logic

---

## Detailed File-by-File Changes

### Files to DELETE (Phase 1)

| File | Lines | Notes |
|------|-------|-------|
| `src/main/a2a/a2a-client.ts` | 687 | A2A HTTP client |
| `src/main/a2a/agent-registry.ts` | 442 | A2A agent discovery |
| `src/main/a2a/task-manager.ts` | 596 | A2A task state |
| `src/main/a2a/webhook-server.ts` | 353 | Push notifications |
| `src/main/a2a/types.ts` | 511 | A2A type definitions |
| `src/main/a2a/a2a-router-tool-definitions.ts` | ~50 | A2A tool defs |
| `src/main/a2a/index.ts` | 36 | A2A exports |
| **Total** | **~2,675** | |

### Files to MODIFY

#### `apps/desktop/src/main/acp/acp-router-tools.ts` (Currently 1,772 lines)

**Phase 1 Removals**:
- Lines 23-25: Remove A2A imports
- Lines 469-475: Remove A2A agent check in `handleDelegateToAgent`
- Lines 767-811: Remove A2A status handling in `handleCheckAgentStatus`
- Lines 1318-1696: Remove entire `handleA2ADelegation` function (~378 lines)

**Phase 2 Consolidation**:
- Merge internal agent delegation logic into main handler
- Extract shared helpers

**Expected final size**: ~1,100-1,200 lines

#### `apps/desktop/src/main/acp/acp-smart-router.ts` (Currently 643 lines)

**Phase 1 Removals**:
- Line 23: Remove A2A registry import
- Lines 37-50: Simplify `UnifiedAgent` interface
- Remove `isA2A` and `baseUrl` from routing

**Expected final size**: ~550-580 lines

#### `apps/desktop/src/main/index.ts`

**Phase 1 Removals**:
- Remove A2A initialization block (lines ~151-163)
- Remove A2A imports

---

## Parallelization Strategy

```
                    ┌─────────────┐
                    │   Phase 1   │
                    │  Remove A2A │
                    │ (BLOCKING)  │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌───────────┐    ┌───────────┐    ┌───────────┐
   │  Phase 2  │    │  Phase 4  │    │  Testing  │
   │ Consolidate│    │Clean Types│    │  & QA     │
   │ Handlers  │    │(parallel) │    │           │
   └─────┬─────┘    └───────────┘    └───────────┘
         │
         ▼
   ┌───────────┐
   │  Phase 3  │
   │ Simplify  │
   │Run State  │
   └───────────┘
```

**Sub-agent Assignment**:

| Phase | Can Parallelize? | Suggested Agent Task |
|-------|------------------|---------------------|
| Phase 1 | No (must be first) | "Remove all A2A protocol code" |
| Phase 2 | After Phase 1 | "Consolidate delegation handlers" |
| Phase 3 | After Phase 2 | "Simplify run state management" |
| Phase 4 | After Phase 1 (parallel with 2) | "Clean up types" |

---

## Verification Checklist

After all phases complete:

### Functionality
- [ ] Internal agent delegation works (delegate to "internal")
- [ ] ACP stdio agent delegation works (delegate to configured agents)
- [ ] Agent status checking works
- [ ] Agent spawning/stopping works
- [ ] Agent cancellation works
- [ ] UI shows delegation progress correctly

### Code Quality
- [ ] TypeScript compiles with no errors
- [ ] No unused imports
- [ ] No dead code paths
- [ ] Tests pass (run existing ACP tests)

### Performance
- [ ] App startup is not slower
- [ ] Delegation latency is not increased

---

## Rollback Plan

If issues arise:
1. Phase 1 is atomic - can revert the A2A deletion commit
2. Phases 2-4 are incremental refactors - can revert individually

---

## Notes for AI Coding Agent

### Key Files to Understand First
1. `apps/desktop/src/main/acp/acp-router-tools.ts` - Main delegation logic
2. `apps/desktop/src/main/acp-service.ts` - ACP stdio protocol
3. `apps/desktop/src/main/acp/internal-agent.ts` - Internal sub-sessions
4. `apps/desktop/src/shared/types.ts` - Shared type definitions

### Common Patterns in Codebase
- Uses `configStore.get()` for configuration
- Uses `emitAgentProgress()` for UI updates
- Uses `logACPRouter()` / `logApp()` for logging
- Tool handlers return `{ success: boolean, ...data }` objects

### Testing Commands
```bash
# Type check
pnpm typecheck

# Run tests
pnpm test

# Build
pnpm build
```

