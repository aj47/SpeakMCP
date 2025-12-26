import { configStore } from "../config"
import { Config, MCPServerConfig, ProfileMcpServerConfig } from "../../shared/types"
import { isDebugTools, logTools } from "../debug"

/**
 * ServerStateManager manages the runtime state of MCP servers
 * Handles server enable/disable state and profile configuration
 */
export class ServerStateManager {
  private runtimeDisabledServers: Set<string> = new Set()
  private initializedServers: Set<string> = new Set()

  constructor() {
    // Load persisted runtime disabled servers from config
    try {
      const config = configStore.get()
      const persistedServers = config?.mcpRuntimeDisabledServers
      if (Array.isArray(persistedServers)) {
        for (const serverName of persistedServers) {
          this.runtimeDisabledServers.add(serverName)
        }
      }
    } catch (e) {
      // Ignore errors during initialization
    }
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

  /**
   * Apply MCP configuration from a profile
   * This updates the runtime enabled/disabled state for servers and tools
   *
   * NOTE: Disabling servers only hides their tools from the current profile.
   * Server processes continue running to avoid disrupting other sessions.
   * Servers are persistent infrastructure that should remain available.
   *
   * @param disabledServers - Array of server names to disable (only used when allServersDisabledByDefault is false)
   * @param allServersDisabledByDefault - If true, ALL servers are disabled except those in enabledServers (strict opt-in mode, disabledServers is ignored). If false, only servers in disabledServers are disabled.
   * @param enabledServers - When allServersDisabledByDefault is true, servers in this list are explicitly enabled (user opt-in)
   */
  applyProfileMcpConfig(
    disabledServers?: string[],
    allServersDisabledByDefault?: boolean,
    enabledServers?: string[]
  ): void {
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

    // Persist the new state to config
    try {
      const cfg: Config = {
        ...config,
        mcpRuntimeDisabledServers: Array.from(this.runtimeDisabledServers),
      }
      configStore.save(cfg)

      if (isDebugTools()) {
        logTools(`Applied profile MCP config: ${this.runtimeDisabledServers.size} servers disabled`)
      }
    } catch (e) {
      // Ignore persistence errors; runtime state will still be respected in-session
    }
  }

  /**
   * Get current MCP configuration state (for saving to profile)
   */
  getCurrentMcpConfigState(): { disabledServers: string[], enabledServers: string[] } {
    // Calculate enabled servers as all servers minus disabled servers
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    const enabledServers = allServerNames.filter(name => !this.runtimeDisabledServers.has(name))

    return {
      disabledServers: Array.from(this.runtimeDisabledServers),
      enabledServers,
    }
  }

  /**
   * Mark a server as initialized
   */
  markServerInitialized(serverName: string): void {
    this.initializedServers.add(serverName)
  }

  /**
   * Check if a server is initialized
   */
  isServerInitialized(serverName: string): boolean {
    return this.initializedServers.has(serverName)
  }

  /**
   * Remove a server from the initialized set
   */
  removeInitializedServer(serverName: string): void {
    this.initializedServers.delete(serverName)
  }

  /**
   * Get all initialized servers
   */
  getInitializedServers(): Set<string> {
    return this.initializedServers
  }

  /**
   * Get all runtime disabled servers
   */
  getRuntimeDisabledServers(): Set<string> {
    return this.runtimeDisabledServers
  }

  /**
   * Clear all runtime disabled servers
   */
  clearRuntimeDisabledServers(): void {
    this.runtimeDisabledServers.clear()
  }
}
