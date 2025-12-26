import { MCPTool } from "./types"
import { configStore } from "../config"
import { Config, ProfileMcpServerConfig, MCPServerConfig } from "../../shared/types"
import { builtinTools, BUILTIN_SERVER_NAME } from "../builtin-tools"

/**
 * ToolManager manages the registry of available MCP tools
 * Handles tool enable/disable state and filtering by server/profile
 */
export class ToolManager {
  private availableTools: MCPTool[] = []
  private disabledTools: Set<string> = new Set()

  constructor() {
    // Load persisted disabled tools from config
    try {
      const config = configStore.get()
      const persistedTools = config?.mcpDisabledTools
      if (Array.isArray(persistedTools)) {
        for (const toolName of persistedTools) {
          this.disabledTools.add(toolName)
        }
      }
    } catch (e) {
      // Ignore errors during initialization
    }
  }

  /**
   * Get all available tools (external + builtin), filtered by runtime disabled servers
   */
  getAvailableTools(runtimeDisabledServers: Set<string>): MCPTool[] {
    // Filter out tools from runtime-disabled servers
    const enabledExternalTools = this.availableTools.filter((tool) => {
      const serverName = tool.name.includes(":")
        ? tool.name.split(":")[0]
        : "unknown"
      return !runtimeDisabledServers.has(serverName)
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
   */
  getAvailableToolsForProfile(profileMcpConfig?: ProfileMcpServerConfig): MCPTool[] {
    // If no profile config, return all available tools (minus globally disabled tools)
    if (!profileMcpConfig) {
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
   * Get detailed tool list including server name and enabled status
   */
  getDetailedToolList(runtimeDisabledServers: Set<string>): Array<{
    name: string
    description: string
    serverName: string
    enabled: boolean
    inputSchema: any
  }> {
    // Clean up orphaned tools from deleted servers
    this.cleanupOrphanedTools()

    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const configuredServers = mcpConfig?.mcpServers || {}

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
          inputSchema: tool.inputSchema,
        }
      })

    // Add built-in tools (built-in server is always enabled)
    const builtinToolsList = builtinTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      serverName: BUILTIN_SERVER_NAME,
      enabled: !this.disabledTools.has(tool.name),
      inputSchema: tool.inputSchema,
    }))

    return [...externalTools, ...builtinToolsList]
  }

  /**
   * Set tool enabled/disabled state
   */
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

    // Persist disabled tools list to config
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

    return true
  }

  /**
   * Get list of disabled tools
   */
  getDisabledTools(): string[] {
    return Array.from(this.disabledTools)
  }

  /**
   * Add tools from a server to the registry
   */
  addToolsFromServer(serverName: string, tools: Array<{ name: string; description?: string; inputSchema: any }>): void {
    // Remove any existing tools from this server first
    this.availableTools = this.availableTools.filter(
      (tool) => !tool.name.startsWith(`${serverName}:`),
    )

    // Add new tools with server prefix
    for (const tool of tools) {
      this.availableTools.push({
        name: `${serverName}:${tool.name}`,
        description: tool.description || `Tool from ${serverName} server`,
        inputSchema: tool.inputSchema,
      })
    }
  }

  /**
   * Remove all tools from a server
   */
  removeToolsFromServer(serverName: string): void {
    this.availableTools = this.availableTools.filter(
      (tool) => !tool.name.startsWith(`${serverName}:`),
    )
  }

  /**
   * Clean up tools from servers that no longer exist in configuration
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
    const orphanedDisabledTools = Array.from(this.disabledTools).filter((toolName) => {
      const serverName = toolName.includes(":")
        ? toolName.split(":")[0]
        : "unknown"
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
   * Apply disabled tools from profile configuration
   */
  applyProfileDisabledTools(disabledTools?: string[]): void {
    this.disabledTools.clear()

    if (disabledTools && disabledTools.length > 0) {
      for (const toolName of disabledTools) {
        this.disabledTools.add(toolName)
      }
    }

    // Persist the new state to config
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

  /**
   * Get all available tools (without filtering)
   */
  getAllTools(): MCPTool[] {
    return this.availableTools
  }

  /**
   * Clear all tools
   */
  clearAllTools(): void {
    this.availableTools = []
  }
}
