# Tier 4 Implementation Gaps & Recommendations

## Gap Summary

### G-08/G-15: Model Presets
**Status**: ✅ **COMPLETE in Desktop** | ⚠️ **Not applicable to Server**

**Desktop Implementation**:
- ✅ ModelPreset type with all fields (id, name, baseUrl, apiKey, isBuiltIn, timestamps, model selections)
- ✅ Config store fields (modelPresets[], currentModelPresetId)
- ✅ Built-in presets (OpenAI, Groq, Gemini, Perplexity, Custom)
- ✅ Preset CRUD operations (create, read, update, delete)
- ✅ Preset storage and merging logic
- ✅ Legacy field synchronization for backward compatibility
- ✅ Models fetching for preset credentials

**Server Package**:
- Model presets are **not in scope** for the server package
- Server uses global config fields (openaiApiKey, openaiBaseUrl, etc.)
- No preset management needed in server mode

---

### G-17: MCP Server Management
**Status**: ✅ **Complete in Desktop** | ⚠️ **Partial in Server Package**

#### Desktop (apps/desktop/src/main/mcp-service.ts)
✅ **All 5 methods implemented**:
1. `restartServer(serverName)` - Lines 2051-2081
2. `stopServer(serverName)` - Lines 2411-2436
3. `getServerLogs(serverName)` - Lines 2940-2942
4. `clearServerLogs(serverName)` - Lines 2947-2949
5. `testServerConnection(serverName, config)` - Lines 1896-1972

#### Server Package (packages/server/src/services/mcp-service.ts)
✅ **3 methods exist**:
- `testServerConnection()` - Lines 1534-1556
- `getServerLogs()` - Lines 858-860
- `clearServerLogs()` - Lines 862-864

❌ **2 methods MISSING**:
- `restartServer()` - **NOT IMPLEMENTED**
- `stopServer()` - **NOT IMPLEMENTED**

#### HTTP Endpoints
**Desktop Remote Server** (apps/desktop/src/main/remote-server.ts):
- ✅ `POST /v1/mcp/servers/:name/toggle` - Toggle enabled/disabled

**Server Package** (packages/server/src/server.ts):
- ✅ `GET /v1/mcp/servers` - List servers with status
- ❌ `POST /v1/mcp/servers/:name/restart` - **NOT IMPLEMENTED**
- ❌ `POST /v1/mcp/servers/:name/stop` - **NOT IMPLEMENTED**
- ❌ `GET /v1/mcp/servers/:name/logs` - **NOT IMPLEMENTED**
- ❌ `DELETE /v1/mcp/servers/:name/logs` - **NOT IMPLEMENTED**

---

## Implementation Recommendations

### For G-17 Server Package Completion

#### 1. Add restartServer() Method
**Location**: `packages/server/src/services/mcp-service.ts`

```typescript
async restartServer(serverName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const config = configStore.get() as Record<string, unknown>
    const mcpConfig = config.mcpConfig as MCPConfig | undefined
    
    if (!mcpConfig?.mcpServers?.[serverName]) {
      return {
        success: false,
        error: `Server ${serverName} not found in configuration`,
      }
    }
    
    const serverConfig = mcpConfig.mcpServers[serverName]
    
    // Stop existing server
    this.cleanupServer(serverName)
    
    // Reinitialize
    await this.initializeServer(serverName, serverConfig)
    
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
```

#### 2. Add stopServer() Method
**Location**: `packages/server/src/services/mcp-service.ts`

```typescript
async stopServer(serverName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const client = this.clients.get(serverName)
    
    if (client) {
      try {
        await client.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    this.cleanupServer(serverName)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
```

#### 3. Add HTTP Endpoints
**Location**: `packages/server/src/server.ts`

```typescript
// POST /v1/mcp/servers/:name/restart
fastify.post("/v1/mcp/servers/:name/restart", async (req, reply) => {
  const { name } = req.params as { name: string }
  const result = await mcpService.restartServer(name)
  return reply.send(result)
})

// POST /v1/mcp/servers/:name/stop
fastify.post("/v1/mcp/servers/:name/stop", async (req, reply) => {
  const { name } = req.params as { name: string }
  const result = await mcpService.stopServer(name)
  return reply.send(result)
})

// GET /v1/mcp/servers/:name/logs
fastify.get("/v1/mcp/servers/:name/logs", async (req, reply) => {
  const { name } = req.params as { name: string }
  const logs = mcpService.getServerLogs(name)
  return reply.send({ logs })
})

// DELETE /v1/mcp/servers/:name/logs
fastify.delete("/v1/mcp/servers/:name/logs", async (req, reply) => {
  const { name } = req.params as { name: string }
  mcpService.clearServerLogs(name)
  return reply.send({ success: true })
})
```

---

## Key Implementation Details

### ServerLogEntry Structure
```typescript
interface ServerLogEntry {
  timestamp: number  // Unix timestamp in milliseconds
  message: string    // Log message (trimmed)
}
```

### Circular Buffer
- Max 1000 entries per server
- Oldest entries removed when limit exceeded
- Stored in `Map<string, ServerLogEntry[]>`

### Transport Types Supported
- `stdio` - Local command-based servers
- `websocket` - WebSocket connections
- `streamableHttp` - HTTP streaming connections

### Error Handling Pattern
All methods return `{ success: boolean; error?: string }` for consistency

