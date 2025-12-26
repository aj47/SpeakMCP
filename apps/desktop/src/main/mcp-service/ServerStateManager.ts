import { MCPServerConfig, Config, ProfileMcpServerConfig } from "../../shared/types"
import { configStore } from "../config"
import { isDebugTools, logTools } from "../debug"
import { app } from "electron"
import path from "path"
import { existsSync, readFileSync } from "fs"
import type { ProfilesData } from "../../shared/types"

/**
 * ServerStateManager - Manages MCP server runtime state and profile config
 *
 * Responsibilities:
 * - Track runtime enabled/disabled servers
 * - Apply profile MCP configurations
 * - Save/restore MCP state to/from profiles
 * - Manage server availability
 */
export class ServerStateManager {
  private runtimeDisabledServers: Set<string> = new Set()
  private initializedServers: Set<string> = new Set()
  private hasBeenInitialized = false

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

      // Check if current profile has allServersDisabledByDefault enabled
      // If so, derive runtimeDisabledServers directly from enabledServers to avoid config/profile drift
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
          this.runtimeDisabledServers.clear()
          for (const serverName of allServerNames) {
            if (!enabledServers.has(serverName)) {
              this.runtimeDisabledServers.add(serverName)
            }
          }

          // Persist the derived runtimeDisabledServers to configStore
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
   * Set runtime enabled/disabled state for a server
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
   */
  applyProfileMcpConfig(
    disabledServers?: string[],
    disabledTools?: string[],
    allServersDisabledByDefault?: boolean,
    enabledServers?: string[],
    applyDisabledTools?: (tools: string[]) => void
  ): void {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})

    // Reset runtime disabled servers based on profile config
    this.runtimeDisabledServers.clear()

    if (allServersDisabledByDefault) {
      // When allServersDisabledByDefault is true, disable ALL servers EXCEPT those explicitly enabled
      const enabledSet = new Set(enabledServers || [])
      for (const serverName of allServerNames) {
        if (!enabledSet.has(serverName)) {
          this.runtimeDisabledServers.add(serverName)
        }
      }
    } else if (disabledServers && disabledServers.length > 0) {
      // Only disable explicitly listed servers
      for (const serverName of disabledServers) {
        if (allServerNames.includes(serverName)) {
          this.runtimeDisabledServers.add(serverName)
        }
      }
    }

    // Apply disabled tools via callback
    if (applyDisabledTools) {
      applyDisabledTools(disabledTools || [])
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
  getCurrentMcpConfigState(): { disabledServers: string[], disabledTools: string[], enabledServers: string[] } {
    // Calculate enabled servers as all servers minus disabled servers
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    const enabledServers = allServerNames.filter(name => !this.runtimeDisabledServers.has(name))

    return {
      disabledServers: Array.from(this.runtimeDisabledServers),
      disabledTools: [], // Will be filled by caller
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
   * Mark a server as uninitialized
   */
  markServerUninitialized(serverName: string): void {
    this.initializedServers.delete(serverName)
  }

  /**
   * Check if a server is initialized
   */
  isServerInitialized(serverName: string): boolean {
    return this.initializedServers.has(serverName)
  }

  /**
   * Set has been initialized flag
   */
  setHasBeenInitialized(value: boolean): void {
    this.hasBeenInitialized = value
  }

  /**
   * Get has been initialized flag
   */
  getHasBeenInitialized(): boolean {
    return this.hasBeenInitialized
  }

  /**
   * Get runtime disabled servers
   */
  getRuntimeDisabledServers(): Set<string> {
    return this.runtimeDisabledServers
  }

  /**
   * Get initialized servers
   */
  getInitializedServers(): Set<string> {
    return this.initializedServers
  }

  /**
   * Filter servers to initialize
   */
  getServersToInitialize(mcpServers: Record<string, MCPServerConfig>): Array<[string, MCPServerConfig]> {
    return Object.entries(mcpServers).filter(
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
  }
}
