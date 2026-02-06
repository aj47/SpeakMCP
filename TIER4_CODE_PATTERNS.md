# Tier 4 Code Patterns & Examples

## G-08/G-15: Model Presets - Usage Patterns

### Creating a New Preset
```typescript
// From model-preset-manager.tsx:158-180
const handleCreatePreset = () => {
  if (!newPreset.name?.trim()) {
    toast.error("Preset name is required")
    return
  }
  if (!newPreset.baseUrl?.trim()) {
    toast.error("Base URL is required")
    return
  }

  const id = `custom-${Date.now()}`
  const preset: ModelPreset = {
    id,
    name: newPreset.name.trim(),
    baseUrl: newPreset.baseUrl.trim(),
    apiKey: newPreset.apiKey || "",
    isBuiltIn: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mcpToolsModel: newPreset.mcpToolsModel || "",
    transcriptProcessingModel: newPreset.transcriptProcessingModel || "",
    summarizationModel: newPreset.summarizationModel || "",
  }

  const existingPresets = config?.modelPresets || []
  saveConfig({
    modelPresets: [...existingPresets, preset],
  })
}
```

### Fetching Models for a Preset
```typescript
// From preset-model-selector.tsx:39-61
const fetchModels = async () => {
  if (!baseUrl || !apiKey) {
    setModels([])
    setError("Base URL and API key required")
    return
  }

  setIsLoading(true)
  setError(null)

  try {
    const result = await tipcClient.fetchModelsForPreset({
      baseUrl,
      apiKey,
    })
    setModels(result || [])
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to fetch models")
    setModels([])
  } finally {
    setIsLoading(false)
  }
}
```

### Saving Model Selection to Preset
```typescript
// From model-preset-manager.tsx:85-130
const saveModelWithPreset = useCallback((
  modelType: 'mcpToolsModel' | 'transcriptProcessingModel' | 'summarizationModel',
  globalConfigKey: 'mcpToolsOpenaiModel' | 'transcriptPostProcessingOpenaiModel' | 'dualModelWeakModelName',
  modelId: string
) => {
  if (!currentPresetId || !config) return

  const existingPresets = config.modelPresets || []
  const presetIndex = existingPresets.findIndex(p => p.id === currentPresetId)

  let updatedPresets: ModelPreset[]
  if (presetIndex >= 0) {
    // Update existing preset
    updatedPresets = [...existingPresets]
    updatedPresets[presetIndex] = {
      ...updatedPresets[presetIndex],
      [modelType]: modelId,
      updatedAt: Date.now(),
    }
  } else {
    // Create new entry for built-in preset
    const builtInPreset = getBuiltInModelPresets().find(p => p.id === currentPresetId)
    if (builtInPreset) {
      updatedPresets = [
        ...existingPresets,
        {
          ...builtInPreset,
          apiKey: '',
          [modelType]: modelId,
          updatedAt: Date.now(),
        }
      ]
    } else {
      saveConfig({ [globalConfigKey]: modelId })
      return
    }
  }

  // Save BOTH global config AND preset
  saveConfig({
    [globalConfigKey]: modelId,
    modelPresets: updatedPresets
  })
}, [currentPresetId, config, saveConfig])
```

### Merging Built-in with Saved Presets
```typescript
// From config.ts:239-251
function getActivePreset(config: Partial<Config>): ModelPreset | undefined {
  const builtIn = getBuiltInModelPresets()
  const savedPresets = config.modelPresets || []
  const currentPresetId = config.currentModelPresetId || DEFAULT_MODEL_PRESET_ID

  // Merge built-in presets with saved properties
  const allPresets = builtIn.map(preset => {
    const saved = savedPresets.find(s => s.id === preset.id)
    // Filter out undefined values to prevent overwriting defaults
    return saved 
      ? { 
          ...preset, 
          ...Object.fromEntries(
            Object.entries(saved).filter(([_, v]) => v !== undefined)
          ) 
        } 
      : preset
  })

  // Add custom presets
  const customPresets = savedPresets.filter(p => !p.isBuiltIn)
  allPresets.push(...customPresets)

  return allPresets.find(p => p.id === currentPresetId)
}
```

---

## G-17: MCP Server Management - Implementation Patterns

### Restart Server Pattern
```typescript
// From mcp-service.ts:2051-2081
async restartServer(serverName: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Get current config
    const config = configStore.get()
    const mcpConfig = config.mcpConfig

    // 2. Validate server exists
    if (!mcpConfig?.mcpServers?.[serverName]) {
      return {
        success: false,
        error: `Server ${serverName} not found in configuration`,
      }
    }

    const serverConfig = mcpConfig.mcpServers[serverName]

    // 3. Stop existing server
    await this.stopServer(serverName)

    // 4. Reinitialize with OAuth allowed
    await this.initializeServer(serverName, serverConfig, { allowAutoOAuth: true })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
```

### Stop Server Pattern
```typescript
// From mcp-service.ts:2411-2436
async stopServer(serverName: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Get client and transport
    const client = this.clients.get(serverName)
    const transport = this.transports.get(serverName)

    // 2. Close client gracefully
    if (client) {
      try {
        await client.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // 3. Clean up all references
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

### Log Management Pattern
```typescript
// From mcp-service.ts:2919-2949
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

  // Circular buffer: keep only last MAX_LOG_ENTRIES
  if (logs.length > this.MAX_LOG_ENTRIES) {
    logs.shift()
  }
}

getServerLogs(serverName: string): ServerLogEntry[] {
  return this.serverLogs.get(serverName) || []
}

clearServerLogs(serverName: string): void {
  this.serverLogs.set(serverName, [])
}
```

### Test Connection Pattern
```typescript
// From mcp-service.ts:1896-1972
async testServerConnection(
  serverName: string,
  serverConfig: MCPServerConfig,
): Promise<{ success: boolean; error?: string; toolCount?: number }> {
  try {
    // 1. Validate transport type
    const transportType = inferTransportType(serverConfig)

    // 2. Validate transport-specific requirements
    if (transportType === "stdio") {
      if (!serverConfig.command) {
        return { success: false, error: "Command is required for stdio transport" }
      }
      if (!Array.isArray(serverConfig.args)) {
        return { success: false, error: "Args must be an array for stdio transport" }
      }
      // Try to resolve command path
      try {
        await this.resolveCommandPath(serverConfig.command)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : `Failed to resolve command`,
        }
      }
    } else if (transportType === "websocket" || transportType === "streamableHttp") {
      if (!serverConfig.url) {
        return { success: false, error: `URL is required for ${transportType} transport` }
      }
      // Validate URL format
      try {
        new URL(serverConfig.url)
      } catch (error) {
        return { success: false, error: `Invalid URL: ${serverConfig.url}` }
      }
    }

    // 3. Create test connection with timeout
    const timeout = serverConfig.timeout || 10000
    const testPromise = this.createTestConnection(serverName, serverConfig)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Connection test timeout")), timeout)
    })

    const result = await Promise.race([testPromise, timeoutPromise])
    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
```

### TIPC Handler Pattern
```typescript
// From tipc.ts:2195-2219
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

---

## Error Handling Patterns

### Consistent Return Type
```typescript
// All methods follow this pattern
Promise<{ success: boolean; error?: string }>
Promise<{ success: boolean; error?: string; toolCount?: number }>
```

### Error Message Formatting
```typescript
// Consistent error handling
error instanceof Error ? error.message : String(error)
```

### Graceful Cleanup
```typescript
// Ignore cleanup errors to prevent cascading failures
try {
  await client.close()
} catch (error) {
  // Ignore cleanup errors
}
```

