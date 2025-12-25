# [Refactor] Break down mcp-service.ts into focused modules

## Problem

`mcp-service.ts` is **2,722 LOC** handling too many responsibilities:
- MCP client lifecycle management
- Multiple transport types (stdio, WebSocket, HTTP)
- OAuth integration
- Tool execution and result processing
- Resource tracking
- Server logs management
- Profile-based filtering

This violates the Single Responsibility Principle and makes the code hard to maintain.

## Current State

The `MCPService` class handles:
1. **Transport Management** (~400 LOC)
   - `createTransport()`, `createStreamableHttpTransport()`
   - Transport type inference

2. **OAuth Integration** (~300 LOC)
   - `handle401AndRetryWithOAuth()`
   - `getOrCreateOAuthClient()`
   - OAuth flow methods

3. **Server Lifecycle** (~500 LOC)
   - `initialize()`, `initializeServer()`
   - `stopServer()`, `restartServer()`
   - `cleanupServer()`

4. **Tool Execution** (~400 LOC)
   - `executeToolCall()`, `executeServerTool()`
   - Parameter fixing, result filtering

5. **Resource Tracking** (~200 LOC)
   - `trackResource()`, `cleanupInactiveResources()`

6. **Profile Management** (~300 LOC)
   - `applyProfileMcpConfig()`
   - `getAvailableToolsForProfile()`

## Proposed Solution

Split into focused modules with clear boundaries:

```
apps/desktop/src/main/mcp/
├── index.ts                # Re-exports, singleton instance
├── MCPService.ts           # Core orchestration (~500 LOC)
├── transport/
│   ├── index.ts
│   ├── stdio.ts            # Stdio transport handling
│   ├── websocket.ts        # WebSocket transport
│   └── http.ts             # StreamableHTTP + OAuth
├── oauth/
│   ├── index.ts
│   ├── integration.ts      # OAuth flow for MCP servers
│   └── token-manager.ts    # Token refresh, storage
├── tools/
│   ├── index.ts
│   ├── executor.ts         # Tool execution logic
│   ├── parameter-fixer.ts  # Arg normalization
│   └── response-filter.ts  # Result processing
├── resources/
│   └── tracker.ts          # Resource lifecycle tracking
└── types.ts                # MCP-specific types
```

### Core MCPService Becomes Orchestrator

```typescript
// mcp/MCPService.ts
class MCPService {
  private transportManager: TransportManager
  private toolExecutor: ToolExecutor
  private resourceTracker: ResourceTracker

  async initialize() { ... }
  async executeToolCall(call) {
    return this.toolExecutor.execute(call)
  }
}
```

## Benefits

- **Testable Units**: Each module can be tested independently
- **Clear Dependencies**: Explicit imports show relationships
- **Easier OAuth Changes**: OAuth logic isolated
- **Transport Flexibility**: Easy to add new transports
- **Reduced Cognitive Load**: Each file has one job

## Acceptance Criteria

- [ ] Create `mcp/` directory structure
- [ ] Extract transport management
- [ ] Extract OAuth integration
- [ ] Extract tool execution
- [ ] Extract resource tracking
- [ ] Slim down MCPService to orchestrator role
- [ ] Update all imports
- [ ] Add unit tests for new modules
- [ ] No file exceeds 500 LOC

## Labels

`refactor`, `tech-debt`, `mcp`
