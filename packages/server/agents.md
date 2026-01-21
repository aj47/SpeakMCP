# @speakmcp/server - Agent Knowledge Base

## Architecture Overview

Standalone HTTP server extracting SpeakMCP's agent capabilities from the Electron app. Any frontend (mobile, web, CLI) can interact via REST API.

```
src/
├── config/          # Configuration layer (paths, defaults, env)
├── services/        # Core business logic
├── types/           # TypeScript interfaces
├── server.ts        # Fastify HTTP routes
└── index.ts         # CLI entry point
```

## Key Services

| Service | Purpose |
|---------|---------|
| `llm.ts` | Agent loop orchestration - iterative LLM + tool execution |
| `mcp-service.ts` | MCP client management, tool discovery, OAuth |
| `conversation-service.ts` | Conversation CRUD with JSON file persistence |
| `profile-service.ts` | Profile management with MCP server configs |
| `builtin-tools.ts` | Built-in tools (settings, profiles, commands) |
| `state.ts` | Session state, abort controllers, tool approvals |
| `system-prompts.ts` | Dynamic prompt construction with tools/guidelines |

## Agent Loop (`processTranscriptWithAgentMode`)

1. Create session with `agentSessionStateManager.createSession()`
2. Build system prompt with available tools and user guidelines
3. Call LLM with conversation history
4. If tool calls returned → execute tools → loop back to step 3
5. Detect completion (no tools, empty response, max iterations)
6. Cleanup session and return final response

**Kill switch**: `shouldStopSession()` checks allow graceful abort mid-loop.

## HTTP API Patterns

- **Auth**: Bearer token in `Authorization` header (401 on failure)
- **CORS**: Configurable origins, preflight handled automatically
- **Streaming**: SSE via `text/event-stream` for `/v1/chat/completions`

Key endpoints:
- `POST /v1/chat/completions` - Main agent endpoint
- `GET/POST /v1/profiles/*` - Profile management
- `GET /v1/mcp/servers` - MCP server status
- `PATCH /v1/settings` - Update settings
- `POST /v1/emergency-stop` - Kill all agents

## Configuration

Three layers (lowest to highest priority):
1. `defaults.ts` - Hardcoded defaults
2. Config file (`~/.speakmcp/config.json`)
3. Environment variables (`SPEAKMCP_*`)

Key env vars:
- `SPEAKMCP_PORT`, `SPEAKMCP_BIND`, `SPEAKMCP_AUTH_TOKEN`
- `SPEAKMCP_OPENAI_API_KEY`, `SPEAKMCP_GROQ_API_KEY`, `SPEAKMCP_GEMINI_API_KEY`

## Testing Approach

**228 tests with minimal mocking:**

1. **Pure functions** - No mocks needed (state.ts, system-prompts.ts)
2. **File system** - Use temp directories, mock only path functions
3. **HTTP endpoints** - Fastify's `.inject()` method, mock services
4. **Isolation** - `beforeEach`/`afterEach` for clean state

```bash
pnpm --filter @speakmcp/server test:run   # Run all tests
pnpm --filter @speakmcp/server test       # Watch mode
```

## Common Patterns

### Session Management
```typescript
const sessionId = agentSessionStateManager.createSession(conversationId, profile)
try {
  // ... agent loop
} finally {
  agentSessionStateManager.cleanupSession(sessionId)
}
```

### Tool Execution
```typescript
if (isBuiltinTool(toolName)) {
  return executeBuiltinTool(toolName, args)
}
return mcpService.callTool(serverName, toolName, args)
```

### Config Access
```typescript
const cfg = configStore.get() as Record<string, unknown>
const model = cfg.mcpToolsOpenaiModel || 'gpt-4o'
```

## Gotchas

- `profileService` uses singleton pattern - reset module cache in tests
- Conversation IDs must not contain path traversal sequences (`..`, `/`, `\`)
- Default profile cannot be deleted or have its name changed
- MCP servers filtered: `speakmcp-settings` is internal-only
- Empty LLM responses trigger early loop termination (prevent infinite loops)

## Tool Name Format

Tools use a `servername:toolname` format (e.g., `speakmcp-settings:list_mcp_servers`).

**LLM Provider Sanitization**: OpenAI/Groq reject colons in tool names:
- `sanitizeToolName()` converts `:` → `__COLON__` before sending to LLM
- `restoreToolName()` converts back for tool execution
- This happens transparently in `llm-fetch.ts`

**Builtin Tools**: All built-in tools are prefixed with `speakmcp-settings:`:
- `list_mcp_servers`, `toggle_mcp_server`
- `list_profiles`, `switch_profile`, `get_current_profile`
- `get_settings`, `execute_command`, `kill_all_agents`

**Critical**: `mcpService.getAvailableTools()` already includes builtin tools with proper prefix. Do NOT add `builtinTools` array separately or you'll get duplicate tools without prefixes.

## Debugging Tips

### Debug Flags
```bash
speakmcp-server --debug        # All debug logging
speakmcp-server -dl            # LLM calls only
speakmcp-server -dt            # Tool execution only
```

### Verify Tools Loading
Check server logs for:
```
hasTools: true, toolCount: 8   # ✅ Tools loaded correctly
hasTools: false, toolCount: 0  # ❌ No tools - check builtin-tools.ts imports
```

### Common Tool Errors
| Error | Cause |
|-------|-------|
| `Invalid tool name format: X` | Tool missing `servername:` prefix |
| `Tool not found` | Tool not in `getAvailableTools()` result |
| `toolCount: 0` | Builtin tools not imported in mcp-service.ts |

### Testing Tool Calls
```bash
# Test via curl
curl -s http://127.0.0.1:3211/v1/chat/completions \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "List MCP servers"}], "stream": false}'

# Direct tool call (bypasses LLM)
curl -X POST http://127.0.0.1:3211/mcp/tools/call \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"name": "speakmcp-settings:list_mcp_servers", "arguments": {}}'
```
