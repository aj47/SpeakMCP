# Tier 4 Gaps Exploration Report

## G-08/G-15: Model Presets

### ModelPreset Type Definition
**Location**: `apps/desktop/src/shared/types.ts:872-883`

```typescript
export interface ModelPreset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  isBuiltIn?: boolean
  createdAt?: number
  updatedAt?: number
  mcpToolsModel?: string
  transcriptProcessingModel?: string
  summarizationModel?: string  // Model for dual-model summarization (weak model)
}
```

### Config Store Fields
**Location**: `apps/desktop/src/shared/types.ts:961-962`

```typescript
modelPresets?: ModelPreset[]
currentModelPresetId?: string
```

### Preset CRUD Operations
**Location**: `apps/desktop/src/renderer/src/components/model-preset-manager.tsx`

- **Create**: `handleCreatePreset()` - Creates new preset with `custom-${Date.now()}` ID
- **Read**: `getBuiltInModelPresets()` - Returns built-in presets (OpenAI, Groq, Gemini, Perplexity, Custom)
- **Update**: `saveModelWithPreset()` - Updates model selection in preset
- **Delete**: `handleDeletePreset()` - Removes preset from config

### Preset Storage & Management
**Location**: `apps/desktop/src/main/config.ts:239-278`

- **getActivePreset()**: Merges built-in presets with saved data, filters undefined values
- **syncPresetToLegacyFields()**: Syncs active preset credentials to legacy config fields for backward compatibility
- **Built-in Presets**: Defined in `apps/desktop/src/shared/index.ts:176-184`

### Models Service Integration
**Location**: `apps/desktop/src/main/models-service.ts:635-658`

```typescript
export async function fetchModelsForPreset(
  baseUrl: string,
  apiKey: string,
): Promise<ModelInfo[]>
```
- Fetches available models for a preset's base URL + API key combination
- Used by preset manager UI to show available models when configuring

---

## G-17: MCP Server Management

### Desktop MCP Service Methods
**Location**: `apps/desktop/src/main/mcp-service.ts`

#### restartServer()
```typescript
async restartServer(serverName: string): Promise<{ success: boolean; error?: string }>
```
- Lines 2051-2081
- Stops server, then reinitializes with `allowAutoOAuth: true`

#### stopServer()
```typescript
async stopServer(serverName: string): Promise<{ success: boolean; error?: string }>
```
- Lines 2411-2436
- Closes client, cleans up references

#### getServerLogs()
```typescript
getServerLogs(serverName: string): ServerLogEntry[]
```
- Lines 2940-2942
- Returns circular buffer of logs (max 1000 entries)

#### clearServerLogs()
```typescript
clearServerLogs(serverName: string): void
```
- Lines 2947-2949
- Clears all logs for a server

#### testServerConnection()
```typescript
async testServerConnection(
  serverName: string,
  serverConfig: MCPServerConfig,
): Promise<{ success: boolean; error?: string; toolCount?: number }>
```
- Lines 1896-1972
- Validates transport type, creates test connection, returns tool count

### Server Package MCP Service
**Location**: `packages/server/src/services/mcp-service.ts`

#### Existing Methods
- `testServerConnection()` - Lines 1534-1556 ✅
- `getServerLogs()` - Lines 858-860 ✅
- `clearServerLogs()` - Lines 862-864 ✅

#### Missing Methods
- `restartServer()` ❌
- `stopServer()` ❌

### TIPC Handlers (Desktop)
**Location**: `apps/desktop/src/main/tipc.ts:2195-2219`

```typescript
restartMcpServer: t.procedure.input<{ serverName: string }>()
stopMcpServer: t.procedure.input<{ serverName: string }>()
getMcpServerLogs: t.procedure.input<{ serverName: string }>()
clearMcpServerLogs: t.procedure.input<{ serverName: string }>()
```

### Remote Server Endpoints (Desktop)
**Location**: `apps/desktop/src/main/remote-server.ts:700-721`

- `POST /v1/mcp/servers/:name/toggle` - Toggle server enabled/disabled

### Server Package HTTP Endpoints
**Location**: `packages/server/src/server.ts:533-549`

- `GET /v1/mcp/servers` - List MCP servers with status

---

## Summary

### G-08/G-15 Status
✅ **Complete in Desktop**: Full CRUD, storage, legacy field sync, models fetching
⚠️ **Server Package**: No model preset support (not in scope for server)

### G-17 Status
✅ **Desktop**: All 5 methods implemented
⚠️ **Server Package**: Missing `restartServer()` and `stopServer()` methods
⚠️ **HTTP Endpoints**: No endpoints for restart/stop/logs/clear in server package

