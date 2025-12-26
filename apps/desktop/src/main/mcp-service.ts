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
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  ClientCapabilities,
} from "@modelcontextprotocol/sdk/types.js"
import { configStore } from "./config"
import {
  MCPConfig,
  MCPServerConfig,
  MCPTransportType,
  Config,
  ServerLogEntry,
  ProfilesData,
  ProfileMcpServerConfig,
  ConversationMcpConfig,
} from "../shared/types"
import { requestElicitation, handleElicitationComplete, cancelAllElicitations } from "./mcp-elicitation"
import { requestSampling, cancelAllSamplingRequests } from "./mcp-sampling"
import { inferTransportType, normalizeMcpConfig } from "../shared/mcp-utils"
import { spawn } from "child_process"
import { promisify } from "util"
import { access, constants, readFileSync, existsSync } from "fs"
import path from "path"
import os from "os"
import { diagnosticsService } from "./diagnostics"
import { state, agentProcessManager } from "./state"
import { OAuthClient } from "./oauth-client"
import { oauthStorage } from "./oauth-storage"
import { isDebugTools, logTools } from "./debug"
import { app, dialog } from "electron"
import { builtinTools, executeBuiltinTool, isBuiltinTool, BUILTIN_SERVER_NAME } from "./builtin-tools"

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
  private initializationPromise: Promise<void> | null = null
  private initializationProgress: {
    current: number
    total: number
    currentServer?: string
  } = { current: 0, total: 0 }

  private serverLogs: Map<string, ServerLogEntry[]> = new Map()
  private readonly MAX_LOG_ENTRIES = 1000

  private runtimeDisabledServers: Set<string> = new Set()
  private initializedServers: Set<string> = new Set()
  private hasBeenInitialized = false

  private activeResources = new Map<
    string,
    {
      serverId: string
      resourceId: string
      resourceType: string
      lastUsed: number
    }
  >()

  private sessionCleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.sessionCleanupInterval = setInterval(
      () => {
        this.cleanupInactiveResources()
      },
      5 * 60 * 1000,
    )

    try {
      const config = configStore.get()
      const persistedServers = config?.mcpRuntimeDisabledServers
      if (Array.isArray(persistedServers)) {
        for (const serverName of persistedServers) {
          this.runtimeDisabledServers.add(serverName)
        }
      }

      const persistedTools = config?.mcpDisabledTools
      if (Array.isArray(persistedTools)) {
        for (const toolName of persistedTools) {
          this.disabledTools.add(toolName)
        }
      }

      // Check if current profile has allServersDisabledByDefault enabled
      // If so, derive runtimeDisabledServers directly from enabledServers to avoid config/profile drift
      // This handles newly-added MCP servers and ensures servers in enabledServers are not disabled
      const profilesPath = path.join(
        app.getPath("appData"),
        process.env.APP_ID,
        "profiles.json"
      )
      if (existsSync(profilesPath)) {
        const profilesData = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesData
        const currentProfile = profilesData.profiles?.find(
          (p) => p.id === profilesData.currentProfileId
        )
        const mcpServerConfig = currentProfile?.mcpServerConfig
        if (mcpServerConfig?.allServersDisabledByDefault) {
          // Get all configured MCP server names
          const allServerNames = Object.keys(config?.mcpConfig?.mcpServers || {})
          const enabledServers = new Set(mcpServerConfig.enabledServers || [])

          // Derive runtimeDisabledServers directly from enabledServers (source of truth)
          // This avoids drift where stale mcpRuntimeDisabledServers contains servers
          // that are now in enabledServers
          this.runtimeDisabledServers.clear()
          for (const serverName of allServerNames) {
            if (!enabledServers.has(serverName)) {
              this.runtimeDisabledServers.add(serverName)
            }
          }

          // Persist the derived runtimeDisabledServers to configStore
          // This ensures status/reporting paths (e.g., list_mcp_servers, getDetailedToolList)
          // that read from configStore stay in sync with actual runtime state
          try {
            const updatedConfig: Config = {
              ...config,
              mcpRuntimeDisabledServers: Array.from(this.runtimeDisabledServers),
            }
            configStore.save(updatedConfig)
          } catch (persistError) {
            // Ignore persistence errors; runtime state will still be respected in-session
          }
        }
      }
    } catch (e) {}

  }

  /**
   * Get the client capabilities to declare during initialization.
   * This enables elicitation (form and URL mode) and sampling support.
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
   * Set up request handlers for a connected client.
   * These handlers process incoming requests from MCP servers.
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

  getTrackedResources(): Array<{
    serverId: string
    resourceId: string
    resourceType: string
    lastUsed: number
  }> {
    return Array.from(this.activeResources.values())
  }

  private trackResourceFromResult(
    serverName: string,
    result: MCPToolResult,
  ): void {
    if (!result.isError && result.content[0]?.text) {
      const text = result.content[0].text

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
          this.availableTools = []
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

        if (this.runtimeDisabledServers.has(serverName)) {
          if (isDebugTools()) {
            logTools(`Skipping server ${serverName} - runtime disabled by user`)
          }
          return false
        }

        if (!this.hasBeenInitialized) {
          return true
        }

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
      } finally {
        // Always clear the initialization promise so subsequent calls can re-run if needed
        this.initializationPromise = null
      }
    })()

    return this.initializationPromise
  }

  private async createTransport(
    serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<
    | StdioClientTransport
    | WebSocketClientTransport
    | StreamableHTTPClientTransport
  > {
    const transportType = inferTransportType(serverConfig)

    switch (transportType) {
      case "stdio":
        if (!serverConfig.command) {
          throw new Error("Command is required for stdio transport")
        }
        const resolvedCommand = await this.resolveCommandPath(
          serverConfig.command,
        )
        const environment = await this.prepareEnvironment(serverConfig.env)

        // Create transport with stderr piped so we can capture logs
        const transport = new StdioClientTransport({
          command: resolvedCommand,
          args: serverConfig.args || [],
          env: environment,
          stderr: "pipe", // Pipe stderr so we can capture it
        })

        return transport

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
    options: { allowAutoOAuth?: boolean } = {},
  ) {
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
    // This handles cases where initializeServer is called multiple times
    // (e.g., reconnection, OAuth retry, profile switch)
    this.availableTools = this.availableTools.filter(
      (tool) => !tool.name.startsWith(`${serverName}:`),
    )

    try {
      const transportType = inferTransportType(serverConfig)

      // Initialize log storage for this server
      this.serverLogs.set(serverName, [])

      // Create appropriate transport based on configuration
      let transport = await this.createTransport(serverName, serverConfig)

      // For stdio transport, capture logs from the transport's stderr
      if (transportType === "stdio" && transport instanceof StdioClientTransport) {
        const stderrStream = transport.stderr

        if (stderrStream) {
          stderrStream.on('data', (data) => {
            const message = data.toString()
            this.addLogEntry(serverName, message)
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
            transport = await this.handle401AndRetryWithOAuth(serverName, serverConfig)

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

      // For stdio transport, track the process for agent mode
      if (transportType === "stdio" && transport instanceof StdioClientTransport) {
        const pid = transport.pid
        if (pid) {
          // We need to get the actual ChildProcess object to track it
          // Unfortunately, the SDK doesn't expose the process directly
          // So we'll store the PID for now and handle cleanup via the transport
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

      // Clean up any partial initialization
      this.cleanupServer(serverName)

      // Re-throw to let the caller handle it
      throw error
    }
  }

  private cleanupServer(serverName: string) {
    // Get transport before deleting
    const transport = this.transports.get(serverName)

    this.transports.delete(serverName)
    this.clients.delete(serverName)
    this.initializedServers.delete(serverName)

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
    this.serverLogs.delete(serverName)

    // Remove tools from this server
    this.availableTools = this.availableTools.filter(
      (tool) => !tool.name.startsWith(`${serverName}:`),
    )
  }

  /**
   * Set runtime enabled/disabled state for a server
   * This is separate from the config disabled flag and represents user preference
   * Also auto-saves to the current profile's mcpServerConfig
   *
   * NOTE: Disabling a server only hides its tools from the current profile.
   * The server process continues running to avoid disrupting other sessions
   * that may still need it. Servers are persistent infrastructure.
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
      // Server continues running - we only hide its tools from the current profile
      // This avoids disrupting running agent sessions that may still need the server
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

    // Auto-save to current profile so switching profiles restores this state
    this.saveCurrentStateToProfile()

    return true
  }

  /**
   * Get the runtime enabled state of a server
   */
  isServerRuntimeEnabled(serverName: string): boolean {
    return !this.runtimeDisabledServers.has(serverName)
  }

  /**
   * Apply MCP configuration from a profile
   * This updates the runtime enabled/disabled state for servers and tools
   *
   * NOTE: Disabling servers only hides their tools from the current profile.
   * Server processes continue running to avoid disrupting other sessions.
   * Servers are persistent infrastructure that should remain available.
   *
   * @param disabledServers - Array of server names to disable (only used when allServersDisabledByDefault is false)
   * @param disabledTools - Array of tool names to disable
   * @param allServersDisabledByDefault - If true, ALL servers are disabled except those in enabledServers (strict opt-in mode, disabledServers is ignored). If false, only servers in disabledServers are disabled.
   * @param enabledServers - When allServersDisabledByDefault is true, servers in this list are explicitly enabled (user opt-in)
   */
  applyProfileMcpConfig(disabledServers?: string[], disabledTools?: string[], allServersDisabledByDefault?: boolean, enabledServers?: string[]): void {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})

    // Reset runtime disabled servers based on profile config
    // Enable all servers first, then disable those specified in the profile
    // NOTE: We only update the runtimeDisabledServers set - we do NOT stop server processes
    // This ensures running agent sessions aren't disrupted when switching profiles
    this.runtimeDisabledServers.clear()

    if (allServersDisabledByDefault) {
      // When allServersDisabledByDefault is true, disable ALL servers EXCEPT those explicitly enabled
      // enabledServers contains servers the user has opted-in to use for this profile
      const enabledSet = new Set(enabledServers || [])
      for (const serverName of allServerNames) {
        if (!enabledSet.has(serverName)) {
          this.runtimeDisabledServers.add(serverName)
          // Server continues running - we only hide its tools from the current profile
        }
      }
    } else if (disabledServers && disabledServers.length > 0) {
      // Only disable explicitly listed servers
      for (const serverName of disabledServers) {
        // Only add if server exists in config
        if (allServerNames.includes(serverName)) {
          this.runtimeDisabledServers.add(serverName)
          // Server continues running - we only hide its tools from the current profile
        }
      }
    }

    // Reset disabled tools based on profile config
    // We add all profile-specified disabled tools without checking availableTools
    // because servers may not be initialized yet. When servers start later,
    // their tools will be correctly filtered out by getAvailableTools().
    // Orphaned tool names are cleaned up by cleanupOrphanedTools().
    this.disabledTools.clear()

    if (disabledTools && disabledTools.length > 0) {
      for (const toolName of disabledTools) {
        this.disabledTools.add(toolName)
      }
    }

    // Persist the new state to config
    try {
      const cfg: Config = {
        ...config,
        mcpRuntimeDisabledServers: Array.from(this.runtimeDisabledServers),
        mcpDisabledTools: Array.from(this.disabledTools),
      }
      configStore.save(cfg)

      if (isDebugTools()) {
        logTools(`Applied profile MCP config: ${this.runtimeDisabledServers.size} servers disabled, ${this.disabledTools.size} tools disabled`)
      }
    } catch (e) {
      // Ignore persistence errors; runtime state will still be respected in-session
    }

    // Start any servers that are now enabled and were not previously running
    for (const serverName of allServerNames) {
      const serverConfig = mcpConfig?.mcpServers?.[serverName]
      if (
        serverConfig &&
        !serverConfig.disabled &&
        !this.runtimeDisabledServers.has(serverName) &&
        !this.initializedServers.has(serverName)
      ) {
        // Initialize the server
        this.initializeServer(serverName, serverConfig, { allowAutoOAuth: false }).catch((error) => {
          if (isDebugTools()) {
            logTools(`Failed to start server ${serverName} after profile switch: ${error}`)
          }
        })
      }
    }
  }

  /**
   * Get current MCP configuration state (for saving to profile)
   */
  getCurrentMcpConfigState(): { disabledServers: string[], disabledTools: string[], enabledServers: string[] } {
    // Calculate enabled servers as all servers minus disabled servers
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    const enabledServers = allServerNames.filter(name => !this.runtimeDisabledServers.has(name))

    return {
      disabledServers: Array.from(this.runtimeDisabledServers),
      disabledTools: Array.from(this.disabledTools),
      enabledServers,
    }
  }

  /**
   * Save current MCP server/tool state to the current profile
   * This is called automatically when server or tool state changes
   */
  private saveCurrentStateToProfile(): void {
    try {
      // Dynamic import to avoid circular dependency
      import("./profile-service").then(({ profileService }) => {
        const currentProfileId = profileService.getCurrentProfile()?.id
        if (!currentProfileId) return

        const state = this.getCurrentMcpConfigState()
        profileService.saveCurrentMcpStateToProfile(
          currentProfileId,
          state.disabledServers,
          state.disabledTools,
          state.enabledServers
        )

        if (isDebugTools()) {
          logTools(`Auto-saved MCP state to profile ${currentProfileId}: ${state.disabledServers.length} servers disabled, ${state.enabledServers.length} servers enabled, ${state.disabledTools.length} tools disabled`)
        }
      }).catch(() => {
        // Ignore errors - profile save is best-effort
      })
    } catch (e) {
      // Ignore errors - profile save is best-effort
    }
  }

  /**
   * Clean up tools from servers that no longer exist in configuration
   * This prevents accumulation of orphaned tools from deleted servers
   */
  private cleanupOrphanedTools(): void {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const configuredServers = mcpConfig?.mcpServers || {}

    // Remove tools from servers that no longer exist in config
    this.availableTools = this.availableTools.filter((tool) => {
      const serverName = tool.name.includes(":")
        ? tool.name.split(":")[0]
        : "unknown"
      return configuredServers[serverName] !== undefined
    })

    // Also clean up disabled tools for non-existent servers
    // BUT preserve built-in tools (speakmcp-settings) since they're not in mcpServers config
    const orphanedDisabledTools = Array.from(this.disabledTools).filter((toolName) => {
      const serverName = toolName.includes(":")
        ? toolName.split(":")[0]
        : "unknown"
      // Built-in tools are not orphaned - they're always valid
      if (serverName === BUILTIN_SERVER_NAME) {
        return false
      }
      return configuredServers[serverName] === undefined
    })

    if (orphanedDisabledTools.length > 0) {
      for (const toolName of orphanedDisabledTools) {
        this.disabledTools.delete(toolName)
      }

      // Persist the cleanup to config
      try {
        const config = configStore.get()
        const cfg: Config = {
          ...config,
          mcpDisabledTools: Array.from(this.disabledTools),
        }
        configStore.save(cfg)
      } catch (e) {
        // Ignore persistence errors
      }
    }
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

  /**
   * Filter tool responses to reduce context size
   * Uses a 50KB threshold - MCP servers handle their own pagination
   */
  private filterToolResponse(
    _serverName: string,
    _toolName: string,
    content: Array<{ type: string; text: string }>
  ): Array<{ type: string; text: string }> {
    const TRUNCATION_LIMIT = 50000
    return content.map((item) => {
      if (item.text.length > TRUNCATION_LIMIT) {
        return {
          type: item.type,
          text: item.text.substring(0, TRUNCATION_LIMIT) + '\n\n[truncated]'
        }
      }
      return item
    })
  }

  /**
   * Process large tool responses with chunking and summarization
   */
  private async processLargeToolResponse(
    serverName: string,
    toolName: string,
    content: Array<{ type: string; text: string }>,
    onProgress?: (message: string) => void
  ): Promise<Array<{ type: string; text: string }>> {
    const config = configStore.get()

    // Use configurable thresholds
    const LARGE_RESPONSE_THRESHOLD = config.mcpToolResponseLargeThreshold ?? 20000
    const CRITICAL_RESPONSE_THRESHOLD = config.mcpToolResponseCriticalThreshold ?? 50000

    // Check if processing is enabled
    if (!config.mcpToolResponseProcessingEnabled) {
      return content // Return unprocessed if disabled
    }

    return Promise.all(content.map(async (item) => {
      const responseSize = item.text.length

      // Small responses - no additional processing needed
      if (responseSize < LARGE_RESPONSE_THRESHOLD) {
        return item
      }

      // Large responses - apply intelligent summarization
      if (responseSize >= CRITICAL_RESPONSE_THRESHOLD) {
        // Notify user of processing if enabled
        if (onProgress && config.mcpToolResponseProgressUpdates) {
          onProgress(`Processing large response from ${serverName}:${toolName} (${Math.round(responseSize/1000)}KB)`)
        }

        // For very large responses, use aggressive summarization
        const summarized = await this.summarizeLargeResponse(
          item.text,
          serverName,
          toolName,
          'aggressive',
          onProgress
        )
        return {
          type: item.type,
          text: `[summarized]\n${summarized}`
        }
      } else {
        // Notify user of processing if enabled
        if (onProgress && config.mcpToolResponseProgressUpdates) {
          onProgress(`Processing response from ${serverName}:${toolName} (${Math.round(responseSize/1000)}KB)`)
        }

        // For moderately large responses, use gentle summarization
        const summarized = await this.summarizeLargeResponse(
          item.text,
          serverName,
          toolName,
          'gentle',
          onProgress
        )
        return {
          type: item.type,
          text: summarized
        }
      }
    }))
  }

  /**
   * Summarize large responses with context-aware strategies
   */
  private async summarizeLargeResponse(
    content: string,
    serverName: string,
    toolName: string,
    strategy: 'gentle' | 'aggressive',
    onProgress?: (message: string) => void
  ): Promise<string> {
    try {
      // Import summarization function from context-budget
      const { summarizeContent } = await import('./context-budget')

      // Create context-aware prompt based on server and tool
      const contextPrompt = this.createSummarizationPrompt(serverName, toolName, strategy)

      // For very large content, chunk it first
      if (content.length > 30000) {
        const config = configStore.get()
        if (onProgress && config.mcpToolResponseProgressUpdates) {
          onProgress(`Chunking large response (${Math.round(content.length/1000)}KB) for processing`)
        }
        return await this.chunkAndSummarize(content, contextPrompt, strategy, onProgress)
      }

      // For moderately large content, summarize directly
      const config = configStore.get()
      if (onProgress && config.mcpToolResponseProgressUpdates) {
        onProgress(`Summarizing response content`)
      }
      return await summarizeContent(content)
    } catch (error) {
      logTools('Failed to summarize large response:', error)
      // Fallback to simple truncation
      const maxLength = strategy === 'aggressive' ? 2000 : 5000
      return content.substring(0, maxLength) + '\n\n[truncated]'
    }
  }

  /**
   * Create summarization prompts
   * Uses generic prompts for all servers - no server-specific logic
   */
  private createSummarizationPrompt(
    serverName: string,
    toolName: string,
    strategy: 'gentle' | 'aggressive'
  ): string {
    const basePrompt = strategy === 'aggressive'
      ? 'Aggressively summarize this content, keeping only the most essential information:'
      : 'Summarize this content while preserving important details:'

    return `${basePrompt} This is output from ${serverName}:${toolName}.`
  }

  /**
   * Chunk large content and summarize each chunk
   */
  private async chunkAndSummarize(
    content: string,
    contextPrompt: string,
    strategy: 'gentle' | 'aggressive',
    onProgress?: (message: string) => void
  ): Promise<string> {
    const config = configStore.get()
    const baseChunkSize = config.mcpToolResponseChunkSize ?? 15000
    const chunkSize = strategy === 'aggressive' ? Math.floor(baseChunkSize * 0.67) : baseChunkSize
    const chunks: string[] = []

    // Split content into manageable chunks
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize))
    }

    // Summarize each chunk
    const { summarizeContent } = await import('./context-budget')
    const summarizedChunks = await Promise.all(
      chunks.map(async (chunk, index) => {
        const config = configStore.get()
        if (onProgress && config.mcpToolResponseProgressUpdates) {
          onProgress(`Summarizing chunk ${index + 1}/${chunks.length}`)
        }
        const chunkPrompt = `${contextPrompt} (Part ${index + 1}/${chunks.length})\n\n${chunk}`
        return await summarizeContent(chunkPrompt)
      })
    )

    // Combine summarized chunks
    const combined = summarizedChunks.join('\n\n---\n\n')

    // If combined result is still too large, summarize once more
    if (combined.length > (strategy === 'aggressive' ? 3000 : 8000)) {
      const config = configStore.get()
      if (onProgress && config.mcpToolResponseProgressUpdates) {
        onProgress(`Creating final summary from ${chunks.length} processed chunks`)
      }
      const finalPrompt = `${contextPrompt} (Final summary of ${chunks.length} parts)\n\n${combined}`
      return await summarizeContent(finalPrompt)
    }

    return combined
  }

  private async executeServerTool(
    serverName: string,
    toolName: string,
    arguments_: any,
    onProgress?: (message: string) => void
  ): Promise<MCPToolResult> {
    const client = this.clients.get(serverName)
    if (!client) {
      throw new Error(`Server ${serverName} not found or not connected`)
    }

    // Enhanced argument processing with session injection
    let processedArguments = { ...arguments_ }

    // Auto-fix common parameter type mismatches based on tool schema
    if (client && this.availableTools.length > 0) {
      const toolSchema = this.availableTools.find(t => t.name === `${serverName}:${toolName}`)?.inputSchema
      if (toolSchema?.properties) {
        for (const [paramName, paramValue] of Object.entries(processedArguments)) {
          const expectedType = toolSchema.properties[paramName]?.type
          if (expectedType && typeof paramValue !== expectedType) {
            // Convert common type mismatches
            if (expectedType === 'string' && Array.isArray(paramValue)) {
              processedArguments[paramName] = paramValue.length === 0 ? "" : paramValue.join(", ")
            } else if (expectedType === 'array' && typeof paramValue === 'string') {
              processedArguments[paramName] = paramValue ? [paramValue] : []
            } else if (expectedType === 'number' && typeof paramValue === 'string') {
              const num = parseFloat(paramValue)
              if (!isNaN(num)) processedArguments[paramName] = num
            } else if (expectedType === 'boolean' && typeof paramValue === 'string') {
              processedArguments[paramName] = paramValue.toLowerCase() === 'true'
            }
          }
        }

        // Enum normalization based on tool schema (schema-driven; no tool-specific logic)
        for (const [paramName, paramValue] of Object.entries(processedArguments)) {
          const schema = (toolSchema as any)?.properties?.[paramName]
          const enumVals = schema?.enum
          if (Array.isArray(enumVals) && !enumVals.includes(paramValue)) {
            const toStr = (v: any) => (typeof v === "string" ? v : String(v))
            const pv = toStr(paramValue).trim()
            // Case-insensitive match first
            const ci = enumVals.find((ev: any) => toStr(ev).toLowerCase() === pv.toLowerCase())
            if (ci !== undefined) {
              processedArguments[paramName] = ci
              continue
            }
            // Generic synonym mapping (kept generic so it works across tools & flows)
            const synMap: Record<string, string> = {
              complex: "hard",
              complicated: "hard",
              difficult: "hard",
              hard: "hard",
              moderate: "medium",
              avg: "medium",
              average: "medium",
              medium: "medium",
              simple: "easy",
              basic: "easy",
              straightforward: "easy",
              easy: "easy",
              high: "high",
              low: "low",
              maximum: "high",
              minimum: "low",
              max: "high",
              min: "low",
            }
            const syn = synMap[pv.toLowerCase()]
            if (syn) {
              const target = enumVals.find((ev: any) => toStr(ev).toLowerCase() === syn)
              if (target !== undefined) {
                processedArguments[paramName] = target
              }
            }
          }
        }

      }
    }

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

      // Apply response filtering to reduce context size
      const filteredContent = this.filterToolResponse(serverName, toolName, content)

      // Check if response needs further processing for context management
      const processedContent = await this.processLargeToolResponse(
        serverName,
        toolName,
        filteredContent,
        onProgress
      )

      const finalResult: MCPToolResult = {
        content: processedContent.map(item => ({
          type: "text" as const,
          text: item.text
        })),
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
    // Filter out tools from runtime-disabled servers
    // This ensures that when switching profiles, tools from disabled servers
    // are immediately unavailable even before the async stopServer completes
    const enabledExternalTools = this.availableTools.filter((tool) => {
      const serverName = tool.name.includes(":")
        ? tool.name.split(":")[0]
        : "unknown"
      return !this.runtimeDisabledServers.has(serverName)
    })

    // Combine external MCP tools with built-in tools
    const allTools = [...enabledExternalTools, ...builtinTools]
    const enabledTools = allTools.filter(
      (tool) => !this.disabledTools.has(tool.name),
    )
    return enabledTools
  }

  /**
   * Get available tools filtered by a specific profile's MCP server configuration.
   * This is used for session isolation - ensuring a session uses the tool configuration
   * from when it was created, not the current global profile.
   *
   * @param profileMcpConfig - The profile's MCP server configuration to filter by
   * @returns Tools filtered according to the profile's enabled/disabled servers and tools
   */
  getAvailableToolsForProfile(profileMcpConfig?: ProfileMcpServerConfig): MCPTool[] {
    // If no profile config, return all available tools (minus globally disabled tools)
    if (!profileMcpConfig) {
      // Return all tools without profile-specific filtering
      const allTools = [...this.availableTools, ...builtinTools]
      return allTools.filter((tool) => !this.disabledTools.has(tool.name))
    }

    const { allServersDisabledByDefault, enabledServers, disabledServers, disabledTools } = profileMcpConfig

    // Determine which servers are enabled for this profile
    const config = configStore.get()
    const allServerNames = Object.keys(config?.mcpConfig?.mcpServers || {})
    const profileDisabledServers = new Set<string>()

    if (allServersDisabledByDefault) {
      // When allServersDisabledByDefault is true, disable ALL servers EXCEPT those explicitly enabled
      const enabledSet = new Set(enabledServers || [])
      for (const serverName of allServerNames) {
        if (!enabledSet.has(serverName)) {
          profileDisabledServers.add(serverName)
        }
      }
    } else {
      // When allServersDisabledByDefault is false, only disable servers in disabledServers
      for (const serverName of disabledServers || []) {
        profileDisabledServers.add(serverName)
      }
    }

    // Also respect the profile's disabled tools
    const profileDisabledTools = new Set(disabledTools || [])

    // Filter external tools by server availability
    const enabledExternalTools = this.availableTools.filter((tool) => {
      const serverName = tool.name.includes(":")
        ? tool.name.split(":")[0]
        : "unknown"
      return !profileDisabledServers.has(serverName)
    })

    // Combine with built-in tools and filter by disabled tools
    const allTools = [...enabledExternalTools, ...builtinTools]
    return allTools.filter((tool) => !profileDisabledTools.has(tool.name))
  }

  /**
   * Get available tools for a conversation, optionally layering conversation-specific config
   * on top of profile config.
   *
   * Resolution hierarchy:
   * 1. If no conversationMcpConfig, use profile config only
   * 2. If conversationMcpConfig.inheritFromProfile is true, layer conversation config on profile config
   * 3. If conversationMcpConfig.inheritFromProfile is false, use only conversation config
   *
   * @param profileMcpConfig - The profile's MCP server configuration
   * @param conversationMcpConfig - Optional conversation-specific MCP configuration
   * @returns Tools filtered according to the layered configuration
   */
  getAvailableToolsForConversation(
    profileMcpConfig?: ProfileMcpServerConfig,
    conversationMcpConfig?: ConversationMcpConfig,
  ): MCPTool[] {
    // If no conversation config, fall back to profile-only filtering
    if (!conversationMcpConfig) {
      return this.getAvailableToolsForProfile(profileMcpConfig)
    }

    const config = configStore.get()
    const allServerNames = Object.keys(config?.mcpConfig?.mcpServers || {})
    const finalDisabledServers = new Set<string>()
    const finalDisabledTools = new Set<string>()

    if (conversationMcpConfig.inheritFromProfile && profileMcpConfig) {
      // Layer conversation config on top of profile config

      // Start with profile's disabled servers
      const { allServersDisabledByDefault, enabledServers, disabledServers, disabledTools } = profileMcpConfig

      if (allServersDisabledByDefault) {
        // Profile disables all servers by default, only enable explicitly enabled ones
        const enabledSet = new Set(enabledServers || [])
        for (const serverName of allServerNames) {
          if (!enabledSet.has(serverName)) {
            finalDisabledServers.add(serverName)
          }
        }
      } else {
        // Profile only disables specific servers
        for (const serverName of disabledServers || []) {
          finalDisabledServers.add(serverName)
        }
      }

      // Layer profile's disabled tools
      for (const toolName of disabledTools || []) {
        finalDisabledTools.add(toolName)
      }

      // Now layer conversation-specific config on top
      for (const serverName of conversationMcpConfig.disabledServers || []) {
        finalDisabledServers.add(serverName)
      }

      for (const serverName of conversationMcpConfig.enabledServers || []) {
        finalDisabledServers.delete(serverName) // Re-enable server at conversation level
      }

      for (const toolName of conversationMcpConfig.disabledTools || []) {
        finalDisabledTools.add(toolName)
      }
    } else {
      // Don't inherit from profile - use only conversation config
      const { enabledServers, disabledServers, disabledTools } = conversationMcpConfig

      if (enabledServers && enabledServers.length > 0) {
        // Explicit whitelist of enabled servers
        const enabledSet = new Set(enabledServers)
        for (const serverName of allServerNames) {
          if (!enabledSet.has(serverName)) {
            finalDisabledServers.add(serverName)
          }
        }
      } else {
        // Use conversation's disabled servers list
        for (const serverName of disabledServers || []) {
          finalDisabledServers.add(serverName)
        }
      }

      for (const toolName of disabledTools || []) {
        finalDisabledTools.add(toolName)
      }
    }

    // Filter external tools by server availability
    const enabledExternalTools = this.availableTools.filter((tool) => {
      const serverName = tool.name.includes(":")
        ? tool.name.split(":")[0]
        : "unknown"
      return !finalDisabledServers.has(serverName)
    })

    // Combine with built-in tools and filter by disabled tools
    const allTools = [...enabledExternalTools, ...builtinTools]
    return allTools.filter((tool) => !finalDisabledTools.has(tool.name))
  }

  getDetailedToolList(): Array<{
    name: string
    description: string
    serverName: string
    enabled: boolean
    serverEnabled: boolean
    inputSchema: any
  }> {
    // Clean up orphaned tools from deleted servers
    this.cleanupOrphanedTools()

    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const configuredServers = mcpConfig?.mcpServers || {}
    const runtimeDisabledServers = new Set(config.mcpRuntimeDisabledServers || [])

    // Helper to check if a server is effectively disabled
    const isServerDisabled = (serverName: string): boolean => {
      const serverConfig = configuredServers[serverName]
      if (!serverConfig) return true
      const configDisabled = serverConfig.disabled === true
      const runtimeDisabled = runtimeDisabledServers.has(serverName)
      return configDisabled || runtimeDisabled
    }

    // Get external MCP tools (filter out tools from servers that no longer exist)
    const externalTools = this.availableTools
      .filter((tool) => {
        const serverName = tool.name.includes(":")
          ? tool.name.split(":")[0]
          : "unknown"
        // Only include tools from servers that still exist in config
        return configuredServers[serverName] !== undefined
      })
      .map((tool) => {
        const serverName = tool.name.includes(":")
          ? tool.name.split(":")[0]
          : "unknown"
        // Tool is enabled only if: tool itself is not disabled AND server is not disabled
        const toolDisabled = this.disabledTools.has(tool.name)
        const serverDisabled = isServerDisabled(serverName)
        return {
          name: tool.name,
          description: tool.description,
          serverName,
          enabled: !toolDisabled && !serverDisabled,
          serverEnabled: !serverDisabled,
          inputSchema: tool.inputSchema,
        }
      })

    // Add built-in tools (built-in server is always enabled)
    const builtinToolsList = builtinTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      serverName: BUILTIN_SERVER_NAME,
      enabled: !this.disabledTools.has(tool.name),
      serverEnabled: true,
      inputSchema: tool.inputSchema,
    }))

    return [...externalTools, ...builtinToolsList]
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

    // Add built-in settings server (always connected, always enabled)
    status[BUILTIN_SERVER_NAME] = {
      connected: true,
      toolCount: builtinTools.length,
      runtimeEnabled: true,
      configDisabled: false,
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
    // Check both external tools and built-in tools
    const toolExistsExternal = this.availableTools.some(
      (tool) => tool.name === toolName,
    )
    const toolExistsBuiltin = builtinTools.some(
      (tool) => tool.name === toolName,
    )
    if (!toolExistsExternal && !toolExistsBuiltin) {
      return false
    }

    if (enabled) {
      this.disabledTools.delete(toolName)
    } else {
      this.disabledTools.add(toolName)
    }

    // Persist disabled tools list to config so it survives app restarts
    try {
      const config = configStore.get()
      const cfg: Config = {
        ...config,
        mcpDisabledTools: Array.from(this.disabledTools),
      }
      configStore.save(cfg)
    } catch (e) {
      // Ignore persistence errors; runtime state will still be respected in-session
    }

    // Auto-save to current profile so switching profiles restores this state
    this.saveCurrentStateToProfile()

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
   * Create streamable HTTP transport with proper OAuth handling
   * Implements MCP OAuth specification: try without auth first, handle 401, then retry with OAuth
   */
  private async createStreamableHttpTransport(serverName: string, serverConfig: MCPServerConfig): Promise<StreamableHTTPClientTransport> {
    if (!serverConfig.url) {
      throw new Error("URL is required for streamableHttp transport")
    }

    // Prepare custom headers from configuration
    const customHeaders = serverConfig.headers || {}

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
              ...customHeaders,
              'Authorization': `Bearer ${accessToken}`,
            },
          },
        })
      } catch (error) {
        // Token invalid and can't be refreshed - fall through to try without auth
      }
    }

    // Create transport without authentication
    // If server requires OAuth, it will return 401 and we'll handle it in the connection logic
    if (Object.keys(customHeaders).length > 0) {
      return new StreamableHTTPClientTransport(new URL(serverConfig.url), {
        requestInit: {
          headers: customHeaders,
        },
      })
    }

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

    logTools(`🔐 Server ${serverName} requires OAuth authentication, initiating flow...`)
    diagnosticsService.logInfo("mcp-service", `Server ${serverName} requires OAuth authentication, initiating flow`)

    // Ensure OAuth configuration exists
    if (!serverConfig.oauth) {
      logTools(`📝 Creating default OAuth configuration for ${serverName}`)
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
        logTools(`✅ OAuth configuration saved for ${serverName}`)
      }
    }

    try {
      // Create OAuth client and complete the full flow
      const oauthClient = await this.getOrCreateOAuthClient(serverName, serverConfig)

      const tokens = await oauthClient.completeAuthorizationFlow()

      // Store the tokens
      await oauthStorage.storeTokens(serverConfig.url, tokens)

      // Create authenticated transport with custom headers
      const customHeaders = serverConfig.headers || {}
      const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
        requestInit: {
          headers: {
            ...customHeaders,
            'Authorization': `Bearer ${tokens.access_token}`,
          },
        },
      })

      logTools(`✅ OAuth authentication completed successfully for ${serverName}`)
      return transport
    } catch (error) {
      const errorMsg = `OAuth authentication failed for server ${serverName}: ${error instanceof Error ? error.message : String(error)}`
      logTools(`❌ ${errorMsg}`)
      diagnosticsService.logError("mcp-service", errorMsg)
      throw new Error(errorMsg)
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

      // Ensure client registration is saved before token exchange
      const clientConfig = oauthClient.getConfig()
      if (clientConfig.clientId) {
        await oauthStorage.save(serverConfig.url, clientConfig)
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

      // Save tokens (which also saves the client config)
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

  /**
   * Find server by OAuth state parameter
   */
  async findServerByOAuthState(state: string): Promise<string | null> {
    try {
      // Check all OAuth clients for matching pending auth state
      for (const [serverName, oauthClient] of this.oauthClients.entries()) {
        const config = oauthClient.getConfig()
        const pendingAuth = (config as any).pendingAuth

        if (pendingAuth && pendingAuth.state === state) {
          return serverName
        }
      }

      return null
    } catch (error) {
      logTools('Error finding server by OAuth state:', error)
      return null
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

      // Clean up references (will close transport if present)
      this.cleanupServer(serverName)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async executeToolCall(
    toolCall: MCPToolCall,
    onProgress?: (message: string) => void,
    skipApprovalCheck: boolean = false,
    profileMcpConfig?: ProfileMcpServerConfig
  ): Promise<MCPToolResult> {
    try {
      if (isDebugTools()) {
        logTools("Requested tool call", toolCall)
      }

      // Safety gate: require user approval before executing any tool call if enabled in config
      // Skip if approval was already handled by the caller (e.g., inline approval in agent mode UI)
      const cfg = configStore.get()
      if (cfg.mcpRequireApprovalBeforeToolCall && !skipApprovalCheck) {
        // This path is only hit when called outside of agent mode (e.g., single-shot tool calling)
        // In agent mode, approval is handled inline in the UI via tipc.ts wrapper
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
      // Check if this is a built-in tool first
      if (isBuiltinTool(toolCall.name)) {
        if (isDebugTools()) {
          logTools("Executing built-in tool", { name: toolCall.name, arguments: toolCall.arguments })
        }
        const result = await executeBuiltinTool(toolCall.name, toolCall.arguments || {})
        if (result) {
          if (isDebugTools()) {
            logTools("Built-in tool result", { name: toolCall.name, result })
          }
          return result
        }
      }

      // Check if this is a server-prefixed tool
      if (toolCall.name.includes(":")) {
        const [serverName, toolName] = toolCall.name.split(":", 2)

        // Guard against executing tools from disabled servers
        // When profileMcpConfig is provided (session-aware mode), check against the session's profile config
        // Otherwise fall back to global runtimeDisabledServers (for backward compatibility)
        const isServerDisabledForSession = (() => {
          if (profileMcpConfig) {
            // Session-aware: check against the profile's server config
            const { allServersDisabledByDefault, enabledServers, disabledServers } = profileMcpConfig
            if (allServersDisabledByDefault) {
              // All servers disabled except those in enabledServers
              return !(enabledServers || []).includes(serverName)
            } else {
              // Only servers in disabledServers are disabled
              return (disabledServers || []).includes(serverName)
            }
          }
          // Global mode: check runtime disabled servers
          return this.runtimeDisabledServers.has(serverName)
        })()

        if (isServerDisabledForSession) {
          return {
            content: [
              {
                type: "text",
                text: `Tool ${toolCall.name} is unavailable: server "${serverName}" is currently disabled.`,
              },
            ],
            isError: true,
          }
        }

        // Guard against executing tools that are disabled in the profile config
        // This ensures "disabled" consistently means non-executable, not just hidden from the tool list
        if (profileMcpConfig?.disabledTools?.includes(toolCall.name)) {
          return {
            content: [
              {
                type: "text",
                text: `Tool ${toolCall.name} is currently disabled for this profile.`,
              },
            ],
            isError: true,
          }
        }

        const result = await this.executeServerTool(
          serverName,
          toolName,
          toolCall.arguments,
          onProgress
        )

        // Track resource information from tool results
        this.trackResourceFromResult(serverName, result)

        return result
      }

      // Try to find a matching tool without prefix (fallback for LLM inconsistencies)
      // Include both external and built-in tools in the search
      // Filter out tools from disabled servers (session-aware when profileMcpConfig provided)
      const enabledExternalTools = this.availableTools.filter((tool) => {
        const sName = tool.name.includes(":") ? tool.name.split(":")[0] : "unknown"
        if (profileMcpConfig) {
          const { allServersDisabledByDefault, enabledServers, disabledServers } = profileMcpConfig
          if (allServersDisabledByDefault) {
            return (enabledServers || []).includes(sName)
          } else {
            return !(disabledServers || []).includes(sName)
          }
        }
        return !this.runtimeDisabledServers.has(sName)
      })
      const allTools = [...enabledExternalTools, ...builtinTools]
      const matchingTool = allTools.find((tool) => {
        if (tool.name.includes(":")) {
          const [, toolName] = tool.name.split(":", 2)
          return toolName === toolCall.name
        }
        return tool.name === toolCall.name
      })

      if (matchingTool && matchingTool.name.includes(":")) {
        // Check if it's a built-in tool
        if (isBuiltinTool(matchingTool.name)) {
          const result = await executeBuiltinTool(matchingTool.name, toolCall.arguments || {})
          if (result) {
            return result
          }
        }

        const [serverName, toolName] = matchingTool.name.split(":", 2)

        // Guard against executing tools that are disabled in the profile config
        // This ensures "disabled" consistently means non-executable, not just hidden from the tool list
        if (profileMcpConfig?.disabledTools?.includes(matchingTool.name)) {
          return {
            content: [
              {
                type: "text",
                text: `Tool ${matchingTool.name} is currently disabled for this profile.`,
              },
            ],
            isError: true,
          }
        }

        const result = await this.executeServerTool(
          serverName,
          toolName,
          toolCall.arguments,
          onProgress
        )

        // Track resource information from tool results
        this.trackResourceFromResult(serverName, result)

        return result
      }

      // No matching tools found
      const availableToolNames = allTools
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

    // Gracefully terminate server processes via transports
    await this.terminateAllServerProcesses()

    // Clear all maps
    this.clients.clear()
    this.transports.clear()
    this.availableTools = []
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
   * Register all existing MCP server processes with the agent process manager
   * This is called when agent mode is activated to ensure all processes are tracked
   *
   * Note: With the SDK managing processes internally, we can't directly register them.
   * The processes will be cleaned up when the transports are closed.
   */
  registerExistingProcessesWithAgentManager(): void {
    // No-op: SDK manages processes internally
    // Processes will be terminated via transport.close() when needed
  }

  /**
   * Emergency stop - immediately kill all MCP server processes
   *
   * WARNING: This should ONLY be used for actual app shutdown scenarios.
   * DO NOT use this for agent mode emergency stop - MCP servers are persistent
   * infrastructure that should remain running across agent sessions.
   *
   * Currently not called anywhere - kept for potential future app shutdown cleanup.
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
   * Add a log entry for a server with circular buffer
   */
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

    // Implement circular buffer - keep only last MAX_LOG_ENTRIES
    if (logs.length > this.MAX_LOG_ENTRIES) {
      logs.shift()
    }
  }

  /**
   * Get logs for a specific server
   */
  getServerLogs(serverName: string): ServerLogEntry[] {
    return this.serverLogs.get(serverName) || []
  }

  /**
   * Clear logs for a specific server
   */
  clearServerLogs(serverName: string): void {
    this.serverLogs.set(serverName, [])
  }

  /**
   * Clear all server logs
   */
  clearAllServerLogs(): void {
    this.serverLogs.clear()
  }
}

export const mcpService = new MCPService()
