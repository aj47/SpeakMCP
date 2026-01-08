# ACP UI Enhancement Plan

## Overview

This plan adds rich ACP session metadata to the UI that is currently logged but not displayed.

### Missing Data Summary

| Category | Source | Data |
|----------|--------|------|
| Agent Info | `initialize` response | name, title, version |
| Models | `session/new` response | availableModels[], currentModelId |
| Modes | `session/new` response | availableModes[], currentModeId |
| Commands | `session/update` notification | name, description, input hints |
| Tool Stats | `session/update` toolResponse | durationMs, tokens, agentId |

---

## Phase 1: Type Definitions (No Dependencies)

> **Parallelizable:** All tasks in this phase can run simultaneously.

### Task 1.1: Extend Shared Types
**File:** `apps/desktop/src/shared/types.ts`

Add to `AgentProgressStep`:
```typescript
executionStats?: {
  durationMs?: number
  totalTokens?: number
  toolUseCount?: number
  inputTokens?: number
  outputTokens?: number
  cacheHitTokens?: number
}
subagentId?: string
```

Add to `AgentProgressUpdate`:
```typescript
acpSessionInfo?: {
  agentName?: string
  agentTitle?: string
  agentVersion?: string
  currentModel?: string
  currentMode?: string
  availableModels?: Array<{ id: string; name: string; description?: string }>
  availableModes?: Array<{ id: string; name: string; description?: string }>
}
```

### Task 1.2: Extend ACP Service Types
**File:** `apps/desktop/src/main/acp-service.ts`

Add to `ACPAgentInstance`:
```typescript
agentInfo?: {
  name: string
  title: string
  version: string
}
sessionInfo?: {
  models?: {
    availableModels: Array<{ modelId: string; name: string; description?: string }>
    currentModelId: string
  }
  modes?: {
    availableModes: Array<{ id: string; name: string; description?: string }>
    currentModeId: string
  }
}
```

---

## Phase 2: Backend Data Capture (Depends on Phase 1)

> **Parallelizable:** Tasks 2.1, 2.2, 2.3 can run in parallel after Phase 1.

### Task 2.1: Capture Initialize Response
**File:** `apps/desktop/src/main/acp-service.ts`
**Function:** `initializeAgent()`

Parse and store `agentInfo` from the initialize response:
```typescript
if (result?.agentInfo) {
  instance.agentInfo = {
    name: result.agentInfo.name,
    title: result.agentInfo.title,
    version: result.agentInfo.version,
  }
}
```

### Task 2.2: Capture Session/New Response  
**File:** `apps/desktop/src/main/acp-service.ts`
**Function:** `createSession()`

Parse and store `models` and `modes` from session/new response:
```typescript
const result = await this.sendRequest(agentName, "session/new", {...})
if (result?.models) {
  instance.sessionInfo = {
    ...instance.sessionInfo,
    models: result.models,
  }
}
if (result?.modes) {
  instance.sessionInfo = {
    ...instance.sessionInfo,
    modes: result.modes,
  }
}
```

### Task 2.3: Parse Tool Response Metadata
**File:** `apps/desktop/src/main/acp-service.ts`
**Function:** `handleSessionUpdate()`

Extract `_meta.claudeCode.toolResponse` stats:
```typescript
const meta = params.update?._meta?.claudeCode
if (meta?.toolResponse) {
  const { totalDurationMs, totalTokens, agentId, usage } = meta.toolResponse
  // Emit with toolCallUpdate event
}
```

---

## Phase 3: Progress Emission (Depends on Phase 2)

### Task 3.1: Forward ACP Info in Progress Updates
**File:** `apps/desktop/src/main/acp-main-agent.ts`

Add helper to get ACP session info from service:
```typescript
// Get agent info from acpService
const agentInstance = acpService.getAgentInstance(agentName)
const acpSessionInfo = {
  agentName: agentInstance?.agentInfo?.name,
  agentTitle: agentInstance?.agentInfo?.title,
  agentVersion: agentInstance?.agentInfo?.version,
  currentModel: agentInstance?.sessionInfo?.models?.currentModelId,
  currentMode: agentInstance?.sessionInfo?.modes?.currentModeId,
}
```

Include in `emitProgress()` calls.

---

## Phase 4: UI Components (Depends on Phase 1 types only)

> **Parallelizable:** All UI tasks can run in parallel, depending only on Phase 1.

### Task 4.1: Create ACP Session Info Badge
**File:** `apps/desktop/src/renderer/src/components/acp-session-badge.tsx` (NEW)

Compact badge component showing agent info:
```tsx
interface ACPSessionBadgeProps {
  info: {
    agentTitle?: string
    agentVersion?: string
    currentModel?: string
    currentMode?: string
  }
  className?: string
}
```

Visual: `[Claude Code v0.12.6] [Sonnet 4.5]`

Use existing: `Badge` from `ui/badge.tsx`, `Tooltip` from `ui/tooltip.tsx`

### Task 4.2: Create Tool Execution Stats Display
**File:** `apps/desktop/src/renderer/src/components/tool-execution-stats.tsx` (NEW)

Inline stats for tool calls:
```tsx
interface ToolExecutionStatsProps {
  stats: {
    durationMs?: number
    totalTokens?: number
    model?: string
  }
  subagentId?: string
  compact?: boolean
}
```

Visual (compact): `haiku • 3.1s • 17k tokens`
Visual (expanded): Full breakdown with cache stats

### Task 4.3: Enhance Session Tile Footer
**File:** `apps/desktop/src/renderer/src/components/session-tile.tsx`
**Location:** Footer section (~line 398-427)

Add ACP session info next to existing `profileName` and `modelInfo`:
```tsx
{progress?.acpSessionInfo?.agentTitle && (
  <span className="text-[10px] truncate max-w-[80px]">
    {progress.acpSessionInfo.agentTitle}
  </span>
)}
```

### Task 4.4: Enhance Tool Call Bubbles with Stats
**File:** `apps/desktop/src/renderer/src/components/agent-progress.tsx`
**Component:** `AssistantWithToolsBubble` (~line 560)

When tool has `executionStats`, show inline:
```tsx
{data.executionStats && (
  <ToolExecutionStats stats={data.executionStats} compact />
)}
```

---

## Phase 5: Integration & Testing (Depends on Phases 3 + 4)

### Task 5.1: Wire Up Components
Ensure progress updates flow from backend → store → components.

### Task 5.2: Add Getter to ACP Service
**File:** `apps/desktop/src/main/acp-service.ts`

Add public method to retrieve agent instance info:
```typescript
getAgentInstance(agentName: string): ACPAgentInstance | undefined {
  return this.agents.get(agentName)
}
```

---

## Dependency Graph

```
Phase 1 (Types)
    ├── Task 1.1 ──┬──► Phase 2 (Backend)
    └── Task 1.2 ──┤       ├── Task 2.1 ──┐
                   │       ├── Task 2.2 ──┼──► Phase 3 ──► Phase 5
                   │       └── Task 2.3 ──┘
                   │
                   └──► Phase 4 (UI) ─────────────────────► Phase 5
                           ├── Task 4.1
                           ├── Task 4.2
                           ├── Task 4.3
                           └── Task 4.4
```

---

## Parallel Execution Strategy

| Subagent | Tasks | Dependencies |
|----------|-------|--------------|
| **Agent A** | 1.1, 1.2 | None |
| **Agent B** | 2.1, 2.2, 2.3, 3.1, 5.2 | Wait for Agent A |
| **Agent C** | 4.1, 4.2 | Wait for Agent A (types only) |
| **Agent D** | 4.3, 4.4 | Wait for Agent A (types only) |
| **Agent E** | 5.1 | Wait for Agents B, C, D |

---

## Files Modified Summary

| File | Tasks |
|------|-------|
| `apps/desktop/src/shared/types.ts` | 1.1 |
| `apps/desktop/src/main/acp-service.ts` | 1.2, 2.1, 2.2, 2.3, 5.2 |
| `apps/desktop/src/main/acp-main-agent.ts` | 3.1 |
| `apps/desktop/src/renderer/src/components/acp-session-badge.tsx` | 4.1 (NEW) |
| `apps/desktop/src/renderer/src/components/tool-execution-stats.tsx` | 4.2 (NEW) |
| `apps/desktop/src/renderer/src/components/session-tile.tsx` | 4.3 |
| `apps/desktop/src/renderer/src/components/agent-progress.tsx` | 4.4 |

---

## Visual Reference

### Session Tile Footer (After)
```
┌──────────────────────────────────────────────────────────┐
│ Profile1 • Claude Code • Sonnet 4.5 • Step 3/10         │
└──────────────────────────────────────────────────────────┘
```

### Tool Call with Stats (Compact)
```
🔧 Task: Say hello ✓
   └─ haiku • 3.1s • 17k tokens • agent:a6a4f4d
```

### Tool Call Stats (Expanded)
```
┌─ Execution Stats ────────────────────┐
│ Duration:      3,062 ms              │
│ Model:         haiku                 │
│ Input tokens:  16,958 (16,955 cache) │
│ Output tokens: 185                   │
│ Agent ID:      a6a4f4d (resumable)   │
└──────────────────────────────────────┘
```

