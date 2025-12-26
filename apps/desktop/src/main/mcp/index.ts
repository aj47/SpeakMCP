/**
 * MCPService - Main facade for Model Context Protocol service
 * Coordinates all MCP functionality through focused sub-modules
 */

import { MCPTool, MCPToolCall, MCPToolResult } from "./types"
import { MCPServerConfig, ServerLogEntry, ProfileMcpServerConfig } from "../../shared/types"
import { TransportFactory } from "./transport-factory"
import { OAuthManager } from "./oauth-manager"
import { ToolManager } from "./tool-manager"
import { ToolExecutor } from "./tool-executor"
import { ResponseProcessor } from "./response-processor"
import { ServerStateManager } from "./server-state"
import { ResourceTracker } from "./resource-tracker"
import { ServerLogger } from "./server-logger"
import { ServerLifecycleManager } from "./server-lifecycle"
import { configStore } from "../config"
import { isDebugTools, logTools } from "../debug"
import { app, dialog } from "electron"
import { readFileSync, existsSync } from "fs"
import path from "path"
import { ProfilesData, Config } from "../../shared/types"

export class MCPService {
  // Sub-modules
  private transportFactory: TransportFactory
  private oauthManager: OAuthManager
  private toolManager: ToolManager
  private responseProcessor: ResponseProcessor
  private serverStateManager: ServerStateManager
  private resourceTracker: ResourceTracker
  private serverLogger: ServerLogger
  private toolExecutor: ToolExecutor
  private serverLifecycleManager: ServerLifecycleManager

  constructor() {
    // Initialize sub-modules
    this.transportFactory = new TransportFactory()
    this.oauthManager = new OAuthManager()
    this.toolManager = new ToolManager()
    this.responseProcessor = new ResponseProcessor()
    this.serverStateManager = new ServerStateManager()
    this.resourceTracker = new ResourceTracker()
    this.serverLogger = new ServerLogger()

    this.toolExecutor = new ToolExecutor(
      this.responseProcessor,
      this.resourceTracker
    )

    this.serverLifecycleManager = new ServerLifecycleManager(
      this.transportFactory,
      this.oauthManager,
      this.toolManager,
      this.serverStateManager,
      this.serverLogger
    )

    // Handle profile-based server configuration on initialization
    this.initializeProfileConfig()
  }

  /**
   * Initialize profile-based configuration
   */
  private initializeProfileConfig(): void {
    try {
      const config = configStore.get()

      // Check if current profile has allServersDisabledByDefault enabled
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

          // Derive runtimeDisabledServers from enabledServers
          const runtimeDisabledServers = this.serverStateManager.getRuntimeDisabledServers()
          runtimeDisabledServers.clear()

          for (const serverName of allServerNames) {
            if (!enabledServers.has(serverName)) {
              runtimeDisabledServers.add(serverName)
            }
          }

          // Persist to config
          try {
            const updatedConfig: Config = {
              ...config,
              mcpRuntimeDisabledServers: Array.from(runtimeDisabledServers),
            }
            configStore.save(updatedConfig)
          } catch (persistError) {
            // Ignore persistence errors
          }
        }
      }
    } catch (e) {
      // Ignore initialization errors
    }
  }

  // ===== Server Lifecycle Methods =====

  /**
   * Initialize all MCP servers
   */
  async initialize(): Promise<void> {
    return this.serverLifecycleManager.initialize()
  }

  /**
   * Initialize a specific server
   */
  async initializeServer(
    serverName: string,
    serverConfig: MCPServerConfig,
    options?: { allowAutoOAuth?: boolean }
  ): Promise<void> {
    return this.serverLifecycleManager.initializeServer(serverName, serverConfig, options)
  }

  /**
   * Stop a specific server
   */
  async stopServer(serverName: string): Promise<{ success: boolean; error?: string }> {
    return this.serverLifecycleManager.stopServer(serverName)
  }

  /**
   * Restart a specific server
   */
  async restartServer(serverName: string): Promise<{ success: boolean; error?: string }> {
    return this.serverLifecycleManager.restartServer(serverName)
  }

  /**
   * Test server connection
   */
  async testServerConnection(
    serverName: string,
    serverConfig: MCPServerConfig
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    return this.serverLifecycleManager.testServerConnection(serverName, serverConfig)
  }

  /**
   * Get initialization status
   */
  getInitializationStatus(): {
    isInitializing: boolean
    progress: { current: number; total: number; currentServer?: string }
  } {
    return this.serverLifecycleManager.getInitializationStatus()
  }

  /**
   * Get server status
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
    return this.serverLifecycleManager.getServerStatus()
  }

  /**
   * Cleanup all servers
   */
  async cleanup(): Promise<void> {
    await this.serverLifecycleManager.cleanup()
    this.resourceTracker.stopCleanup()
  }

  /**
   * Shutdown all servers (alias for cleanup)
   */
  async shutdown(): Promise<void> {
    await this.cleanup()
  }

  /**
   * Emergency stop all processes
   */
  emergencyStopAllProcesses(): void {
    this.serverLifecycleManager.emergencyStopAllProcesses()
  }

  /**
   * Register existing processes with agent manager
   */
  registerExistingProcessesWithAgentManager(): void {
    // No-op: SDK manages processes internally
  }

  /**
   * Terminate all server processes
   */
  async terminateAllServerProcesses(): Promise<void> {
    await this.serverLifecycleManager.terminateAllServerProcesses()
  }

  // ===== Tool Management Methods =====

  /**
   * Get available tools
   */
  getAvailableTools(): MCPTool[] {
    return this.toolManager.getAvailableTools(
      this.serverStateManager.getRuntimeDisabledServers()
    )
  }

  /**
   * Get available tools for a specific profile
   */
  getAvailableToolsForProfile(profileMcpConfig?: ProfileMcpServerConfig): MCPTool[] {
    return this.toolManager.getAvailableToolsForProfile(profileMcpConfig)
  }

  /**
   * Get detailed tool list
   */
  getDetailedToolList(): Array<{
    name: string
    description: string
    serverName: string
    enabled: boolean
    inputSchema: any
  }> {
    return this.toolManager.getDetailedToolList(
      this.serverStateManager.getRuntimeDisabledServers()
    )
  }

  /**
   * Set tool enabled/disabled state
   */
  setToolEnabled(toolName: string, enabled: boolean): boolean {
    const result = this.toolManager.setToolEnabled(toolName, enabled)
    if (result) {
      this.saveCurrentStateToProfile()
    }
    return result
  }

  /**
   * Get disabled tools
   */
  getDisabledTools(): string[] {
    return this.toolManager.getDisabledTools()
  }

  /**
   * Execute a tool call
   */
  async executeToolCall(
    toolCall: MCPToolCall,
    onProgress?: (message: string) => void,
    skipApprovalCheck: boolean = false,
    sessionId?: string,
    profileMcpConfig?: ProfileMcpServerConfig
  ): Promise<MCPToolResult> {
    return this.toolExecutor.executeToolCall(
      toolCall,
      this.serverLifecycleManager.getAllClients(),
      this.toolManager.getAllTools(),
      this.serverStateManager.getRuntimeDisabledServers(),
      onProgress,
      skipApprovalCheck,
      sessionId,
      profileMcpConfig
    )
  }

  // ===== Server State Management Methods =====

  /**
   * Set server runtime enabled/disabled state
   */
  setServerRuntimeEnabled(serverName: string, enabled: boolean): boolean {
    const result = this.serverStateManager.setServerRuntimeEnabled(serverName, enabled)
    if (result) {
      this.saveCurrentStateToProfile()

      // Start server if it's being enabled and not already running
      if (enabled && !this.serverLifecycleManager.getClient(serverName)) {
        const config = configStore.get()
        const serverConfig = config.mcpConfig?.mcpServers?.[serverName]
        if (serverConfig && !serverConfig.disabled) {
          this.serverLifecycleManager.initializeServer(serverName, serverConfig, { allowAutoOAuth: false })
            .catch((error) => {
              if (isDebugTools()) {
                logTools(`Failed to start server ${serverName} after enabling: ${error}`)
              }
            })
        }
      }
    }
    return result
  }

  /**
   * Check if server is runtime enabled
   */
  isServerRuntimeEnabled(serverName: string): boolean {
    return this.serverStateManager.isServerRuntimeEnabled(serverName)
  }

  /**
   * Check if server is available
   */
  isServerAvailable(serverName: string): boolean {
    return this.serverStateManager.isServerAvailable(serverName)
  }

  /**
   * Apply profile MCP configuration
   */
  applyProfileMcpConfig(
    disabledServers?: string[],
    disabledTools?: string[],
    allServersDisabledByDefault?: boolean,
    enabledServers?: string[]
  ): void {
    this.serverStateManager.applyProfileMcpConfig(
      disabledServers,
      allServersDisabledByDefault,
      enabledServers
    )
    this.toolManager.applyProfileDisabledTools(disabledTools)

    // Start any servers that are now enabled
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})

    for (const serverName of allServerNames) {
      const serverConfig = mcpConfig?.mcpServers?.[serverName]
      if (
        serverConfig &&
        !serverConfig.disabled &&
        this.serverStateManager.isServerRuntimeEnabled(serverName) &&
        !this.serverStateManager.isServerInitialized(serverName)
      ) {
        this.serverLifecycleManager.initializeServer(serverName, serverConfig, { allowAutoOAuth: false })
          .catch((error) => {
            if (isDebugTools()) {
              logTools(`Failed to start server ${serverName} after profile switch: ${error}`)
            }
          })
      }
    }
  }

  /**
   * Get current MCP configuration state
   */
  getCurrentMcpConfigState(): {
    disabledServers: string[]
    disabledTools: string[]
    enabledServers: string[]
  } {
    const serverState = this.serverStateManager.getCurrentMcpConfigState()
    return {
      ...serverState,
      disabledTools: this.toolManager.getDisabledTools(),
    }
  }

  /**
   * Save current state to profile
   */
  private saveCurrentStateToProfile(): void {
    try {
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
          logTools(`Auto-saved MCP state to profile ${currentProfileId}`)
        }
      }).catch(() => {
        // Ignore errors
      })
    } catch (e) {
      // Ignore errors
    }
  }

  // ===== OAuth Methods =====

  /**
   * Initiate OAuth flow
   */
  async initiateOAuthFlow(serverName: string): Promise<{ authorizationUrl: string; state: string }> {
    return this.oauthManager.initiateOAuthFlow(serverName)
  }

  /**
   * Complete OAuth flow
   */
  async completeOAuthFlow(serverName: string, code: string, state: string): Promise<{ success: boolean; error?: string }> {
    const result = await this.oauthManager.completeOAuthFlow(serverName, code, state)
    if (result.success) {
      // Restart the server with new tokens
      return this.serverLifecycleManager.restartServer(serverName)
    }
    return result
  }

  /**
   * Get OAuth status
   */
  async getOAuthStatus(serverName: string): Promise<{
    configured: boolean
    authenticated: boolean
    tokenExpiry?: number
    error?: string
  }> {
    return this.oauthManager.getOAuthStatus(serverName)
  }

  /**
   * Revoke OAuth tokens
   */
  async revokeOAuthTokens(serverName: string): Promise<{ success: boolean; error?: string }> {
    const result = await this.oauthManager.revokeOAuthTokens(serverName)
    if (result.success) {
      // Stop the server since it can no longer authenticate
      await this.serverLifecycleManager.stopServer(serverName)
    }
    return result
  }

  /**
   * Find server by OAuth state
   */
  async findServerByOAuthState(state: string): Promise<string | null> {
    return this.oauthManager.findServerByOAuthState(state)
  }

  // ===== Resource Tracking Methods =====

  /**
   * Track a resource
   */
  trackResource(serverId: string, resourceId: string, resourceType: string = "session"): void {
    this.resourceTracker.trackResource(serverId, resourceId, resourceType)
  }

  /**
   * Update resource activity
   */
  updateResourceActivity(serverId: string, resourceId: string, resourceType: string = "session"): void {
    this.resourceTracker.updateResourceActivity(serverId, resourceId, resourceType)
  }

  /**
   * Get tracked resources
   */
  getTrackedResources(): Array<{
    serverId: string
    resourceId: string
    resourceType: string
    lastUsed: number
  }> {
    return this.resourceTracker.getTrackedResources()
  }

  // ===== Server Logging Methods =====

  /**
   * Get logs for a server
   */
  getServerLogs(serverName: string): ServerLogEntry[] {
    return this.serverLogger.getServerLogs(serverName)
  }

  /**
   * Clear logs for a server
   */
  clearServerLogs(serverName: string): void {
    this.serverLogger.clearServerLogs(serverName)
  }

  /**
   * Clear all server logs
   */
  clearAllServerLogs(): void {
    this.serverLogger.clearAllServerLogs()
  }
}

// Export singleton instance
export const mcpService = new MCPService()

// Re-export types
export type { MCPTool, MCPToolCall, MCPToolResult } from "./types"
export { LLMToolCallResponse } from "./types"
