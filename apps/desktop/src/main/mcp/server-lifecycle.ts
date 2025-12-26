import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type {
  CreateMessageResult,
  ElicitResult,
  ClientCapabilities,
} from "@modelcontextprotocol/sdk/types.js"
import { MCPServerConfig, Config } from "../../shared/types"
import { configStore } from "../config"
import { normalizeMcpConfig, inferTransportType } from "../../shared/mcp-utils"
import { diagnosticsService } from "../diagnostics"
import { isDebugTools, logTools } from "../debug"
import { requestElicitation, handleElicitationComplete, cancelAllElicitations } from "../mcp-elicitation"
import { requestSampling, cancelAllSamplingRequests } from "../mcp-sampling"
import { TransportFactory } from "./transport-factory"
import { OAuthManager } from "./oauth-manager"
import { ToolManager } from "./tool-manager"
import { ServerStateManager } from "./server-state"
import { ServerLogger } from "./server-logger"

/**
 * ServerLifecycleManager handles initialization, connection, and cleanup of MCP servers
 * Manages the complete lifecycle of server connections
 */
export class ServerLifecycleManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<
    string,
    | StdioClientTransport
    | WebSocketClientTransport
    | StreamableHTTPClientTransport
  > = new Map()

  private isInitializing = false
  private initializationPromise: Promise<void> | null = null
  private initializationProgress: {
    current: number
    total: number
    currentServer?: string
  } = { current: 0, total: 0 }
  private hasBeenInitialized = false

  private transportFactory: TransportFactory
  private oauthManager: OAuthManager
  private toolManager: ToolManager
  private serverStateManager: ServerStateManager
  private serverLogger: ServerLogger

  constructor(
    transportFactory: TransportFactory,
    oauthManager: OAuthManager,
    toolManager: ToolManager,
    serverStateManager: ServerStateManager,
    serverLogger: ServerLogger
  ) {
    this.transportFactory = transportFactory
    this.oauthManager = oauthManager
    this.toolManager = toolManager
    this.serverStateManager = serverStateManager
    this.serverLogger = serverLogger
  }

  /**
   * Initialize all MCP servers from configuration
   */
  async initialize(): Promise<void> {
    // If initialization is already in progress, return the existing promise
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    // Create and store the initialization promise
    this.initializationPromise = (async () => {
      try {
        this.isInitializing = true
        this.initializationProgress = { current: 0, total: 0 }

        const baseConfig = configStore.get()
        const { normalized: normalizedMcpConfig, changed: mcpConfigChanged } = normalizeMcpConfig(
          baseConfig.mcpConfig || { mcpServers: {} },
        )

        const config: Config = mcpConfigChanged
          ? { ...baseConfig, mcpConfig: normalizedMcpConfig }
          : baseConfig

        if (mcpConfigChanged) {
          configStore.save(config)
        }

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
          this.toolManager.clearAllTools()
          this.isInitializing = false
          this.hasBeenInitialized = true
          return
        }

        const serversToInitialize = Object.entries(mcpConfig.mcpServers).filter(
          ([serverName, serverConfig]) => {
            if ((serverConfig as MCPServerConfig).disabled) {
              if (isDebugTools()) {
                logTools(`Skipping server ${serverName} - disabled in config`)
              }
              return false
            }

            if (!this.serverStateManager.isServerRuntimeEnabled(serverName)) {
              if (isDebugTools()) {
                logTools(`Skipping server ${serverName} - runtime disabled by user`)
              }
              return false
            }

            if (!this.hasBeenInitialized) {
              return true
            }

            const alreadyInitialized = this.serverStateManager.isServerInitialized(serverName)
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
            this.serverStateManager.markServerInitialized(serverName)
            if (isDebugTools()) {
              logTools(`Successfully initialized server: ${serverName}`)
            }
          } catch (error) {
            if (isDebugTools()) {
              logTools(`Failed to initialize server: ${serverName}`, error)
            }
          }

          this.initializationProgress.current++
        }

        this.isInitializing = false
        this.hasBeenInitialized = true

        if (isDebugTools()) {
          logTools(`MCP Service initialization complete. Total tools available: ${this.toolManager.getAllTools().length}`)
        }
      } finally {
        this.initializationPromise = null
      }
    })()

    return this.initializationPromise
  }

  /**
   * Initialize a single MCP server
   */
  async initializeServer(
    serverName: string,
    serverConfig: MCPServerConfig,
    options: { allowAutoOAuth?: boolean } = {},
  ): Promise<void> {
    diagnosticsService.logInfo(
      "mcp-service",
      `Initializing server: ${serverName}`,
    )

    if (isDebugTools()) {
      logTools(`Initializing server: ${serverName}`, {
        transport: inferTransportType(serverConfig),
        command: serverConfig.command,
        args: serverConfig.args,
        env: Object.keys(serverConfig.env || {}),
      })
    }

    // Remove any existing tools from this server to prevent duplicates
    this.toolManager.removeToolsFromServer(serverName)

    try {
      const transportType = inferTransportType(serverConfig)

      // Initialize log storage for this server
      this.serverLogger.initializeServerLogs(serverName)

      // Create appropriate transport based on configuration
      let transport = await this.transportFactory.createTransport(
        serverName,
        serverConfig,
        serverConfig.oauth
          ? () => this.oauthManager.getValidToken(serverName, serverConfig)
          : undefined
      )

      // For stdio transport, capture logs from the transport's stderr
      if (transportType === "stdio" && transport instanceof StdioClientTransport) {
        const stderrStream = transport.stderr

        if (stderrStream) {
          stderrStream.on('data', (data) => {
            const message = data.toString()
            this.serverLogger.addLogEntry(serverName, message)
            if (isDebugTools()) {
              logTools(`[${serverName}] ${message}`)
            }
          })
        }
      }

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
            capabilities: this.getClientCapabilities(),
          },
        )

        // Set up request handlers for elicitation and sampling
        this.setupClientRequestHandlers(client, serverName)

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

          // Only attempt automatic OAuth if explicitly allowed
          if (options.allowAutoOAuth) {
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
            transport = await this.oauthManager.handle401AndRetryWithOAuth(serverName, serverConfig)

            // Create new client
            client = new Client(
              {
                name: "speakmcp-mcp-client",
                version: "1.0.0",
              },
              {
                capabilities: this.getClientCapabilities(),
              },
            )

            // Set up request handlers
            this.setupClientRequestHandlers(client, serverName)

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
            // During app startup, don't trigger OAuth flow automatically
            diagnosticsService.logInfo("mcp-service", `Server ${serverName} requires OAuth authentication - user must manually authenticate`)

            // Clean up the failed client
            if (client) {
              try {
                await client.close()
              } catch (closeError) {
                // Ignore close errors
              }
            }

            throw new Error(`Server requires OAuth authentication. Please configure OAuth settings and authenticate manually.`)
          }
        } else {
          // Re-throw non-401 errors
          throw error
        }
      }

      // Store the client and transport
      this.clients.set(serverName, client!)
      this.transports.set(serverName, transport)

      // Get available tools from the server
      const toolsResult = await client!.listTools()

      if (isDebugTools()) {
        logTools(`Server ${serverName} connected successfully`, {
          toolCount: toolsResult.tools.length,
          tools: toolsResult.tools.map(t => ({ name: t.name, description: t.description }))
        })
      }

      // Add tools to the tool manager
      this.toolManager.addToolsFromServer(serverName, toolsResult.tools)

      // For stdio transport, track the process
      if (transportType === "stdio" && transport instanceof StdioClientTransport) {
        const pid = transport.pid
        if (pid && isDebugTools()) {
          logTools(`[${serverName}] Process started with PID: ${pid}`)
        }
      }
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

  /**
   * Stop a specific MCP server
   */
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

  /**
   * Restart a specific MCP server
   */
  async restartServer(serverName: string): Promise<{ success: boolean; error?: string }> {
    try {
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

      // Reinitialize the server with auto-OAuth allowed (manual restart)
      await this.initializeServer(serverName, serverConfig, { allowAutoOAuth: true })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Clean up a server's resources
   */
  private cleanupServer(serverName: string): void {
    // Get transport before deleting
    const transport = this.transports.get(serverName)

    this.transports.delete(serverName)
    this.clients.delete(serverName)
    this.serverStateManager.removeInitializedServer(serverName)

    // Cancel any pending elicitation/sampling requests
    cancelAllElicitations(serverName)
    cancelAllSamplingRequests(serverName)

    // Close the transport
    if (transport) {
      try {
        transport.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Clear server logs
    this.serverLogger.deleteServerLogs(serverName)

    // Remove tools from this server
    this.toolManager.removeToolsFromServer(serverName)
  }

  /**
   * Get client capabilities for MCP protocol
   */
  private getClientCapabilities(): ClientCapabilities {
    return {
      // Enable elicitation support (form and URL mode)
      elicitation: {},
      // Enable sampling support (servers can request LLM completions)
      sampling: {},
      // Enable roots support (servers can list file system roots)
      roots: {
        listChanged: true,
      },
    }
  }

  /**
   * Set up request handlers for a connected client
   */
  private setupClientRequestHandlers(client: Client, serverName: string): void {
    // Handle elicitation requests from server
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      diagnosticsService.logInfo(
        "mcp-service",
        `Received elicitation request from ${serverName}: ${request.params?.message || "no message"}`
      )

      const params = request.params
      const requestId = `elicit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      if (params.mode === "url") {
        // URL mode elicitation
        const result = await requestElicitation({
          mode: "url",
          serverName,
          message: params.message,
          url: params.url,
          elicitationId: params.elicitationId,
          requestId,
        })
        return result as ElicitResult
      } else {
        // Form mode elicitation (default)
        const result = await requestElicitation({
          mode: "form",
          serverName,
          message: params.message,
          requestedSchema: params.requestedSchema as any,
          requestId,
        })
        return result as ElicitResult
      }
    })

    // Handle sampling requests from server
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      diagnosticsService.logInfo(
        "mcp-service",
        `Received sampling request from ${serverName}: ${request.params?.messages?.length || 0} messages`
      )

      const params = request.params
      const requestId = `sample_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      const result = await requestSampling({
        serverName,
        requestId,
        messages: params.messages as any,
        systemPrompt: params.systemPrompt,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
        modelPreferences: params.modelPreferences as any,
      })

      if (!result.approved) {
        throw new Error("Sampling request was declined by user")
      }

      return {
        role: "assistant",
        content: result.content || { type: "text", text: "" },
        model: result.model || "unknown",
        stopReason: result.stopReason,
      } as CreateMessageResult
    })

    // Handle elicitation complete notifications
    client.setNotificationHandler(ElicitationCompleteNotificationSchema, (notification) => {
      const elicitationId = notification.params?.elicitationId
      if (elicitationId) {
        diagnosticsService.logInfo(
          "mcp-service",
          `Received elicitation complete notification from ${serverName}: ${elicitationId}`
        )
        handleElicitationComplete(elicitationId)
      }
    })
  }

  /**
   * Get initialization status
   */
  getInitializationStatus(): {
    isInitializing: boolean
    progress: { current: number; total: number; currentServer?: string }
  } {
    return {
      isInitializing: this.isInitializing,
      progress: { ...this.initializationProgress },
    }
  }

  /**
   * Test server connection
   */
  async testServerConnection(
    serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    try {
      // Basic validation
      const transportType = inferTransportType(serverConfig)

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
          await this.transportFactory.resolveCommandPath(serverConfig.command)
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

      // Try to create a temporary connection
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

  /**
   * Create a test connection to verify server configuration
   */
  private async createTestConnection(
    serverName: string,
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
      transport = await this.transportFactory.createTransport(serverName, serverConfig)

      client = new Client(
        {
          name: "speakmcp-mcp-test-client",
          version: "1.0.0",
        },
        {
          capabilities: this.getClientCapabilities(),
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
        // Check if this is a 401 Unauthorized error
        if (serverConfig.transport === "streamableHttp" &&
            error instanceof Error &&
            (error.message.includes("HTTP 401") || error.message.includes("invalid_token"))) {
          return {
            success: false,
            error: "Server requires OAuth authentication. Please configure OAuth settings and authenticate.",
          }
        } else {
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

  /**
   * Cleanup all servers
   */
  async cleanup(): Promise<void> {
    // Close all clients
    for (const [serverName, client] of this.clients) {
      try {
        await client.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Close all transports
    for (const [serverName, transport] of this.transports) {
      try {
        await transport.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Terminate server processes
    await this.terminateAllServerProcesses()

    // Clear all maps
    this.clients.clear()
    this.transports.clear()
    this.toolManager.clearAllTools()
  }

  /**
   * Gracefully terminate all MCP server processes
   */
  async terminateAllServerProcesses(): Promise<void> {
    const terminationPromises: Promise<void>[] = []

    for (const [serverName, transport] of this.transports) {
      terminationPromises.push(
        (async () => {
          try {
            await transport.close()
          } catch (error) {
            // Ignore errors during shutdown
          }
        })()
      )
    }

    await Promise.all(terminationPromises)
  }

  /**
   * Emergency stop - immediately kill all MCP server processes
   */
  emergencyStopAllProcesses(): void {
    for (const [serverName, transport] of this.transports) {
      try {
        transport.close()
      } catch (error) {
        // Ignore errors during emergency stop
      }
    }
    this.transports.clear()
  }

  /**
   * Get server status for all configured servers
   */
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

    // Include all configured servers
    if (mcpConfig?.mcpServers) {
      for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
        const client = this.clients.get(serverName)
        const transport = this.transports.get(serverName)
        const toolCount = this.toolManager.getAllTools().filter((tool) =>
          tool.name.startsWith(`${serverName}:`),
        ).length

        status[serverName] = {
          connected: !!client && !!transport,
          toolCount,
          runtimeEnabled: this.serverStateManager.isServerRuntimeEnabled(serverName),
          configDisabled: !!(serverConfig as MCPServerConfig).disabled,
        }
      }
    }

    // Include connected servers not in config (edge case)
    for (const [serverName, client] of this.clients) {
      if (!status[serverName]) {
        const transport = this.transports.get(serverName)
        const toolCount = this.toolManager.getAllTools().filter((tool) =>
          tool.name.startsWith(`${serverName}:`),
        ).length

        status[serverName] = {
          connected: !!client && !!transport,
          toolCount,
          runtimeEnabled: this.serverStateManager.isServerRuntimeEnabled(serverName),
          configDisabled: false,
        }
      }
    }

    // Add built-in server
    status[BUILTIN_SERVER_NAME] = {
      connected: true,
      toolCount: builtinTools.length,
      runtimeEnabled: true,
      configDisabled: false,
    }

    return status
  }

  /**
   * Get client for a server
   */
  getClient(serverName: string): Client | undefined {
    return this.clients.get(serverName)
  }

  /**
   * Get all clients
   */
  getAllClients(): Map<string, Client> {
    return this.clients
  }

  /**
   * Get transport for a server
   */
  getTransport(serverName: string): StdioClientTransport | WebSocketClientTransport | StreamableHTTPClientTransport | undefined {
    return this.transports.get(serverName)
  }
}

// Import at the end to avoid circular dependencies
import { builtinTools, BUILTIN_SERVER_NAME } from "../builtin-tools"
