/**
 * Built-in MCP Tools for SpeakMCP Settings Management
 * 
 * These tools are registered as a virtual "speakmcp-settings" server and provide
 * functionality for managing SpeakMCP settings directly from the LLM:
 * - List MCP servers and their status
 * - Enable/disable MCP servers
 * - List and switch profiles
 * 
 * Unlike external MCP servers, these tools run directly in the main process
 * and have direct access to the app's services.
 */

import { configStore } from "./config"
import { profileService } from "./profile-service"
import { mcpService, type MCPTool, type MCPToolResult } from "./mcp-service"

// The virtual server name for built-in tools
export const BUILTIN_SERVER_NAME = "speakmcp-settings"

// Tool definitions
export const builtinTools: MCPTool[] = [
  {
    name: `${BUILTIN_SERVER_NAME}:list_mcp_servers`,
    description: "List all configured MCP servers and their status (enabled/disabled, connected/disconnected)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:toggle_mcp_server`,
    description: "Enable or disable an MCP server by name. Disabled servers will not be initialized on next startup.",
    inputSchema: {
      type: "object",
      properties: {
        serverName: {
          type: "string",
          description: "The name of the MCP server to toggle",
        },
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) the server. If not provided, toggles to the opposite of the current state.",
        },
      },
      required: ["serverName"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:list_profiles`,
    description: "List all available profiles and show which one is currently active",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:switch_profile`,
    description: "Switch to a different profile by ID or name. The profile's guidelines will become active.",
    inputSchema: {
      type: "object",
      properties: {
        profileIdOrName: {
          type: "string",
          description: "The ID or name of the profile to switch to",
        },
      },
      required: ["profileIdOrName"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:get_current_profile`,
    description: "Get the currently active profile with its full guidelines",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
]

// Tool execution handlers
type ToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>

const toolHandlers: Record<string, ToolHandler> = {
  list_mcp_servers: async (): Promise<MCPToolResult> => {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig || { mcpServers: {} }
    const runtimeDisabled = new Set(config.mcpRuntimeDisabledServers || [])
    const serverStatus = mcpService.getServerStatus()

    const servers = Object.entries(mcpConfig.mcpServers).map(([name, serverConfig]) => {
      const isConfigDisabled = serverConfig.disabled === true
      const isRuntimeDisabled = runtimeDisabled.has(name)
      const status = isConfigDisabled || isRuntimeDisabled ? "disabled" : "enabled"
      const transport = serverConfig.transport || "stdio"
      const connectionInfo = serverStatus[name]

      return {
        name,
        status,
        connected: connectionInfo?.connected ?? false,
        toolCount: connectionInfo?.toolCount ?? 0,
        transport,
        configDisabled: isConfigDisabled,
        runtimeDisabled: isRuntimeDisabled,
        command: serverConfig.command,
        url: serverConfig.url,
      }
    })

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ servers, count: servers.length }, null, 2),
        },
      ],
      isError: false,
    }
  },

  toggle_mcp_server: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate serverName parameter
    if (typeof args.serverName !== "string" || args.serverName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "serverName must be a non-empty string" }) }],
        isError: true,
      }
    }

    // Validate enabled parameter if provided (optional)
    if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "enabled must be a boolean if provided" }) }],
        isError: true,
      }
    }

    const serverName = args.serverName

    const config = configStore.get()
    const mcpConfig = config.mcpConfig || { mcpServers: {} }

    // Check if server exists
    if (!mcpConfig.mcpServers[serverName]) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Server '${serverName}' not found. Available servers: ${Object.keys(mcpConfig.mcpServers).join(", ") || "none"}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Update runtime disabled servers list
    const runtimeDisabled = new Set(config.mcpRuntimeDisabledServers || [])

    // Check if the server is disabled at the config level (in mcp.json)
    const configDisabled = mcpConfig.mcpServers[serverName].disabled === true

    // Determine the new enabled state: use provided value or toggle current state
    const isCurrentlyRuntimeDisabled = runtimeDisabled.has(serverName)
    const isCurrentlyDisabled = isCurrentlyRuntimeDisabled || configDisabled
    const enabled = typeof args.enabled === "boolean" ? args.enabled : isCurrentlyDisabled // toggle to opposite

    if (enabled) {
      runtimeDisabled.delete(serverName)
    } else {
      runtimeDisabled.add(serverName)
    }

    configStore.save({
      ...config,
      mcpRuntimeDisabledServers: Array.from(runtimeDisabled),
    })

    // Calculate the effective enabled state (considering both runtime and config)
    const effectivelyEnabled = enabled && !configDisabled

    // Build a clear message that indicates actual state
    let message = `Server '${serverName}' runtime setting has been ${enabled ? "enabled" : "disabled"}.`
    if (enabled && configDisabled) {
      message += ` Warning: Server is still disabled in config file (disabled: true). Edit mcp.json to fully enable.`
    } else {
      message += ` Restart agent mode or the app for changes to take effect.`
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            serverName,
            enabled,
            configDisabled,
            effectivelyEnabled,
            message,
          }),
        },
      ],
      isError: false,
    }
  },

  list_profiles: async (): Promise<MCPToolResult> => {
    const profiles = profileService.getProfiles()
    const currentProfile = profileService.getCurrentProfile()

    const profileList = profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      isActive: profile.id === currentProfile?.id,
      isDefault: profile.isDefault || false,
      guidelinesPreview: profile.guidelines.substring(0, 100) + (profile.guidelines.length > 100 ? "..." : ""),
    }))

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            profiles: profileList,
            currentProfileId: currentProfile?.id,
            count: profileList.length,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  switch_profile: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const profileIdOrName = args.profileIdOrName
    if (typeof profileIdOrName !== "string" || profileIdOrName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "profileIdOrName must be a non-empty string" }) }],
        isError: true,
      }
    }
    const profiles = profileService.getProfiles()

    // Find profile by ID or name (case-insensitive for name)
    const profile = profiles.find(
      (p) => p.id === profileIdOrName || p.name.toLowerCase() === profileIdOrName.toLowerCase()
    )

    if (!profile) {
      const availableProfiles = profiles.map((p) => `${p.name} (${p.id})`).join(", ")
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Profile '${profileIdOrName}' not found. Available profiles: ${availableProfiles}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Switch to the profile
    profileService.setCurrentProfile(profile.id)

    // Apply the profile's MCP server configuration
    // If the profile has no mcpServerConfig, we pass empty arrays to reset to default (all enabled)
    const { mcpService } = await import("./mcp-service")
    mcpService.applyProfileMcpConfig(
      profile.mcpServerConfig?.disabledServers ?? [],
      profile.mcpServerConfig?.disabledTools ?? []
    )

    // Update config with profile's guidelines, system prompt, and model configuration
    const config = configStore.get()
    const updatedConfig = {
      ...config,
      // Always apply guidelines and profile ID (same as TIPC setCurrentProfile)
      mcpToolsSystemPrompt: profile.guidelines,
      mcpCurrentProfileId: profile.id,
      // Apply custom system prompt if it exists, otherwise clear it to use default
      mcpCustomSystemPrompt: profile.systemPrompt || "",
      // Apply model config if it exists
      ...(profile.modelConfig?.mcpToolsProviderId && {
        mcpToolsProviderId: profile.modelConfig.mcpToolsProviderId,
      }),
      ...(profile.modelConfig?.mcpToolsOpenaiModel && {
        mcpToolsOpenaiModel: profile.modelConfig.mcpToolsOpenaiModel,
      }),
      ...(profile.modelConfig?.mcpToolsGroqModel && {
        mcpToolsGroqModel: profile.modelConfig.mcpToolsGroqModel,
      }),
      ...(profile.modelConfig?.mcpToolsGeminiModel && {
        mcpToolsGeminiModel: profile.modelConfig.mcpToolsGeminiModel,
      }),
      ...(profile.modelConfig?.currentModelPresetId && {
        currentModelPresetId: profile.modelConfig.currentModelPresetId,
      }),
    }
    configStore.save(updatedConfig)

    const mcpConfigApplied = !!profile.mcpServerConfig
    const modelConfigApplied = !!profile.modelConfig
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            profile: {
              id: profile.id,
              name: profile.name,
              guidelines: profile.guidelines,
              mcpConfigApplied,
              disabledServers: profile.mcpServerConfig?.disabledServers || [],
              disabledTools: profile.mcpServerConfig?.disabledTools || [],
              modelConfigApplied,
              modelConfig: profile.modelConfig || null,
            },
            message: `Switched to profile '${profile.name}'${[mcpConfigApplied && 'MCP', modelConfigApplied && 'model'].filter(Boolean).length > 0 ? ' with ' + [mcpConfigApplied && 'MCP', modelConfigApplied && 'model'].filter(Boolean).join(' and ') + ' configuration' : ''}`,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  get_current_profile: async (): Promise<MCPToolResult> => {
    const currentProfile = profileService.getCurrentProfile()

    if (!currentProfile) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "No current profile found",
            }),
          },
        ],
        isError: true,
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            profile: {
              id: currentProfile.id,
              name: currentProfile.name,
              guidelines: currentProfile.guidelines,
              isDefault: currentProfile.isDefault || false,
              createdAt: currentProfile.createdAt,
              updatedAt: currentProfile.updatedAt,
            },
          }, null, 2),
        },
      ],
      isError: false,
    }
  },
}

/**
 * Execute a built-in tool by name
 * @param toolName The full tool name (e.g., "speakmcp-settings:list_mcp_servers")
 * @param args The tool arguments
 * @returns The tool result
 */
export async function executeBuiltinTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<MCPToolResult | null> {
  // Check if this is a built-in tool
  if (!toolName.startsWith(`${BUILTIN_SERVER_NAME}:`)) {
    return null
  }

  // Extract the actual tool name
  const actualToolName = toolName.substring(BUILTIN_SERVER_NAME.length + 1)

  // Find and execute the handler
  const handler = toolHandlers[actualToolName]
  if (!handler) {
    return {
      content: [
        {
          type: "text",
          text: `Unknown built-in tool: ${actualToolName}`,
        },
      ],
      isError: true,
    }
  }

  try {
    return await handler(args)
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing built-in tool: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

/**
 * Check if a tool name is a built-in tool
 */
export function isBuiltinTool(toolName: string): boolean {
  return toolName.startsWith(`${BUILTIN_SERVER_NAME}:`)
}

