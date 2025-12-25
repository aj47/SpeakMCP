# SpeakMCP Refactoring Issues

Copy-paste these to create GitHub issues, or run the gh commands at the bottom.

---

## 🔴 CRITICAL PRIORITY

### Issue 1: Fix React version mismatch between desktop and mobile

**Labels:** `bug`, `priority: critical`

**Description:**

Desktop and mobile apps use different major React versions:

```
Desktop: React 18.3.1
Mobile:  React 19.1.0
```

React 19 has breaking changes from React 18. Shared code in `@speakmcp/shared` may behave differently across platforms.

**Files Affected:**
- `apps/desktop/package.json`
- `apps/mobile/package.json`

**Recommended Fix:**
Standardize on one React version across both apps (suggest React 19 as it's newer, or React 18 for stability).

**Risk:** High - Different behavior in shared components, potential runtime errors.

---

### Issue 2: Remove duplicate type definitions (3 locations)

**Labels:** `refactor`, `priority: critical`, `good first issue`

**Description:**

Type definitions are duplicated across 3 locations, creating maintenance burden and sync issues:

| Type | Location 1 | Location 2 | Location 3 |
|------|-----------|-----------|-----------|
| `QueuedMessage` | `packages/shared/types.ts:61` | `apps/desktop/shared/types.ts` | — |
| `AgentProgressStep` | `packages/shared/types.ts:107` | `apps/desktop/shared/types.ts` | `apps/mobile/openaiClient.ts:57` |
| `AgentProgressUpdate` | `packages/shared/types.ts:124` | `apps/desktop/shared/types.ts` | `apps/mobile/openaiClient.ts` |
| `MessageQueue` | `packages/shared/types.ts:75` | `apps/desktop/shared/types.ts` | — |

**Files Affected:**
- `packages/shared/src/types.ts` (canonical source)
- `apps/desktop/src/shared/types.ts` (remove duplicates)
- `apps/mobile/src/lib/openaiClient.ts` (remove duplicates)

**Recommended Fix:**
1. Keep types only in `packages/shared/src/types.ts`
2. Update desktop to import from `@speakmcp/shared`
3. Update mobile to import from shared package
4. Delete duplicate definitions

**Risk:** Low - Safe refactor, just import changes.

---

### Issue 3: Fix runtime dependencies misclassified as devDependencies

**Labels:** `bug`, `priority: critical`, `good first issue`

**Description:**

In `apps/desktop/package.json`, runtime dependencies are incorrectly in `devDependencies`:

```
react, react-dom, react-router-dom
@radix-ui/react-dialog, @radix-ui/react-select, @radix-ui/react-switch, etc.
lucide-react, sonner, dayjs, clsx, class-variance-authority
```

Note: Some Radix packages are in `dependencies` while others are in `devDependencies` - inconsistent.

**Files Affected:**
- `apps/desktop/package.json`

**Recommended Fix:**
Move all listed packages from `devDependencies` to `dependencies`.

**Risk:** Low

---

## 🟠 HIGH PRIORITY

### Issue 4: Split tipc.ts into domain-specific routers (2,910 lines → 6 files)

**Labels:** `refactor`, `priority: high`, `tech-debt`

**Description:**

`apps/desktop/src/main/tipc.ts` is a 2,910-line god object with 123 RPC procedures handling unrelated concerns:
- Window management (15+ procedures)
- MCP configuration (25+ procedures)
- Profile management (20+ procedures)
- Agent sessions (15+ procedures)
- TTS generation (8+ procedures)
- Conversation management (8+ procedures)
- Tunneling, OAuth, diagnostics, etc.

**Files Affected:**
- `apps/desktop/src/main/tipc.ts`

**Recommended Structure:**
```
src/main/routers/
├── window-router.ts       (panel/window management)
├── mcp-config-router.ts   (servers, tools, OAuth)
├── profile-router.ts      (CRUD, export/import)
├── agent-router.ts        (sessions, approvals)
├── tts-router.ts          (speech generation)
├── conversation-router.ts (history, messages)
└── index.ts               (combines routers)
```

**Risk:** Medium - Requires careful extraction but improves maintainability significantly.

---

### Issue 5: Split mcp-service.ts into focused services (2,720 lines → 5 files)

**Labels:** `refactor`, `priority: high`, `tech-debt`

**Description:**

`apps/desktop/src/main/mcp-service.ts` is a 2,720-line god object doing 7 different jobs:
1. Server lifecycle management
2. Tool execution
3. Response processing (truncation, summarization)
4. OAuth authentication
5. Resource tracking
6. Configuration management
7. Logging

The class has 60+ methods and 7 different Map/Set state containers.

**Files Affected:**
- `apps/desktop/src/main/mcp-service.ts`

**Recommended Structure:**
```
src/main/mcp/
├── mcp-service.ts            (slimmed - lifecycle only)
├── mcp-oauth-manager.ts      (OAuth flow, ~300 lines)
├── mcp-response-processor.ts (truncation/summarization, ~200 lines)
├── mcp-resource-tracker.ts   (resource lifecycle, ~100 lines)
└── mcp-tool-executor.ts      (tool execution logic)
```

**Risk:** Medium - Core service, needs careful refactoring.

---

### Issue 6: Extract ServerDialog from mcp-config-manager.tsx (2,593 lines)

**Labels:** `refactor`, `priority: high`

**Description:**

`apps/desktop/src/renderer/src/components/mcp-config-manager.tsx` contains:
- A 690-line nested `ServerDialog` component (lines 161-851)
- 58+ useState hooks in the main component
- Complex form state that should use useReducer

**Files Affected:**
- `apps/desktop/src/renderer/src/components/mcp-config-manager.tsx`

**Recommended Fix:**
1. Extract `ServerDialog` to `components/server-dialog.tsx`
2. Convert 58 useState hooks to useReducer
3. Move `MCP_EXAMPLES` to `lib/mcp-examples.ts`

**Risk:** Low-Medium

---

### Issue 7: Extract nested components from agent-progress.tsx (2,309 lines)

**Labels:** `refactor`, `priority: high`

**Description:**

`apps/desktop/src/renderer/src/components/agent-progress.tsx` has 7 component definitions in one file:
- `CompactMessage` (lines 83-420)
- `ToolExecutionBubble` (lines 423-655)
- `AssistantWithToolsBubble` (lines 659-829)
- `ToolApprovalBubble` (lines 858-1000)
- `RetryStatusBanner` (lines 1000-1067)
- `StreamingContentBubble` (lines 1067-1100)
- `AgentProgress` (main component)

**Files Affected:**
- `apps/desktop/src/renderer/src/components/agent-progress.tsx`

**Recommended Structure:**
```
components/agent-progress/
├── index.tsx               (main AgentProgress)
├── CompactMessage.tsx
├── ToolExecutionBubble.tsx
├── ToolApprovalBubble.tsx
├── StreamingContentBubble.tsx
└── types.ts                (shared props/types)
```

**Risk:** Low - Components already exist, just need extraction.

---

### Issue 8: Refactor ChatScreen.tsx (mobile) - 2,695 lines with 100+ hooks

**Labels:** `refactor`, `priority: high`

**Description:**

`apps/mobile/src/screens/ChatScreen.tsx` has:
- 100+ useState/useRef declarations
- Complex state management inline
- Should extract custom hooks

**Files Affected:**
- `apps/mobile/src/screens/ChatScreen.tsx`

**Recommended Fix:**
1. Extract `useChatState()` hook for message state
2. Extract `useConnectionState()` hook for server connection
3. Extract `useRecordingState()` hook for audio recording
4. Consider useReducer for complex state

**Risk:** Medium

---

## 🟡 MEDIUM PRIORITY

### Issue 9: Create shared status color utility (22+ repeated patterns)

**Labels:** `refactor`, `priority: medium`, `good first issue`

**Description:**

This color pattern appears 22+ times across components:

```tsx
isPending
  ? "border-blue-200/50 bg-blue-50/30 text-blue-800 dark:border-blue-700/50..."
  : isSuccess
    ? "border-green-200/50 bg-green-50/30 text-green-800 dark:border-green-700/50..."
    : "border-red-200/50 bg-red-50/30 text-red-800 dark:border-red-700/50..."
```

**Files Affected:**
- `apps/desktop/src/renderer/src/components/agent-progress.tsx` (lines 302, 507, 616, 736, etc.)
- Multiple other components

**Recommended Fix:**
Create `src/renderer/src/lib/status-classes.ts`:
```tsx
export const statusClasses = {
  pending: "border-blue-200/50 bg-blue-50/30...",
  success: "border-green-200/50 bg-green-50/30...",
  error: "border-red-200/50 bg-red-50/30...",
}

export function getStatusClass(status: 'pending' | 'success' | 'error') {
  return statusClasses[status]
}
```

**Risk:** Low

---

### Issue 10: Extract duplicated formatTime utility

**Labels:** `refactor`, `priority: medium`, `good first issue`

**Description:**

Identical `formatTime()` function in 2 locations:

```tsx
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
```

**Files Affected:**
- `apps/desktop/src/renderer/src/components/message-queue-panel.tsx:73`
- `apps/mobile/src/ui/MessageQueuePanel.tsx:59`

**Recommended Fix:**
Add to `packages/shared/src/utils.ts` and import in both locations.

**Risk:** Low

---

### Issue 11: Replace prop drilling with React Context in mcp-config-manager

**Labels:** `refactor`, `priority: medium`

**Description:**

`mcp-config-manager.tsx` passes collapse state through 4 props:

```tsx
interface MCPConfigManagerProps {
  collapsedToolServers?: string[]
  collapsedServers?: string[]
  onCollapsedToolServersChange?: (servers: string[]) => void
  onCollapsedServersChange?: (servers: string[]) => void
}
```

**Files Affected:**
- `apps/desktop/src/renderer/src/components/mcp-config-manager.tsx`

**Recommended Fix:**
Create `CollapseStateContext` to manage expanded/collapsed state without prop drilling.

**Risk:** Low

---

### Issue 12: Create useCollapsibleState hook (duplicate logic in 6+ places)

**Labels:** `refactor`, `priority: medium`, `good first issue`

**Description:**

This Set-based toggle pattern appears in 6+ locations:

```tsx
const toggleExpansion = (id: string) => {
  setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
}
```

**Files Affected:**
- `apps/desktop/src/renderer/src/components/mcp-config-manager.tsx` (lines 1389, 1721)
- `apps/desktop/src/renderer/src/components/agent-progress.tsx`
- Other components

**Recommended Fix:**
Create `hooks/useCollapsibleState.ts`:
```tsx
export function useCollapsibleState(initialCollapsed: string[] = []) {
  const [collapsed, setCollapsed] = useState(new Set(initialCollapsed))
  const toggle = (id: string) => { ... }
  const isCollapsed = (id: string) => collapsed.has(id)
  return { collapsed, toggle, isCollapsed }
}
```

**Risk:** Low

---

### Issue 13: Extract session aggregation logic from panel.tsx

**Labels:** `refactor`, `priority: medium`

**Description:**

`apps/desktop/src/renderer/src/pages/panel.tsx` has 60+ lines of session aggregation logic inline (lines 51-114).

**Files Affected:**
- `apps/desktop/src/renderer/src/pages/panel.tsx`

**Recommended Fix:**
Extract to `hooks/useSessionAggregation.ts`:
```tsx
export function useSessionAggregation(agentProgressById: Map<...>) {
  return useMemo(() => ({
    activeCount,
    visibleCount,
    hasMultipleSessions,
    ...
  }), [agentProgressById])
}
```

**Risk:** Low

---

## 🟢 LOW PRIORITY

### Issue 14: Remove unused @google/generative-ai dependency

**Labels:** `cleanup`, `priority: low`, `good first issue`

**Description:**

`@google/generative-ai: ^0.21.0` is listed in desktop dependencies but no imports were found in the codebase.

**Files Affected:**
- `apps/desktop/package.json`

**Recommended Fix:**
1. Verify the package is truly unused: `grep -r "generative-ai" apps/desktop/src/`
2. If unused, remove from package.json

**Risk:** Low

---

### Issue 15: Consolidate TypeScript version across packages

**Labels:** `cleanup`, `priority: low`

**Description:**

TypeScript versions are inconsistent:
```
Shared:   typescript ^5.0.0  (too loose - allows up to 6.x)
Desktop:  typescript ^5.6.3
Mobile:   typescript ~5.9.2  (strict)
```

**Files Affected:**
- `packages/shared/package.json`
- `apps/desktop/package.json`
- `apps/mobile/package.json`

**Recommended Fix:**
Standardize on `typescript: ~5.9.2` across all packages.

**Risk:** Low

---

### Issue 16: Move linting/formatting tools to root package.json

**Labels:** `cleanup`, `priority: low`

**Description:**

`prettier` and `eslint` are only in desktop package, but should be shared across the monorepo.

**Files Affected:**
- Root `package.json`
- `apps/desktop/package.json`
- `apps/mobile/package.json`

**Recommended Fix:**
1. Move prettier, eslint to root devDependencies
2. Add missing tooling to mobile app
3. Create shared configs

**Risk:** Low

---

# Quick Commands (if you have gh CLI installed)

```bash
# Create labels first
gh label create "priority: critical" --color "B60205" --description "Must fix immediately"
gh label create "priority: high" --color "D93F0B" --description "Should fix soon"
gh label create "priority: medium" --color "FBCA04" --description "Fix when possible"
gh label create "priority: low" --color "0E8A16" --description "Nice to have"
gh label create "tech-debt" --color "5319E7" --description "Technical debt reduction"

# Then create issues (examples)
gh issue create --title "🔴 Fix React version mismatch" --label "bug,priority: critical" --body "See REFACTORING_ISSUES.md #1"
gh issue create --title "🔴 Remove duplicate type definitions" --label "refactor,priority: critical,good first issue" --body "See REFACTORING_ISSUES.md #2"
# ... etc
```
