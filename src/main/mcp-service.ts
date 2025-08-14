import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { configStore } from "./config"
import {
  MCPConfig,
  MCPServerConfig,
  MCPTransportType,
  Config,
} from "../shared/types"
import { spawn, ChildProcess } from "child_process"
import { promisify } from "util"
import { access, constants } from "fs"
import path from "path"
import os from "os"
import { diagnosticsService } from "./diagnostics"
import { state, agentProcessManager } from "./state"
import { OAuthClient } from "./oauth-client"
import { oauthStorage } from "./oauth-storage"
import { isDebugTools, logTools } from "./debug"
import { dialog } from "electron"

const accessAsync = promisify(access)

export interface MCPTool {
  name: string
  description: string
  inputSchema: any
}

export interface MCPToolCall {
  name: string
  arguments: any
}

export interface MCPToolResult {
  content: Array<{
    type: "text"
    text: string
  }>
  isError?: boolean
}

export interface LLMToolCallResponse {
  content?: string
  toolCalls?: MCPToolCall[]
  needsMoreWork?: boolean
}

export class MCPService {
  private clients: Map<string, Client> = new Map()
  private serverProcesses: Map<string, ChildProcess> = new Map()
  private transports: Map<
    string,
    | StdioClientTransport
    | WebSocketClientTransport
    | StreamableHTTPClientTransport
  > = new Map()
  private oauthClients: Map<string, OAuthClient> = new Map()
  private availableTools: MCPTool[] = []
  private disabledTools: Set<string> = new Set()
  private isInitializing = false
  private initializationProgress: {
    current: number
    total: number
    currentServer?: string
  } = { current: 0, total: 0 }

  // Track runtime server states - separate from config disabled flag
  private runtimeDisabledServers: Set<string> = new Set()
  private initializedServers: Set<string> = new Set()
  private hasBeenInitialized = false

  // Simplified tracking - let LLM handle context extraction
  private activeResources = new Map<
    string,
    {
      serverId: string
      resourceId: string
      resourceType: string
      lastUsed: number
    }
  >()

  // Session cleanup interval
  private sessionCleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // Start resource cleanup interval (every 5 minutes)
    this.sessionCleanupInterval = setInterval(
      () => {
        this.cleanupInactiveResources()
      },
      5 * 60 * 1000,
    )

    // Seed runtime disabled servers from persisted config so we respect user choices across sessions
    try {
      const persisted = configStore.get()?.mcpRuntimeDisabledServers
      if (Array.isArray(persisted)) {
        for (const serverName of persisted) {
          this.runtimeDisabledServers.add(serverName)
        }
      }
    } catch (e) {
      // Ignore persistence loading errors
    }
  }

  /**
   * Simple resource tracking for basic functionality
   * The LLM-based context extraction handles the complex logic
   */
  trackResource(
    serverId: string,
    resourceId: string,
    resourceType: string = "session",
  ): void {
    const key = `${serverId}:${resourceType}:${resourceId}`
    this.activeResources.set(key, {
      serverId,
      resourceId,
      resourceType,
      lastUsed: Date.now(),
    })
  }

  /**
   * Update resource activity (simplified)
   */
  updateResourceActivity(
    serverId: string,
    resourceId: string,
    resourceType: string = "session",
  ): void {
    const key = `${serverId}:${resourceType}:${resourceId}`
    const resource = this.activeResources.get(key)
    if (resource) {
      resource.lastUsed = Date.now()
    }
  }

  /**
   * Clean up old resources (simplified)
   */
  private cleanupInactiveResources(): void {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000
    let cleanedCount = 0

    for (const [key, resource] of this.activeResources) {
      if (resource.lastUsed < thirtyMinutesAgo) {
        this.activeResources.delete(key)
        cleanedCount++
      }
    }
  }

  /**
   * Simple method to get tracked resources (for debugging)
   */
  getTrackedResources(): Array<{
    serverId: string
    resourceId: string
    resourceType: string
    lastUsed: number
  }> {
    return Array.from(this.activeResources.values())
  }

  /**
   * Simple resource tracking from tool results (LLM handles the complex logic)
   */
  private trackResourceFromResult(
    serverName: string,
    result: MCPToolResult,
  ): void {
    if (!result.isError && result.content[0]?.text) {
      const text = result.content[0].text

      // Simple pattern matching for common resource types
      const resourcePatterns = [
        {
          pattern: /(?:Session|session)\s+(?:ID|id):\s*([a-f0-9-]+)/i,
          type: "session",
        },
        {
          pattern: /(?:Connection|connection)\s+(?:ID|id):\s*([a-f0-9-]+)/i,
          type: "connection",
        },
        { pattern: /(?:Handle|handle):\s*([a-f0-9-]+)/i, type: "handle" },
      ]

      for (const { pattern, type } of resourcePatterns) {
        const match = text.match(pattern)
        if (match && match[1]) {
          this.trackResource(serverName, match[1], type)
          break
        }
      }
    }
  }

  async initialize(): Promise<void> {
    this.isInitializing = true
    this.initializationProgress = { current: 0, total: 0 }

    const config = configStore.get()
    const mcpConfig = config.mcpConfig

    if (isDebugTools()) {
      logTools("MCP Service initialization starting")
    }

    if (
      !mcpConfig ||
      !mcpConfig.mcpServers ||
      Object.keys(mcpConfig.mcpServers).length === 0
    ) {
      if (isDebugTools()) {
        logTools("MCP Service initialization complete - no servers configured")
      }
      this.availableTools = []
      this.isInitializing = false
      this.hasBeenInitialized = true
      return
    }

    // Get servers that should be initialized:
    // 1. Not disabled in config AND
    // 2. Not runtime-disabled by user (persisted) AND
    // 3. If this is not the first initialization in-session, not already initialized
    const serversToInitialize = Object.entries(mcpConfig.mcpServers).filter(
      ([serverName, serverConfig]) => {
        // Skip if disabled in config
        if ((serverConfig as MCPServerConfig).disabled) {
          if (isDebugTools()) {
            logTools(`Skipping server ${serverName} - disabled in config`)
          }
          return false
        }

        // Always respect user runtime-disabled preference (persisted across sessions)
        if (this.runtimeDisabledServers.has(serverName)) {
          if (isDebugTools()) {
            logTools(`Skipping server ${serverName} - runtime disabled by user`)
          }
          return false
        }

        // On first initialization, initialize all eligible servers
        if (!this.hasBeenInitialized) {
          return true
        }

        // On subsequent calls (like agent mode), only initialize if not already initialized
        const alreadyInitialized = this.initializedServers.has(serverName)
        if (isDebugTools() && alreadyInitialized) {
          logTools(`Skipping server ${serverName} - already initialized`)
        }
        return !alreadyInitialized
      },
    )

    if (isDebugTools()) {
      logTools(`Found ${serversToInitialize.length} servers to initialize`,
        serversToInitialize.map(([name]) => name))
    }

    this.initializationProgress.total = serversToInitialize.length

    // Initialize servers
    for (const [serverName, serverConfig] of serversToInitialize) {
      this.initializationProgress.currentServer = serverName

      if (isDebugTools()) {
        logTools(`Starting initialization of server: ${serverName}`)
      }

      try {
        await this.initializeServer(serverName, serverConfig as MCPServerConfig)
        this.initializedServers.add(serverName)
        if (isDebugTools()) {
          logTools(`Successfully initialized server: ${serverName}`)
        }
      } catch (error) {
        if (isDebugTools()) {
          logTools(`Failed to initialize server: ${serverName}`, error)
        }
        // Server status will be computed dynamically in getServerStatus()
      }

      this.initializationProgress.current++
    }

    this.isInitializing = false
    this.hasBeenInitialized = true

    if (isDebugTools()) {
      logTools(`MCP Service initialization complete. Total tools available: ${this.availableTools.length}`)
    }
  }

  private async createTransport(
    serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<
    | StdioClientTransport
    | WebSocketClientTransport
    | StreamableHTTPClientTransport
  > {
    const transportType = serverConfig.transport || "stdio" // default to stdio for backward compatibility

    switch (transportType) {
      case "stdio":
        if (!serverConfig.command) {
          throw new Error("Command is required for stdio transport")
        }
        const resolvedCommand = await this.resolveCommandPath(
          serverConfig.command,
        )
        const environment = await this.prepareEnvironment(serverConfig.env)
        return new StdioClientTransport({
          command: resolvedCommand,
          args: serverConfig.args || [],
          env: environment,
        })

      case "websocket":
        if (!serverConfig.url) {
          throw new Error("URL is required for websocket transport")
        }
        return new WebSocketClientTransport(new URL(serverConfig.url))

      case "streamableHttp":
        if (!serverConfig.url) {
          throw new Error("URL is required for streamableHttp transport")
        }

        // For streamableHttp, we need to handle OAuth properly
        return await this.createStreamableHttpTransport(serverName, serverConfig)

      default:
        throw new Error(`Unsupported transport type: ${transportType}`)
    }
  }

  private async initializeServer(
    serverName: string,
    serverConfig: MCPServerConfig,
  ) {
    diagnosticsService.logInfo(
      "mcp-service",
      `Initializing server: ${serverName}`,
    )

    if (isDebugTools()) {
      logTools(`Initializing server: ${serverName}`, {
        transport: serverConfig.transport || "stdio",
        command: serverConfig.command,
        args: serverConfig.args,
        env: Object.keys(serverConfig.env || {}),
      })
    }

    try {
      const transportType = serverConfig.transport || "stdio"

      // Handle stdio transport (local command-based servers)
      if (transportType === "stdio") {
        // Resolve command path and prepare environment
        const resolvedCommand = await this.resolveCommandPath(
          serverConfig.command!,
        )
        const environment = await this.prepareEnvironment(serverConfig.env)

        // Spawn the process manually so we can track it
        const childProcess = spawn(resolvedCommand, serverConfig.args || [], {
          env: { ...process.env, ...environment },
          stdio: ["pipe", "pipe", "pipe"],
        })

        // Register process with agent process manager if agent mode is active
        if (state.isAgentModeActive) {
          agentProcessManager.registerProcess(childProcess)
        }

        // Store the process reference
        this.serverProcesses.set(serverName, childProcess)
      }

      // Create appropriate transport based on configuration
      let transport = await this.createTransport(serverName, serverConfig)
      let client: Client | null = null
      let retryWithOAuth = false

      const connectTimeout = serverConfig.timeout || 10000

      try {
        client = new Client(
          {
            name: "speakmcp-mcp-client",
            version: "1.0.0",
          },
          {
            capabilities: {},
          },
        )

        // Connect to the server with timeout
        const connectPromise = client.connect(transport)
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () =>
              reject(new Error(`Connection timeout after ${connectTimeout}ms`)),
            connectTimeout,
          )
        })

        await Promise.race([connectPromise, timeoutPromise])
      } catch (error) {
        // Check if this is a 401 Unauthorized error for streamableHttp transport
        if (serverConfig.transport === "streamableHttp" &&
            error instanceof Error &&
            (error.message.includes("HTTP 401") || error.message.includes("invalid_token"))) {

          console.log(`Server ${serverName} returned 401, attempting OAuth authentication...`)
          diagnosticsService.logInfo("mcp-service", `Server ${serverName} requires OAuth authentication, initiating flow`)
          retryWithOAuth = true

          // Clean up the failed client
          if (client) {
            try {
              await client.close()
            } catch (closeError) {
              // Ignore close errors
            }
          }

          // Create new transport with OAuth
          transport = await this.handle401AndRetryWithOAuth(serverName, serverConfig)

          // Create new client
          client = new Client(
            {
              name: "speakmcp-mcp-client",
              version: "1.0.0",
            },
            {
              capabilities: {},
            },
          )

          // Retry connection with OAuth
          const retryConnectPromise = client.connect(transport)
          const retryTimeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () =>
                reject(new Error(`OAuth retry connection timeout after ${connectTimeout}ms`)),
              connectTimeout,
            )
          })

          await Promise.race([retryConnectPromise, retryTimeoutPromise])
        } else {
          // Re-throw non-401 errors
          throw error
        }
      }

      // Store the client and transport
      this.clients.set(serverName, client!)
      this.transports.set(serverName, transport)

      // Get available tools from the server
      const toolsResult = await client.listTools()

      if (isDebugTools()) {
        logTools(`Server ${serverName} connected successfully`, {
          toolCount: toolsResult.tools.length,
          tools: toolsResult.tools.map(t => ({ name: t.name, description: t.description }))
        })
      }

      // Add tools to our registry with server prefix
      for (const tool of toolsResult.tools) {
        this.availableTools.push({
          name: `${serverName}:${tool.name}`,
          description: tool.description || `Tool from ${serverName} server`,
          inputSchema: tool.inputSchema,
        })
      }

      // Store references
      this.transports.set(serverName, transport)
      this.clients.set(serverName, client)
    } catch (error) {
      diagnosticsService.logError(
        "mcp-service",
        `Failed to initialize server ${serverName}`,
        error,
      )

      if (isDebugTools()) {
        logTools(`Server initialization failed: ${serverName}`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      }

      // Clean up any partial initialization
      this.cleanupServer(serverName)

      // Re-throw to let the caller handle it
      throw error
    }
  }

  private cleanupServer(serverName: string) {
    this.transports.delete(serverName)
    this.clients.delete(serverName)
    this.initializedServers.delete(serverName)

    // Clean up server process if it exists
    const serverProcess = this.serverProcesses.get(serverName)
    if (serverProcess) {
      try {
        serverProcess.kill("SIGTERM")
      } catch (error) {
        // Ignore cleanup errors
      }
      this.serverProcesses.delete(serverName)
    }

    // Remove tools from this server
    this.availableTools = this.availableTools.filter(
      (tool) => !tool.name.startsWith(`${serverName}:`),
    )
  }

  /**
   * Set runtime enabled/disabled state for a server
   * This is separate from the config disabled flag and represents user preference
   */
  setServerRuntimeEnabled(serverName: string, enabled: boolean): boolean {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig

    // Check if server exists in config
    if (!mcpConfig?.mcpServers?.[serverName]) {
      return false
    }

    if (enabled) {
      this.runtimeDisabledServers.delete(serverName)
    } else {
      this.runtimeDisabledServers.add(serverName)
      // If server is currently running, stop it
      if (this.initializedServers.has(serverName)) {
        this.stopServer(serverName).catch(() => {
          // Ignore cleanup errors
        })
      }
    }

    // Persist runtime disabled servers list to config so it survives app restarts
    try {
      const cfg: Config = {
        ...config,
        mcpRuntimeDisabledServers: Array.from(this.runtimeDisabledServers),
      }
      configStore.save(cfg)
    } catch (e) {
      // Ignore persistence errors; runtime state will still be respected in-session
    }

    return true
  }

  /**
   * Get the runtime enabled state of a server
   */
  isServerRuntimeEnabled(serverName: string): boolean {
    return !this.runtimeDisabledServers.has(serverName)
  }

  /**
   * Check if a server should be available (not config-disabled and not runtime-disabled)
   */
  isServerAvailable(serverName: string): boolean {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const serverConfig = mcpConfig?.mcpServers?.[serverName]

    if (!serverConfig || serverConfig.disabled) {
      return false
    }

    return !this.runtimeDisabledServers.has(serverName)
  }

  private async executeServerTool(
    serverName: string,
    toolName: string,
    arguments_: any,
  ): Promise<MCPToolResult> {
    const client = this.clients.get(serverName)
    if (!client) {
      throw new Error(`Server ${serverName} not found or not connected`)
    }

    // Enhanced argument processing with session injection
    let processedArguments = { ...arguments_ }

    // The LLM-based context extraction handles resource management
    // No need for complex session injection logic here

    try {
      if (isDebugTools()) {
        logTools("Executing tool", {
          serverName,
          toolName,
          arguments: processedArguments,
        })
      }
      const result = await client.callTool({
        name: toolName,
        arguments: processedArguments,
      })

      if (isDebugTools()) {
        logTools("Tool result", { serverName, toolName, result })
      }

      // Update resource activity if resource ID was used
      for (const [, value] of Object.entries(processedArguments)) {
        if (typeof value === "string" && value.match(/^[a-f0-9-]{20,}$/)) {
          this.updateResourceActivity(serverName, value, "session")
        }
      }

      // Ensure content is properly formatted
      const content = Array.isArray(result.content)
        ? result.content.map((item) => ({
            type: "text" as const,
            text:
              typeof item === "string"
                ? item
                : item.text || JSON.stringify(item),
          }))
        : [
            {
              type: "text" as const,
              text: "Tool executed successfully",
            },
          ]

      const finalResult = {
        content,
        isError: Boolean(result.isError),
      }

      if (isDebugTools()) {
        logTools("Normalized tool result", finalResult)
      }

      return finalResult
    } catch (error) {
      // Check if this is a parameter naming issue and try to fix it
      if (error instanceof Error) {
        const errorMessage = error.message
        if (
          errorMessage.includes("missing field") ||
          errorMessage.includes("Invalid arguments")
        ) {
          // Try to fix common parameter naming issues
          const correctedArgs = this.fixParameterNaming(
            arguments_,
            errorMessage,
          )
          if (JSON.stringify(correctedArgs) !== JSON.stringify(arguments_)) {
            try {
              if (isDebugTools()) {
                logTools("Retrying with corrected args", {
                  serverName,
                  toolName,
                  correctedArgs,
                })
              }
              const retryResult = await client.callTool({
                name: toolName,
                arguments: correctedArgs,
              })
              if (isDebugTools()) {
                logTools("Retry result", { serverName, toolName, retryResult })
              }

              const retryContent = Array.isArray(retryResult.content)
                ? retryResult.content.map((item) => ({
                    type: "text" as const,
                    text:
                      typeof item === "string"
                        ? item
                        : item.text || JSON.stringify(item),
                  }))
                : [
                    {
                      type: "text" as const,
                      text: "Tool executed successfully (after parameter correction)",
                    },
                  ]

              return {
                content: retryContent,
                isError: Boolean(retryResult.isError),
              }
            } catch (retryError) {
              // Retry failed, will fall through to error return
            }
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }

  private fixParameterNaming(args: any, errorMessage?: string): any {
    if (!args || typeof args !== "object") return args

    const fixed = { ...args }

    // General snake_case to camelCase conversion
    const snakeToCamel = (str: string): string => {
      return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    }

    // If we have an error message, try to extract the expected field name
    if (errorMessage) {
      const missingFieldMatch = errorMessage.match(/missing field `([^`]+)`/)
      if (missingFieldMatch) {
        const expectedField = missingFieldMatch[1]
        // Look for snake_case version of the expected field
        const snakeVersion = expectedField
          .replace(/([A-Z])/g, "_$1")
          .toLowerCase()
        if (snakeVersion in fixed && !(expectedField in fixed)) {
          fixed[expectedField] = fixed[snakeVersion]
          delete fixed[snakeVersion]
        }
      }
    }

    // General conversion of common snake_case patterns to camelCase
    const conversions: Record<string, string> = {}
    for (const key in fixed) {
      if (key.includes("_")) {
        const camelKey = snakeToCamel(key)
        if (camelKey !== key && !(camelKey in fixed)) {
          conversions[key] = camelKey
        }
      }
    }

    // Apply conversions
    for (const [oldKey, newKey] of Object.entries(conversions)) {
      fixed[newKey] = fixed[oldKey]
      delete fixed[oldKey]
    }

    return fixed
  }

  getAvailableTools(): MCPTool[] {
    const enabledTools = this.availableTools.filter(
      (tool) => !this.disabledTools.has(tool.name),
    )
    return enabledTools
  }

  getDetailedToolList(): Array<{
    name: string
    description: string
    serverName: string
    enabled: boolean
    inputSchema: any
  }> {
    return this.availableTools.map((tool) => {
      const serverName = tool.name.includes(":")
        ? tool.name.split(":")[0]
        : "unknown"
      return {
        name: tool.name,
        description: tool.description,
        serverName,
        enabled: !this.disabledTools.has(tool.name),
        inputSchema: tool.inputSchema,
      }
    })
  }

  getServerStatus(): Record<
    string,
    {
      connected: boolean
      toolCount: number
      error?: string
      runtimeEnabled?: boolean
      configDisabled?: boolean
    }
  > {
    const status: Record<
      string,
      {
        connected: boolean
        toolCount: number
        error?: string
        runtimeEnabled?: boolean
        configDisabled?: boolean
      }
    > = {}
    const config = configStore.get()
    const mcpConfig = config.mcpConfig

    // Include all configured servers, not just connected ones
    if (mcpConfig?.mcpServers) {
      for (const [serverName, serverConfig] of Object.entries(
        mcpConfig.mcpServers,
      )) {
        const client = this.clients.get(serverName)
        const transport = this.transports.get(serverName)
        const toolCount = this.availableTools.filter((tool) =>
          tool.name.startsWith(`${serverName}:`),
        ).length

        status[serverName] = {
          connected: !!client && !!transport,
          toolCount,
          runtimeEnabled: !this.runtimeDisabledServers.has(serverName),
          configDisabled: !!(serverConfig as MCPServerConfig).disabled,
        }
      }
    }

    // Also include any servers that are currently connected but not in config (edge case)
    for (const [serverName, client] of this.clients) {
      if (!status[serverName]) {
        const transport = this.transports.get(serverName)
        const toolCount = this.availableTools.filter((tool) =>
          tool.name.startsWith(`${serverName}:`),
        ).length

        status[serverName] = {
          connected: !!client && !!transport,
          toolCount,
          runtimeEnabled: !this.runtimeDisabledServers.has(serverName),
          configDisabled: false,
        }
      }
    }

    return status
  }

  getInitializationStatus(): {
    isInitializing: boolean
    progress: { current: number; total: number; currentServer?: string }
  } {
    return {
      isInitializing: this.isInitializing,
      progress: { ...this.initializationProgress },
    }
  }

  setToolEnabled(toolName: string, enabled: boolean): boolean {
    const toolExists = this.availableTools.some(
      (tool) => tool.name === toolName,
    )
    if (!toolExists) {
      return false
    }

    if (enabled) {
      this.disabledTools.delete(toolName)
    } else {
      this.disabledTools.add(toolName)
    }

    return true
  }

  getDisabledTools(): string[] {
    return Array.from(this.disabledTools)
  }

  async testServerConnection(
    serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    try {
      // Basic validation based on transport type
      const transportType = serverConfig.transport || "stdio"

      if (transportType === "stdio") {
        if (!serverConfig.command) {
          return {
            success: false,
            error: "Command is required for stdio transport",
          }
        }
        if (!Array.isArray(serverConfig.args)) {
          return {
            success: false,
            error: "Args must be an array for stdio transport",
          }
        }
        // Try to resolve the command path
        try {
          const resolvedCommand = await this.resolveCommandPath(
            serverConfig.command,
          )
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : `Failed to resolve command: ${serverConfig.command}`,
          }
        }
      } else if (
        transportType === "websocket" ||
        transportType === "streamableHttp"
      ) {
        if (!serverConfig.url) {
          return {
            success: false,
            error: `URL is required for ${transportType} transport`,
          }
        }
        // Basic URL validation
        try {
          new URL(serverConfig.url)
        } catch (error) {
          return {
            success: false,
            error: `Invalid URL: ${serverConfig.url}`,
          }
        }
      } else {
        return {
          success: false,
          error: `Unsupported transport type: ${transportType}`,
        }
      }

      // Try to create a temporary connection to test the server
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

  private async createTestConnection(
    _serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    let transport:
      | StdioClientTransport
      | WebSocketClientTransport
      | StreamableHTTPClientTransport
      | null = null
    let client: Client | null = null

    try {
      // Create appropriate transport for testing
      transport = await this.createTransport(_serverName, serverConfig)

      client = new Client(
        {
          name: "speakmcp-mcp-test-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      )

      try {
        // Try to connect
        await client.connect(transport)

        // Try to list tools
        const toolsResult = await client.listTools()

        return {
          success: true,
          toolCount: toolsResult.tools.length,
        }
      } catch (error) {
        // Check if this is a 401 Unauthorized error for streamableHttp transport
        if (serverConfig.transport === "streamableHttp" &&
            error instanceof Error &&
            (error.message.includes("HTTP 401") || error.message.includes("invalid_token"))) {

          // For test connections, we don't want to initiate OAuth flow automatically
          // Instead, we return a specific message indicating OAuth is required
          return {
            success: false,
            error: "Server requires OAuth authentication. Please configure OAuth settings and authenticate.",
          }
        } else {
          // Re-throw non-401 errors to be handled by outer catch
          throw error
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      // Clean up test connection
      if (client) {
        try {
          await client.close()
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      if (transport) {
        try {
          await transport.close()
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }
  }

  async restartServer(
    serverName: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get the current config for this server
      const config = configStore.get()
      const mcpConfig = config.mcpConfig

      if (!mcpConfig?.mcpServers?.[serverName]) {
        return {
          success: false,
          error: `Server ${serverName} not found in configuration`,
        }
      }

      const serverConfig = mcpConfig.mcpServers[serverName]

      // Clean up existing server
      await this.stopServer(serverName)

      // Reinitialize the server
      await this.initializeServer(serverName, serverConfig)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Create streamable HTTP transport with proper OAuth handling
   * Implements MCP OAuth specification: try without auth first, handle 401, then retry with OAuth
   */
  private async createStreamableHttpTransport(serverName: string, serverConfig: MCPServerConfig): Promise<StreamableHTTPClientTransport> {
    if (!serverConfig.url) {
      throw new Error("URL is required for streamableHttp transport")
    }

    // First, check if we have valid OAuth tokens
    const hasValidTokens = await oauthStorage.hasValidTokens(serverConfig.url)

    if (hasValidTokens || serverConfig.oauth) {
      // We have tokens or OAuth is configured, try with authentication
      try {
        const oauthClient = await this.getOrCreateOAuthClient(serverName, serverConfig)
        const accessToken = await oauthClient.getValidToken()

        return new StreamableHTTPClientTransport(new URL(serverConfig.url), {
          requestInit: {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          },
        })
      } catch (error) {
        // Token invalid and can't be refreshed - fall through to try without auth
        console.warn(`OAuth authentication failed for ${serverName}, will try without auth: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Create transport without authentication
    // If server requires OAuth, it will return 401 and we'll handle it in the connection logic
    return new StreamableHTTPClientTransport(new URL(serverConfig.url))
  }

  /**
   * Handle 401 Unauthorized response by initiating OAuth flow
   * Implements MCP OAuth specification requirement
   */
  private async handle401AndRetryWithOAuth(serverName: string, serverConfig: MCPServerConfig): Promise<StreamableHTTPClientTransport> {
    if (!serverConfig.url) {
      throw new Error("URL is required for OAuth flow")
    }

    console.log(`Server ${serverName} requires OAuth authentication, initiating flow...`)

    // Ensure OAuth configuration exists
    if (!serverConfig.oauth) {
      // Create default OAuth configuration for the server
      serverConfig.oauth = {
        scope: 'user',
        useDiscovery: true,
        useDynamicRegistration: true,
      }

      // Update the server configuration
      const config = configStore.get()
      if (config.mcpConfig?.mcpServers?.[serverName]) {
        config.mcpConfig.mcpServers[serverName] = serverConfig
        configStore.save(config)
      }
    }

    try {
      // Create OAuth client and complete the full flow
      const oauthClient = await this.getOrCreateOAuthClient(serverName, serverConfig)
      const tokens = await oauthClient.completeAuthorizationFlow()

      // Store the tokens
      await oauthStorage.storeTokens(serverConfig.url, tokens)

      // Create authenticated transport
      return new StreamableHTTPClientTransport(new URL(serverConfig.url), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
          },
        },
      })
    } catch (error) {
      throw new Error(`OAuth authentication failed for server ${serverName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get or create OAuth client for a server
   */
  private async getOrCreateOAuthClient(serverName: string, serverConfig: MCPServerConfig): Promise<OAuthClient> {
    if (!serverConfig.url || !serverConfig.oauth) {
      throw new Error(`OAuth configuration missing for server ${serverName}`)
    }

    // Check if we already have an OAuth client for this server
    let oauthClient = this.oauthClients.get(serverName)

    if (!oauthClient) {
      // Load stored OAuth config
      const storedConfig = await oauthStorage.load(serverConfig.url)
      const mergedConfig = { ...serverConfig.oauth, ...storedConfig }

      // Create new OAuth client
      oauthClient = new OAuthClient(serverConfig.url, mergedConfig)
      this.oauthClients.set(serverName, oauthClient)
    }

    return oauthClient
  }

  /**
   * Initiate OAuth flow for a server
   */
  async initiateOAuthFlow(serverName: string): Promise<{ authorizationUrl: string; state: string }> {
    const config = configStore.get()
    const serverConfig = config.mcpConfig?.mcpServers?.[serverName]

    if (!serverConfig?.oauth || !serverConfig.url) {
      throw new Error(`OAuth not configured for server ${serverName}`)
    }

    const oauthClient = await this.getOrCreateOAuthClient(serverName, serverConfig)

    try {
      const authRequest = await oauthClient.startAuthorizationFlow()

      // Store the code verifier and state for later use
      const currentConfig = oauthClient.getConfig()
      currentConfig.pendingAuth = {
        codeVerifier: authRequest.codeVerifier,
        state: authRequest.state,
      }
      oauthClient.updateConfig(currentConfig)

      // Save updated config
      await oauthStorage.save(serverConfig.url, currentConfig)

      // Open authorization URL in browser
      await oauthClient.openAuthorizationUrl(authRequest.authorizationUrl)

      return {
        authorizationUrl: authRequest.authorizationUrl,
        state: authRequest.state,
      }
    } catch (error) {
      throw new Error(`Failed to initiate OAuth flow for ${serverName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Complete OAuth flow with authorization code
   */
  async completeOAuthFlow(serverName: string, code: string, state: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = configStore.get()
      const serverConfig = config.mcpConfig?.mcpServers?.[serverName]

      if (!serverConfig?.oauth || !serverConfig.url) {
        return {
          success: false,
          error: `OAuth not configured for server ${serverName}`,
        }
      }

      const oauthClient = this.oauthClients.get(serverName)
      if (!oauthClient) {
        return {
          success: false,
          error: `OAuth client not found for server ${serverName}`,
        }
      }

      const currentConfig = oauthClient.getConfig()
      const pendingAuth = (currentConfig as any).pendingAuth

      if (!pendingAuth || pendingAuth.state !== state) {
        return {
          success: false,
          error: 'Invalid or expired OAuth state',
        }
      }

      // Exchange code for tokens
      const tokens = await oauthClient.exchangeCodeForToken({
        code,
        codeVerifier: pendingAuth.codeVerifier,
        state,
      })

      // Clean up pending auth
      delete (currentConfig as any).pendingAuth
      oauthClient.updateConfig(currentConfig)

      // Save tokens
      await oauthStorage.storeTokens(serverConfig.url, tokens)

      // Try to restart the server with new tokens
      const restartResult = await this.restartServer(serverName)

      return restartResult
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Check OAuth status for a server
   */
  async getOAuthStatus(serverName: string): Promise<{
    configured: boolean
    authenticated: boolean
    tokenExpiry?: number
    error?: string
  }> {
    try {
      const config = configStore.get()
      const serverConfig = config.mcpConfig?.mcpServers?.[serverName]

      if (!serverConfig?.oauth || !serverConfig.url) {
        return {
          configured: false,
          authenticated: false,
        }
      }

      const hasValidTokens = await oauthStorage.hasValidTokens(serverConfig.url)
      const tokens = await oauthStorage.getTokens(serverConfig.url)

      return {
        configured: true,
        authenticated: hasValidTokens,
        tokenExpiry: tokens?.expires_at,
      }
    } catch (error) {
      return {
        configured: false,
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Revoke OAuth tokens for a server
   */
  async revokeOAuthTokens(serverName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = configStore.get()
      const serverConfig = config.mcpConfig?.mcpServers?.[serverName]

      if (!serverConfig?.url) {
        return {
          success: false,
          error: `Server ${serverName} not found`,
        }
      }

      // Clear stored tokens
      await oauthStorage.clearTokens(serverConfig.url)

      // Remove OAuth client
      this.oauthClients.delete(serverName)

      // Stop the server since it will no longer be able to authenticate
      await this.stopServer(serverName)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async stopServer(
    serverName: string,
  ): Promise<{ success: boolean; error?: string }> {
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

      if (transport) {
        try {
          await transport.close()
        } catch (error) {
          // Ignore cleanup errors
        }
      }

      // Clean up references
      this.cleanupServer(serverName)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async executeToolCall(toolCall: MCPToolCall): Promise<MCPToolResult> {
    try {
      if (isDebugTools()) {
        logTools("Requested tool call", toolCall)
      }

      // Safety gate: require user approval before executing any tool call if enabled in config
      const cfg = configStore.get()
      if (cfg.mcpRequireApprovalBeforeToolCall) {
        const argPreview = (() => {
          try {
            return JSON.stringify(toolCall.arguments, null, 2)
          } catch {
            return String(toolCall.arguments)
          }
        })()
        const { response } = await dialog.showMessageBox({
          type: "question",
          buttons: ["Allow", "Deny"],
          defaultId: 1,
          cancelId: 1,
          title: "Approve tool execution",
          message: `Allow tool to run?`,
          detail: `Tool: ${toolCall.name}\nArguments: ${argPreview}`,
          noLink: true,
        })
        if (response !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Tool call denied by user: ${toolCall.name}`,
              },
            ],
            isError: true,
          }
        }
      }
      // Check if this is a server-prefixed tool
      if (toolCall.name.includes(":")) {
        const [serverName, toolName] = toolCall.name.split(":", 2)
        const result = await this.executeServerTool(
          serverName,
          toolName,
          toolCall.arguments,
        )

        // Track resource information from tool results
        this.trackResourceFromResult(serverName, result)

        return result
      }

      // Try to find a matching tool without prefix (fallback for LLM inconsistencies)
      const matchingTool = this.availableTools.find((tool) => {
        if (tool.name.includes(":")) {
          const [, toolName] = tool.name.split(":", 2)
          return toolName === toolCall.name
        }
        return tool.name === toolCall.name
      })

      if (matchingTool && matchingTool.name.includes(":")) {
        const [serverName, toolName] = matchingTool.name.split(":", 2)
        const result = await this.executeServerTool(
          serverName,
          toolName,
          toolCall.arguments,
        )

        // Track resource information from tool results
        this.trackResourceFromResult(serverName, result)

        return result
      }

      // No matching tools found
      const availableToolNames = this.availableTools
        .map((t) => t.name)
        .join(", ")
      const result: MCPToolResult = {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${toolCall.name}. Available tools: ${availableToolNames || "none"}. Make sure to use the exact tool name including server prefix.`,
          },
        ],
        isError: true,
      }

      return result
    } catch (error) {
      diagnosticsService.logError(
        "mcp-service",
        `Tool execution error for ${toolCall.name}`,
        error,
      )

      return {
        content: [
          {
            type: "text",
            text: `Error executing tool ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }

  /**
   * Resolve the full path to a command, handling different platforms and PATH resolution
   */
  async resolveCommandPath(command: string): Promise<string> {
    // If it's already an absolute path, return as-is
    if (path.isAbsolute(command)) {
      return command
    }

    // Get the system PATH
    const systemPath = process.env.PATH || ""
    const pathSeparator = process.platform === "win32" ? ";" : ":"
    const pathExtensions =
      process.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""]

    // Split PATH and search for the command
    const pathDirs = systemPath.split(pathSeparator)

    // Add common Node.js paths that might be missing in Electron
    const additionalPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      path.join(os.homedir(), ".npm-global", "bin"),
      path.join(os.homedir(), "node_modules", ".bin"),
    ]

    pathDirs.push(...additionalPaths)

    for (const dir of pathDirs) {
      if (!dir) continue

      for (const ext of pathExtensions) {
        const fullPath = path.join(dir, command + ext)
        try {
          await accessAsync(fullPath, constants.F_OK | constants.X_OK)
          return fullPath
        } catch {
          // Continue searching
        }
      }
    }

    // If not found, check if npx is available and this might be an npm package
    if (command === "npx" || command.startsWith("@")) {
      throw new Error(
        `npx not found in PATH. Please ensure Node.js is properly installed.`,
      )
    }

    // Return original command and let the system handle it
    return command
  }

  /**
   * Prepare environment variables for spawning MCP servers
   */
  async prepareEnvironment(
    serverEnv?: Record<string, string>,
  ): Promise<Record<string, string>> {
    // Create a clean environment with only string values
    const environment: Record<string, string> = {}

    // Copy process.env, filtering out undefined values
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        environment[key] = value
      }
    }

    // Ensure PATH is properly set for finding npm/npx
    if (!environment.PATH) {
      environment.PATH = "/usr/local/bin:/usr/bin:/bin"
    }

    // Add common Node.js paths to PATH if not already present
    const additionalPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      path.join(os.homedir(), ".npm-global", "bin"),
      path.join(os.homedir(), "node_modules", ".bin"),
    ]

    const pathSeparator = process.platform === "win32" ? ";" : ":"
    const currentPaths = environment.PATH.split(pathSeparator)

    for (const additionalPath of additionalPaths) {
      if (!currentPaths.includes(additionalPath)) {
        environment.PATH += pathSeparator + additionalPath
      }
    }

    // Add server-specific environment variables
    if (serverEnv) {
      Object.assign(environment, serverEnv)
    }

    return environment
  }

  /**
   * Shutdown all servers (alias for cleanup for backward compatibility)
   */
  async shutdown(): Promise<void> {
    await this.cleanup()
  }

  async cleanup(): Promise<void> {
    // Close all clients and transports
    for (const [serverName, client] of this.clients) {
      try {
        await client.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    for (const [serverName, transport] of this.transports) {
      try {
        await transport.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Gracefully terminate server processes
    await this.terminateAllServerProcesses()

    // Clear all maps
    this.clients.clear()
    this.transports.clear()
    this.serverProcesses.clear()
    this.availableTools = []
  }

  /**
   * Gracefully terminate all MCP server processes
   */
  async terminateAllServerProcesses(): Promise<void> {
    const terminationPromises: Promise<void>[] = []

    for (const [serverName, process] of this.serverProcesses) {
      terminationPromises.push(
        new Promise<void>((resolve) => {
          if (process.killed || process.exitCode !== null) {
            resolve()
            return
          }

          // Try graceful shutdown first
          process.kill("SIGTERM")

          // Force kill after timeout
          const forceKillTimeout = setTimeout(() => {
            if (!process.killed && process.exitCode === null) {
              process.kill("SIGKILL")
            }
            resolve()
          }, 3000) // 3 second timeout

          process.on("exit", () => {
            clearTimeout(forceKillTimeout)
            resolve()
          })
        }),
      )
    }

    await Promise.all(terminationPromises)
  }

  /**
   * Register all existing MCP server processes with the agent process manager
   * This is called when agent mode is activated to ensure all processes are tracked
   */
  registerExistingProcessesWithAgentManager(): void {
    for (const [serverName, process] of this.serverProcesses) {
      if (!process.killed && process.exitCode === null) {
        agentProcessManager.registerProcess(process)
      }
    }
  }

  /**
   * Emergency stop - immediately kill all MCP server processes
   */
  emergencyStopAllProcesses(): void {
    for (const [serverName, process] of this.serverProcesses) {
      try {
        if (!process.killed && process.exitCode === null) {
          process.kill("SIGKILL")
        }
      } catch (error) {
        // Ignore errors during emergency stop
      }
    }
    this.serverProcesses.clear()
  }
}

export const mcpService = new MCPService()
