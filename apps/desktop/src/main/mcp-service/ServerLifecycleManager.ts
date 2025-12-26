import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js"
import {
  ElicitRequestSchema,
  CreateMessageRequestSchema,
  ElicitationCompleteNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type {
  ElicitResult,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js"
import { MCPServerConfig } from "../../shared/types"
import { inferTransportType } from "../../shared/mcp-utils"
import { diagnosticsService } from "../diagnostics"
import { isDebugTools, logTools } from "../debug"
import { requestElicitation, handleElicitationComplete, cancelAllElicitations } from "../mcp-elicitation"
import { requestSampling, cancelAllSamplingRequests } from "../mcp-sampling"
import { builtinTools, BUILTIN_SERVER_NAME } from "../builtin-tools"

/**
 * ServerLifecycleManager - Manages MCP server lifecycle
 *
 * Responsibilities:
 * - Server initialization and connection
 * - Server shutdown and cleanup
 * - Server restart
 * - Client request handlers (elicitation, sampling)
 * - Server status tracking
 */
export class ServerLifecycleManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<
    string,
    | StdioClientTransport
    | WebSocketClientTransport
    | StreamableHTTPClientTransport
  > = new Map()

  /**
   * Get the client capabilities to declare during initialization
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

    // Handle sampling requests from server (server wants to use our LLM)
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
        // User declined the sampling request
        throw new Error("Sampling request was declined by user")
      }

      // Return the sampling result in MCP format
      return {
        role: "assistant",
        content: result.content || { type: "text", text: "" },
        model: result.model || "unknown",
        stopReason: result.stopReason,
      } as CreateMessageResult
    })

    // Handle elicitation complete notifications (for URL mode)
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
   * Initialize a server
   */
  async initializeServer(
    serverName: string,
    serverConfig: MCPServerConfig,
    createTransport: (serverName: string, serverConfig: MCPServerConfig) => Promise<any>,
    addServerTools: (serverName: string, tools: any[]) => void,
    addLogEntry: (serverName: string, message: string) => void,
    handle401AndRetryWithOAuth?: (serverName: string, serverConfig: MCPServerConfig) => Promise<any>,
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

    try {
      const transportType = inferTransportType(serverConfig)

      // Create appropriate transport based on configuration
      let transport = await createTransport(serverName, serverConfig)

      // For stdio transport, capture logs from the transport's stderr
      if (transportType === "stdio" && transport instanceof StdioClientTransport) {
        const stderrStream = transport.stderr

        if (stderrStream) {
          stderrStream.on('data', (data) => {
            const message = data.toString()
            addLogEntry(serverName, message)
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

          // Only attempt automatic OAuth if explicitly allowed (not during app startup)
          if (options.allowAutoOAuth && handle401AndRetryWithOAuth) {
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
            transport = await handle401AndRetryWithOAuth(serverName, serverConfig)

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

            // Set up request handlers for elicitation and sampling
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
            // Just log the requirement and let the server remain disconnected
            diagnosticsService.logInfo("mcp-service", `Server ${serverName} requires OAuth authentication - user must manually authenticate`)

            // Clean up the failed client
            if (client) {
              try {
                await client.close()
              } catch (closeError) {
                // Ignore close errors
              }
            }

            // Throw a specific error that indicates OAuth is required
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

      // Add tools via callback
      addServerTools(serverName, toolsResult.tools)

      // For stdio transport, track the process for agent mode
      if (transportType === "stdio" && transport instanceof StdioClientTransport) {
        const pid = transport.pid
        if (pid) {
          if (isDebugTools()) {
            logTools(`[${serverName}] Process started with PID: ${pid}`)
          }
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

      // Re-throw to let the caller handle it
      throw error
    }
  }

  /**
   * Stop a server
   */
  async stopServer(
    serverName: string,
    removeServerTools: (serverName: string) => void,
    deleteServerLogs: (serverName: string) => void
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

      // Clean up references
      this.cleanupServer(serverName, removeServerTools, deleteServerLogs)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Cleanup a server (internal)
   */
  private cleanupServer(
    serverName: string,
    removeServerTools: (serverName: string) => void,
    deleteServerLogs: (serverName: string) => void
  ): void {
    // Get transport before deleting
    const transport = this.transports.get(serverName)

    this.transports.delete(serverName)
    this.clients.delete(serverName)

    // Cancel any pending elicitation/sampling requests for this server
    cancelAllElicitations(serverName)
    cancelAllSamplingRequests(serverName)

    // Close the transport (which will terminate the process for stdio)
    if (transport) {
      try {
        transport.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Clear server logs
    deleteServerLogs(serverName)

    // Remove tools from this server
    removeServerTools(serverName)
  }

  /**
   * Restart a server
   */
  async restartServer(
    serverName: string,
    serverConfig: MCPServerConfig,
    createTransport: (serverName: string, serverConfig: MCPServerConfig) => Promise<any>,
    addServerTools: (serverName: string, tools: any[]) => void,
    addLogEntry: (serverName: string, message: string) => void,
    removeServerTools: (serverName: string) => void,
    deleteServerLogs: (serverName: string) => void,
    handle401AndRetryWithOAuth?: (serverName: string, serverConfig: MCPServerConfig) => Promise<any>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Clean up existing server
      await this.stopServer(serverName, removeServerTools, deleteServerLogs)

      // Reinitialize the server with auto-OAuth allowed (manual restart)
      await this.initializeServer(
        serverName,
        serverConfig,
        createTransport,
        addServerTools,
        addLogEntry,
        handle401AndRetryWithOAuth,
        { allowAutoOAuth: true }
      )

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Test server connection
   */
  async testServerConnection(
    serverName: string,
    serverConfig: MCPServerConfig,
    createTransport: (serverName: string, serverConfig: MCPServerConfig) => Promise<any>
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    let transport: any = null
    let client: Client | null = null

    try {
      // Create appropriate transport for testing
      transport = await createTransport(serverName, serverConfig)

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
        // Check if this is a 401 Unauthorized error for streamableHttp transport
        if (serverConfig.transport === "streamableHttp" &&
            error instanceof Error &&
            (error.message.includes("HTTP 401") || error.message.includes("invalid_token"))) {

          // For test connections, we don't want to initiate OAuth flow automatically
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

  /**
   * Get server status
   */
  getServerStatus(
    mcpServers: Record<string, MCPServerConfig>,
    runtimeDisabledServers: Set<string>,
    getToolCount: (serverName: string) => number
  ): Record<
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

    // Include all configured servers
    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      const client = this.clients.get(serverName)
      const transport = this.transports.get(serverName)
      const toolCount = getToolCount(serverName)

      status[serverName] = {
        connected: !!client && !!transport,
        toolCount,
        runtimeEnabled: !runtimeDisabledServers.has(serverName),
        configDisabled: !!(serverConfig as MCPServerConfig).disabled,
      }
    }

    // Also include any servers that are currently connected but not in config (edge case)
    for (const [serverName, client] of this.clients) {
      if (!status[serverName]) {
        const transport = this.transports.get(serverName)
        const toolCount = getToolCount(serverName)

        status[serverName] = {
          connected: !!client && !!transport,
          toolCount,
          runtimeEnabled: !runtimeDisabledServers.has(serverName),
          configDisabled: false,
        }
      }
    }

    // Add built-in settings server (always connected, always enabled)
    status[BUILTIN_SERVER_NAME] = {
      connected: true,
      toolCount: builtinTools.length,
      runtimeEnabled: true,
      configDisabled: false,
    }

    return status
  }

  /**
   * Cleanup all servers
   */
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

    // Gracefully terminate server processes via transports
    await this.terminateAllServerProcesses()

    // Clear all maps
    this.clients.clear()
    this.transports.clear()
  }

  /**
   * Gracefully terminate all MCP server processes
   */
  private async terminateAllServerProcesses(): Promise<void> {
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
        // Force close the transport (which will kill the process)
        transport.close()
      } catch (error) {
        // Ignore errors during emergency stop
      }
    }
    this.transports.clear()
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
  getClients(): Map<string, Client> {
    return this.clients
  }

  /**
   * Get transport for a server
   */
  getTransport(serverName: string): any {
    return this.transports.get(serverName)
  }
}
