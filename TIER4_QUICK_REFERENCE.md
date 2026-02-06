# Tier 4 Quick Reference Tables

## G-08/G-15: Model Presets

### ModelPreset Interface
| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `id` | string | ✅ | Unique identifier (e.g., "builtin-openai", "custom-1234567890") |
| `name` | string | ✅ | Display name |
| `baseUrl` | string | ✅ | API endpoint URL |
| `apiKey` | string | ✅ | API authentication key |
| `isBuiltIn` | boolean | ❌ | true for built-in presets |
| `createdAt` | number | ❌ | Creation timestamp |
| `updatedAt` | number | ❌ | Last update timestamp |
| `mcpToolsModel` | string | ❌ | Model for MCP tool execution |
| `transcriptProcessingModel` | string | ❌ | Model for transcript post-processing |
| `summarizationModel` | string | ❌ | Model for dual-model summarization |

### Built-in Presets
| ID | Name | Base URL |
|----|------|----------|
| `builtin-openai` | OpenAI | https://api.openai.com/v1 |
| `builtin-groq` | Groq | https://api.groq.com/openai/v1 |
| `builtin-gemini` | Gemini | https://generativelanguage.googleapis.com/v1beta/openai/ |
| `builtin-perplexity` | Perplexity | https://api.perplexity.ai |

### Config Store Fields
```typescript
modelPresets?: ModelPreset[]        // Array of all presets
currentModelPresetId?: string       // Active preset ID
```

### Key Functions
| Function | Location | Purpose |
|----------|----------|---------|
| `getBuiltInModelPresets()` | shared/index.ts:176 | Returns built-in presets |
| `getActivePreset()` | main/config.ts:239 | Merges built-in + saved presets |
| `syncPresetToLegacyFields()` | main/config.ts:264 | Syncs to legacy config fields |
| `fetchModelsForPreset()` | main/models-service.ts:635 | Fetches models for preset |

---

## G-17: MCP Server Management

### Method Availability Matrix

| Method | Desktop | Server | HTTP Endpoint |
|--------|---------|--------|---------------|
| `restartServer()` | ✅ 2051 | ❌ | ❌ |
| `stopServer()` | ✅ 2411 | ❌ | ❌ |
| `getServerLogs()` | ✅ 2940 | ✅ 858 | ❌ |
| `clearServerLogs()` | ✅ 2947 | ✅ 862 | ❌ |
| `testServerConnection()` | ✅ 1896 | ✅ 1534 | ❌ |

### Method Signatures

#### restartServer()
```typescript
async restartServer(serverName: string): Promise<{ success: boolean; error?: string }>
```
- Stops server, then reinitializes with `allowAutoOAuth: true`
- Returns success/error status

#### stopServer()
```typescript
async stopServer(serverName: string): Promise<{ success: boolean; error?: string }>
```
- Closes client connection
- Cleans up transport and references
- Returns success/error status

#### getServerLogs()
```typescript
getServerLogs(serverName: string): ServerLogEntry[]
```
- Returns array of log entries (max 1000)
- Each entry: `{ timestamp: number; message: string }`

#### clearServerLogs()
```typescript
clearServerLogs(serverName: string): void
```
- Clears all logs for specified server
- No return value

#### testServerConnection()
```typescript
async testServerConnection(
  serverName: string,
  serverConfig: MCPServerConfig
): Promise<{ success: boolean; error?: string; toolCount?: number }>
```
- Validates transport type
- Creates temporary connection
- Returns success status and tool count

### Transport Types
| Type | Use Case | Validation |
|------|----------|-----------|
| `stdio` | Local command-based servers | Requires `command` and `args[]` |
| `websocket` | WebSocket connections | Requires valid `url` (ws:// or wss://) |
| `streamableHttp` | HTTP streaming | Requires valid `url` (http:// or https://) |

### ServerLogEntry Structure
```typescript
interface ServerLogEntry {
  timestamp: number  // Unix timestamp (milliseconds)
  message: string    // Log message (trimmed)
}
```

### Log Storage
- **Circular buffer**: Max 1000 entries per server
- **Oldest entries removed** when limit exceeded
- **Storage**: `Map<string, ServerLogEntry[]>`

### TIPC Handlers (Desktop)
```typescript
restartMcpServer: t.procedure.input<{ serverName: string }>()
stopMcpServer: t.procedure.input<{ serverName: string }>()
getMcpServerLogs: t.procedure.input<{ serverName: string }>()
clearMcpServerLogs: t.procedure.input<{ serverName: string }>()
```

### Missing HTTP Endpoints (Server Package)
```
POST   /v1/mcp/servers/:name/restart
POST   /v1/mcp/servers/:name/stop
GET    /v1/mcp/servers/:name/logs
DELETE /v1/mcp/servers/:name/logs
```

---

## File Locations Summary

### Desktop Implementation
- **Types**: `apps/desktop/src/shared/types.ts`
- **Config**: `apps/desktop/src/main/config.ts`
- **MCP Service**: `apps/desktop/src/main/mcp-service.ts`
- **Models Service**: `apps/desktop/src/main/models-service.ts`
- **TIPC Handlers**: `apps/desktop/src/main/tipc.ts`
- **Remote Server**: `apps/desktop/src/main/remote-server.ts`
- **UI Component**: `apps/desktop/src/renderer/src/components/model-preset-manager.tsx`

### Server Package Implementation
- **Types**: `packages/server/src/types/index.ts`
- **MCP Service**: `packages/server/src/services/mcp-service.ts`
- **HTTP Server**: `packages/server/src/server.ts`

---

## Implementation Checklist for G-17

- [ ] Add `restartServer()` to server MCPService
- [ ] Add `stopServer()` to server MCPService
- [ ] Add `POST /v1/mcp/servers/:name/restart` endpoint
- [ ] Add `POST /v1/mcp/servers/:name/stop` endpoint
- [ ] Add `GET /v1/mcp/servers/:name/logs` endpoint
- [ ] Add `DELETE /v1/mcp/servers/:name/logs` endpoint
- [ ] Add tests for new methods
- [ ] Add tests for new endpoints
- [ ] Update API documentation

