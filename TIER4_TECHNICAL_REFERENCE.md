# Tier 4 Technical Reference - Full Signatures & Implementation Details

## G-08/G-15: Model Presets - Complete Reference

### Type Definitions

```typescript
// apps/desktop/src/shared/types.ts:872-883
export interface ModelPreset {
  id: string                          // e.g., "builtin-openai" or "custom-1234567890"
  name: string                        // Display name
  baseUrl: string                     // API endpoint URL
  apiKey: string                      // API authentication key
  isBuiltIn?: boolean                 // true for built-in presets
  createdAt?: number                  // Timestamp
  updatedAt?: number                  // Timestamp
  mcpToolsModel?: string              // Model for MCP tool execution
  transcriptProcessingModel?: string  // Model for transcript post-processing
  summarizationModel?: string         // Model for dual-model summarization (weak model)
}

// apps/desktop/src/shared/types.ts:961-962
export type Config = {
  modelPresets?: ModelPreset[]        // Array of custom + saved presets
  currentModelPresetId?: string       // Active preset ID
  // ... other fields
}
```

### Built-in Presets
**Location**: `apps/desktop/src/shared/index.ts:159-184`

```typescript
const OPENAI_COMPATIBLE_PRESETS = [
  { label: "OpenAI", value: "openai", baseUrl: "https://api.openai.com/v1" },
  { label: "Groq", value: "groq", baseUrl: "https://api.groq.com/openai/v1" },
  { label: "Gemini", value: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  { label: "Perplexity", value: "perplexity", baseUrl: "https://api.perplexity.ai" },
  { label: "Custom", value: "custom", baseUrl: "" },
]

export const getBuiltInModelPresets = (): ModelPreset[] => {
  return OPENAI_COMPATIBLE_PRESETS
    .filter(p => p.value !== "custom")
    .map(preset => ({
      id: `builtin-${preset.value}`,
      name: preset.label,
      baseUrl: preset.baseUrl,
      apiKey: "",
      isBuiltIn: true,
    }))
}
```

### Config Store Functions
**Location**: `apps/desktop/src/main/config.ts`

```typescript
// Lines 239-251: Merge built-in with saved presets
function getActivePreset(config: Partial<Config>): ModelPreset | undefined {
  const builtIn = getBuiltInModelPresets()
  const savedPresets = config.modelPresets || []
  const currentPresetId = config.currentModelPresetId || DEFAULT_MODEL_PRESET_ID
  
  const allPresets = builtIn.map(preset => {
    const saved = savedPresets.find(s => s.id === preset.id)
    return saved 
      ? { ...preset, ...Object.fromEntries(
          Object.entries(saved).filter(([_, v]) => v !== undefined)
        )} 
      : preset
  })
  
  const customPresets = savedPresets.filter(p => !p.isBuiltIn)
  allPresets.push(...customPresets)
  
  return allPresets.find(p => p.id === currentPresetId)
}

// Lines 264-278: Sync active preset to legacy fields
function syncPresetToLegacyFields(config: Partial<Config>): Partial<Config> {
  const activePreset = getActivePreset(config)
  if (activePreset) {
    config.openaiApiKey = activePreset.apiKey || ''
    config.openaiBaseUrl = activePreset.baseUrl || ''
    config.mcpToolsOpenaiModel = activePreset.mcpToolsModel || ''
    config.transcriptPostProcessingOpenaiModel = activePreset.transcriptProcessingModel || ''
  }
  return config
}
```

### Models Service
**Location**: `apps/desktop/src/main/models-service.ts:635-658`

```typescript
export async function fetchModelsForPreset(
  baseUrl: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  if (!baseUrl || !apiKey) {
    throw new Error("Base URL and API key are required")
  }
  
  try {
    const models = await fetchOpenAIModels(baseUrl, apiKey)
    return models
  } catch (error) {
    diagnosticsService.logError(
      "models-service",
      `Failed to fetch models for preset`,
      { baseUrl, error: error instanceof Error ? error.message : String(error) },
    )
    throw error
  }
}
```

---

## G-17: MCP Server Management - Full Signatures

### Desktop Implementation (apps/desktop/src/main/mcp-service.ts)

```typescript
// Lines 2051-2081
async restartServer(serverName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    
    if (!mcpConfig?.mcpServers?.[serverName]) {
      return { success: false, error: `Server ${serverName} not found in configuration` }
    }
    
    const serverConfig = mcpConfig.mcpServers[serverName]
    await this.stopServer(serverName)
    await this.initializeServer(serverName, serverConfig, { allowAutoOAuth: true })
    
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Lines 2411-2436
async stopServer(serverName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const client = this.clients.get(serverName)
    const transport = this.transports.get(serverName)
    
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

// Lines 2940-2942
getServerLogs(serverName: string): ServerLogEntry[] {
  return this.serverLogs.get(serverName) || []
}

// Lines 2947-2949
clearServerLogs(serverName: string): void {
  this.serverLogs.set(serverName, [])
}

// Lines 1896-1972
async testServerConnection(
  serverName: string,
  serverConfig: MCPServerConfig,
): Promise<{ success: boolean; error?: string; toolCount?: number }> {
  // Validates transport type, creates test connection, returns tool count
  // Supports stdio, websocket, streamableHttp transports
}
```

### Server Package Implementation (packages/server/src/services/mcp-service.ts)

```typescript
// Lines 858-860 ✅ EXISTS
getServerLogs(serverName: string): ServerLogEntry[] {
  return this.serverLogs.get(serverName) || []
}

// Lines 862-864 ✅ EXISTS
clearServerLogs(serverName: string): void {
  this.serverLogs.set(serverName, [])
}

// Lines 1534-1556 ✅ EXISTS
async testServerConnection(
  serverName: string,
  serverConfig: MCPServerConfig
): Promise<{ success: boolean; toolCount: number; error?: string }> {
  try {
    if (this.clients.has(serverName)) {
      const toolCount = this.availableTools
        .filter(t => t.name.startsWith(`${serverName}:`)).length
      return { success: true, toolCount }
    }
    
    await this.initializeServer(serverName, serverConfig)
    const toolCount = this.availableTools
      .filter(t => t.name.startsWith(`${serverName}:`)).length
    return { success: true, toolCount }
  } catch (error) {
    return {
      success: false,
      toolCount: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ❌ MISSING: restartServer()
// ❌ MISSING: stopServer()
```

### TIPC Handlers (apps/desktop/src/main/tipc.ts:2195-2219)

```typescript
restartMcpServer: t.procedure
  .input<{ serverName: string }>()
  .action(async ({ input }) => {
    return mcpService.restartServer(input.serverName)
  }),

stopMcpServer: t.procedure
  .input<{ serverName: string }>()
  .action(async ({ input }) => {
    return mcpService.stopServer(input.serverName)
  }),

getMcpServerLogs: t.procedure
  .input<{ serverName: string }>()
  .action(async ({ input }) => {
    return mcpService.getServerLogs(input.serverName)
  }),

clearMcpServerLogs: t.procedure
  .input<{ serverName: string }>()
  .action(async ({ input }) => {
    mcpService.clearServerLogs(input.serverName)
    return { success: true }
  }),
```

### ServerLogEntry Type
**Location**: `apps/desktop/src/shared/types.ts` (inferred from usage)

```typescript
interface ServerLogEntry {
  timestamp: number
  message: string
}
```

### Circular Buffer Implementation
**Location**: `apps/desktop/src/main/mcp-service.ts:2919-2935`

```typescript
private readonly MAX_LOG_ENTRIES = 1000

private addLogEntry(serverName: string, message: string): void {
  let logs = this.serverLogs.get(serverName)
  if (!logs) {
    logs = []
    this.serverLogs.set(serverName, logs)
  }
  
  logs.push({
    timestamp: Date.now(),
    message: message.trim()
  })
  
  if (logs.length > this.MAX_LOG_ENTRIES) {
    logs.shift()  // Remove oldest entry
  }
}
```

