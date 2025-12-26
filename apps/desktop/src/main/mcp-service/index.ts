/**
 * MCPService - Main facade that composes all MCP service modules
 *
 * This file re-exports a unified MCPService class that combines:
 * - ServerLifecycleManager: Server init, shutdown, restart
 * - TransportFactory: Transport creation (stdio, WebSocket, HTTP)
 * - OAuthManager: OAuth flows, tokens
 * - ToolManager: Tool filtering, enable/disable
 * - ToolExecutor: Tool execution, parameter fixing
 * - ResponseProcessor: Response filtering, summarization
 * - ServerStateManager: Runtime state, profile config
 * - ResourceTracker: Resource lifecycle tracking
 * - ServerLogger: Server logging
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { configStore } from "../config"
import { MCPConfig, MCPServerConfig, Config, ProfileMcpServerConfig } from "../../shared/types"
import { normalizeMcpConfig } from "../../shared/mcp-utils"
import { isDebugTools, logTools } from "../debug"

// Import all modules
import { ServerLifecycleManager } from "./ServerLifecycleManager"
import { TransportFactory } from "./TransportFactory"
import { OAuthManager } from "./OAuthManager"
import { ToolManager } from "./ToolManager"
import { ToolExecutor } from "./ToolExecutor"
import { ResponseProcessor } from "./ResponseProcessor"
import { ServerStateManager } from "./ServerStateManager"
import { ResourceTracker } from "./ResourceTracker"
import { ServerLogger } from "./ServerLogger"

// Re-export types
export * from "./types"

/**
 * MCPService - Unified facade for all MCP operations
 */
export class MCPService {
  // Module instances
  private lifecycleManager: ServerLifecycleManager
  private transportFactory: TransportFactory
  private oauthManager: OAuthManager
  private toolManager: ToolManager
  private toolExecutor: ToolExecutor
  private responseProcessor: ResponseProcessor
  private stateManager: ServerStateManager
  private resourceTracker: ResourceTracker
  private logger: ServerLogger

  // Initialization state
  private isInitializing = false
  private initializationPromise: Promise<void> | null = null
  private initializationProgress: {
    current: number
    total: number
    currentServer?: string
  } = { current: 0, total: 0 }

  constructor() {
    // Initialize all modules
    this.lifecycleManager = new ServerLifecycleManager()
    this.transportFactory = new TransportFactory()
    this.oauthManager = new OAuthManager()
    this.toolManager = new ToolManager()
    this.toolExecutor = new ToolExecutor()
    this.responseProcessor = new ResponseProcessor()
    this.stateManager = new ServerStateManager()
    this.resourceTracker = new ResourceTracker()
    this.logger = new ServerLogger()
  }

  // ========== Initialization ==========

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
          this.isInitializing = false
          this.stateManager.setHasBeenInitialized(true)
          return
        }

        const serversToInitialize = this.stateManager.getServersToInitialize(mcpConfig.mcpServers)

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
            this.stateManager.markServerInitialized(serverName)
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
        this.stateManager.setHasBeenInitialized(true)

        if (isDebugTools()) {
          const toolCount = this.toolManager.getAvailableTools(this.stateManager.getRuntimeDisabledServers()).length
          logTools(`MCP Service initialization complete. Total tools available: ${toolCount}`)
        }
      } finally {
        // Always clear the initialization promise so subsequent calls can re-run if needed
        this.initializationPromise = null
      }
    })()

    return this.initializationPromise
  }

  private async initializeServer(
    serverName: string,
    serverConfig: MCPServerConfig,
    options: { allowAutoOAuth?: boolean } = {},
  ): Promise<void> {
    await this.lifecycleManager.initializeServer(
      serverName,
      serverConfig,
      // createTransport callback
      async (sName, sConfig) => {
        return await this.transportFactory.createTransport(
          sName,
          sConfig,
          async (serverName) => {
            return await this.oauthManager.getValidToken(serverName, sConfig)
          }
        )
      },
      // addServerTools callback
      (sName, tools) => {
        this.toolManager.addServerTools(sName, tools)
      },
      // addLogEntry callback
      (sName, message) => {
        this.logger.addLogEntry(sName, message)
      },
      // handle401AndRetryWithOAuth callback
      async (sName, sConfig) => {
        return await this.oauthManager.handle401AndRetryWithOAuth(sName, sConfig, configStore)
      },
      options
    )
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

  // ========== Server Lifecycle ==========

  async restartServer(
    serverName: string,
  ): Promise<{ success: boolean; error?: string }> {
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

      return await this.lifecycleManager.restartServer(
        serverName,
        serverConfig,
        // createTransport callback
        async (sName, sConfig) => {
          return await this.transportFactory.createTransport(
            sName,
            sConfig,
            async (serverName) => {
              return await this.oauthManager.getValidToken(serverName, sConfig)
            }
          )
        },
        // addServerTools callback
        (sName, tools) => {
          this.toolManager.addServerTools(sName, tools)
        },
        // addLogEntry callback
        (sName, message) => {
          this.logger.addLogEntry(sName, message)
        },
        // removeServerTools callback
        (sName) => {
          this.toolManager.removeServerTools(sName)
          this.stateManager.markServerUninitialized(sName)
        },
        // deleteServerLogs callback
        (sName) => {
          this.logger.deleteServerLogs(sName)
        },
        // handle401AndRetryWithOAuth callback
        async (sName, sConfig) => {
          return await this.oauthManager.handle401AndRetryWithOAuth(sName, sConfig, configStore)
        }
      )
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
    return await this.lifecycleManager.stopServer(
      serverName,
      (sName) => {
        this.toolManager.removeServerTools(sName)
        this.stateManager.markServerUninitialized(sName)
      },
      (sName) => {
        this.logger.deleteServerLogs(sName)
      }
    )
  }

  async testServerConnection(
    serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    return await this.lifecycleManager.testServerConnection(
      serverName,
      serverConfig,
      async (sName, sConfig) => {
        return await this.transportFactory.createTransport(
          sName,
          sConfig,
          async (serverName) => {
            return await this.oauthManager.getValidToken(serverName, sConfig)
          }
        )
      }
    )
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
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const mcpServers = mcpConfig?.mcpServers || {}

    return this.lifecycleManager.getServerStatus(
      mcpServers,
      this.stateManager.getRuntimeDisabledServers(),
      (serverName) => {
        return this.toolManager.getAvailableTools(this.stateManager.getRuntimeDisabledServers())
          .filter((tool) => tool.name.startsWith(`${serverName}:`))
          .length
      }
    )
  }

  // ========== Server State Management ==========

  setServerRuntimeEnabled(serverName: string, enabled: boolean): boolean {
    const result = this.stateManager.setServerRuntimeEnabled(serverName, enabled)
    if (result) {
      // Auto-save to current profile
      this.saveCurrentStateToProfile()
    }
    return result
  }

  isServerRuntimeEnabled(serverName: string): boolean {
    return this.stateManager.isServerRuntimeEnabled(serverName)
  }

  isServerAvailable(serverName: string): boolean {
    return this.stateManager.isServerAvailable(serverName)
  }

  applyProfileMcpConfig(
    disabledServers?: string[],
    disabledTools?: string[],
    allServersDisabledByDefault?: boolean,
    enabledServers?: string[]
  ): void {
    this.stateManager.applyProfileMcpConfig(
      disabledServers,
      disabledTools,
      allServersDisabledByDefault,
      enabledServers,
      (tools) => {
        this.toolManager.applyDisabledTools(tools)
      }
    )

    // Start any servers that are now enabled and were not previously running
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})

    for (const serverName of allServerNames) {
      const serverConfig = mcpConfig?.mcpServers?.[serverName]
      if (
        serverConfig &&
        !serverConfig.disabled &&
        !this.stateManager.getRuntimeDisabledServers().has(serverName) &&
        !this.stateManager.isServerInitialized(serverName)
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

  getCurrentMcpConfigState(): { disabledServers: string[], disabledTools: string[], enabledServers: string[] } {
    const state = this.stateManager.getCurrentMcpConfigState()
    return {
      ...state,
      disabledTools: this.toolManager.getDisabledTools(),
    }
  }

  private saveCurrentStateToProfile(): void {
    try {
      // Dynamic import to avoid circular dependency
      import("../profile-service").then(({ profileService }) => {
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

  // ========== Tool Management ==========

  getAvailableTools() {
    return this.toolManager.getAvailableTools(this.stateManager.getRuntimeDisabledServers())
  }

  getAvailableToolsForProfile(profileMcpConfig?: ProfileMcpServerConfig) {
    return this.toolManager.getAvailableToolsForProfile(profileMcpConfig)
  }

  getDetailedToolList() {
    return this.toolManager.getDetailedToolList(this.stateManager.getRuntimeDisabledServers())
  }

  setToolEnabled(toolName: string, enabled: boolean): boolean {
    const result = this.toolManager.setToolEnabled(toolName, enabled)
    if (result) {
      // Auto-save to current profile
      this.saveCurrentStateToProfile()
    }
    return result
  }

  getDisabledTools(): string[] {
    return this.toolManager.getDisabledTools()
  }

  // ========== Tool Execution ==========

  async executeToolCall(
    toolCall: any,
    onProgress?: (message: string) => void,
    skipApprovalCheck: boolean = false,
    profileMcpConfig?: ProfileMcpServerConfig
  ) {
    return await this.toolExecutor.executeToolCall(
      toolCall,
      this.lifecycleManager.getClients(),
      this.toolManager.getAvailableTools(this.stateManager.getRuntimeDisabledServers()),
      this.stateManager.getRuntimeDisabledServers(),
      (serverId, resourceId, resourceType) => {
        this.resourceTracker.updateResourceActivity(serverId, resourceId, resourceType)
      },
      (serverName, result) => {
        this.resourceTracker.trackResourceFromResult(serverName, result)
      },
      async (serverName, toolName, result, onProgress) => {
        // Apply response filtering
        const filteredContent = this.responseProcessor.filterToolResponse(serverName, toolName, result.content)

        // Process large responses
        const processedContent = await this.responseProcessor.processLargeToolResponse(
          serverName,
          toolName,
          filteredContent,
          onProgress
        )

        return {
          content: processedContent.map(item => ({
            type: "text" as const,
            text: item.text
          })),
          isError: result.isError
        }
      },
      onProgress,
      skipApprovalCheck,
      profileMcpConfig
    )
  }

  // ========== Resource Tracking ==========

  trackResource(
    serverId: string,
    resourceId: string,
    resourceType: string = "session",
  ): void {
    this.resourceTracker.trackResource(serverId, resourceId, resourceType)
  }

  updateResourceActivity(
    serverId: string,
    resourceId: string,
    resourceType: string = "session",
  ): void {
    this.resourceTracker.updateResourceActivity(serverId, resourceId, resourceType)
  }

  getTrackedResources() {
    return this.resourceTracker.getTrackedResources()
  }

  // ========== Server Logging ==========

  getServerLogs(serverName: string) {
    return this.logger.getServerLogs(serverName)
  }

  clearServerLogs(serverName: string): void {
    this.logger.clearServerLogs(serverName)
  }

  clearAllServerLogs(): void {
    this.logger.clearAllServerLogs()
  }

  // ========== OAuth Management ==========

  async initiateOAuthFlow(serverName: string): Promise<{ authorizationUrl: string; state: string }> {
    const config = configStore.get()
    const serverConfig = config.mcpConfig?.mcpServers?.[serverName]

    if (!serverConfig) {
      throw new Error(`Server ${serverName} not found in configuration`)
    }

    return await this.oauthManager.initiateOAuthFlow(serverName, serverConfig)
  }

  async completeOAuthFlow(serverName: string, code: string, state: string): Promise<{ success: boolean; error?: string }> {
    const config = configStore.get()
    const serverConfig = config.mcpConfig?.mcpServers?.[serverName]

    if (!serverConfig) {
      return {
        success: false,
        error: `Server ${serverName} not found in configuration`,
      }
    }

    return await this.oauthManager.completeOAuthFlow(
      serverName,
      serverConfig,
      code,
      state,
      async (sName) => this.restartServer(sName)
    )
  }

  async getOAuthStatus(serverName: string): Promise<{
    configured: boolean
    authenticated: boolean
    tokenExpiry?: number
    error?: string
  }> {
    const config = configStore.get()
    const serverConfig = config.mcpConfig?.mcpServers?.[serverName]

    if (!serverConfig) {
      return {
        configured: false,
        authenticated: false,
        error: `Server ${serverName} not found`,
      }
    }

    return await this.oauthManager.getOAuthStatus(serverConfig)
  }

  async revokeOAuthTokens(serverName: string): Promise<{ success: boolean; error?: string }> {
    const config = configStore.get()
    const serverConfig = config.mcpConfig?.mcpServers?.[serverName]

    if (!serverConfig) {
      return {
        success: false,
        error: `Server ${serverName} not found`,
      }
    }

    return await this.oauthManager.revokeOAuthTokens(
      serverName,
      serverConfig,
      async (sName) => this.stopServer(sName)
    )
  }

  async findServerByOAuthState(state: string): Promise<string | null> {
    return await this.oauthManager.findServerByOAuthState(state)
  }

  // ========== Cleanup ==========

  async shutdown(): Promise<void> {
    await this.cleanup()
  }

  async cleanup(): Promise<void> {
    await this.lifecycleManager.cleanup()
    this.toolManager.clearAllTools()
    this.resourceTracker.cleanup()
    this.oauthManager.cleanup()
  }

  async terminateAllServerProcesses(): Promise<void> {
    await this.lifecycleManager.cleanup()
  }

  registerExistingProcessesWithAgentManager(): void {
    // No-op: SDK manages processes internally
  }

  emergencyStopAllProcesses(): void {
    this.lifecycleManager.emergencyStopAllProcesses()
  }
}

// Export singleton instance
export const mcpService = new MCPService()
