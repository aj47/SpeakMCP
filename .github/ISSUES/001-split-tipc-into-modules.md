# [Refactor] Split tipc.ts into domain-specific modules

## Problem

`tipc.ts` is currently **2,910 LOC** - a single monolithic file containing all IPC handlers for the entire application. This makes it difficult to:
- Navigate and understand the codebase
- Test individual handlers
- Avoid merge conflicts when multiple features touch IPC

## Current State

All RPC endpoints are defined in one giant object in `apps/desktop/src/main/tipc.ts`:
- MCP handlers (init, execute, tools)
- Config handlers (get, save, reset)
- Agent handlers (start, stop, progress)
- Conversation handlers (CRUD operations)
- Recording handlers
- Window handlers
- And more...

## Proposed Solution

Split into domain-specific modules:

```
apps/desktop/src/main/ipc/
├── index.ts              # Main router combining all handlers
├── mcp-handlers.ts       # MCP initialization, tool execution
├── config-handlers.ts    # Configuration CRUD
├── agent-handlers.ts     # Agent mode, progress updates
├── conversation-handlers.ts  # Conversation management
├── recording-handlers.ts # Audio recording
└── window-handlers.ts    # Window management
```

### Example Structure

```typescript
// ipc/mcp-handlers.ts
export const mcpHandlers = {
  'mcp:init': async () => { ... },
  'mcp:execute-tool': async (toolCall) => { ... },
  'mcp:get-tools': async () => { ... },
}

// ipc/index.ts
import { mcpHandlers } from './mcp-handlers'
import { configHandlers } from './config-handlers'
import { agentHandlers } from './agent-handlers'

export const router = {
  ...mcpHandlers,
  ...configHandlers,
  ...agentHandlers,
}
```

## Benefits

- **Single Responsibility**: Each file handles one domain
- **Easier Testing**: Can test handlers in isolation
- **Better Code Navigation**: Find handlers by domain
- **Reduced Merge Conflicts**: Changes isolated to specific domains
- **Target**: No file exceeds 500 LOC

## Acceptance Criteria

- [ ] Create `ipc/` directory structure
- [ ] Extract MCP handlers (~500 LOC)
- [ ] Extract config handlers (~300 LOC)
- [ ] Extract agent handlers (~400 LOC)
- [ ] Extract conversation handlers (~300 LOC)
- [ ] Extract recording handlers (~200 LOC)
- [ ] Extract window handlers (~200 LOC)
- [ ] Create main router that combines all handlers
- [ ] Update imports throughout codebase
- [ ] All existing tests pass

## Labels

`refactor`, `tech-debt`, `maintainability`
