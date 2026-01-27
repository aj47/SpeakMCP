/**
 * Built-in MCP Tools for SpeakMCP Settings Management
 * Ported from apps/desktop for standalone server
 */

import { configStore } from '../config'
import { profileService } from './profile-service'
import { agentSessionStateManager, toolApprovalManager } from './state'
import { emergencyStopAll } from './emergency-stop'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { MCPToolResult } from '../types'

const execAsync = promisify(exec)

// Interface for builtin tool definitions
export interface BuiltinToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: string
    properties: Record<string, unknown>
    required: string[]
  }
}

// The virtual server name for built-in tools
export const BUILTIN_SERVER_NAME = 'speakmcp-settings'

// Tool definitions (subset of essential tools for server mode)
export const builtinToolDefinitions: BuiltinToolDefinition[] = [
  {
    name: 'list_mcp_servers',
    description: 'List all configured MCP servers and their status',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'toggle_mcp_server',
    description: 'Enable or disable an MCP server by name',
    inputSchema: {
      type: 'object',
      properties: {
        serverName: { type: 'string', description: 'Server name to toggle' },
        enabled: { type: 'boolean', description: 'Enable or disable' },
      },
      required: ['serverName'],
    },
  },
  {
    name: 'list_profiles',
    description: 'List all available profiles',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'switch_profile',
    description: 'Switch to a different profile',
    inputSchema: {
      type: 'object',
      properties: {
        profileIdOrName: { type: 'string', description: 'Profile ID or name' },
      },
      required: ['profileIdOrName'],
    },
  },
  {
    name: 'get_current_profile',
    description: 'Get the currently active profile',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_settings',
    description: 'Get current feature toggle settings',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'kill_all_agents',
    description: 'Emergency stop all running agents',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
]

// Export for use by mcp-service
export const builtinTools = builtinToolDefinitions

/**
 * Get all builtin tool names
 */
export function getBuiltinToolNames(): string[] {
  return builtinToolDefinitions.map((tool) => `${BUILTIN_SERVER_NAME}:${tool.name}`)
}

/**
 * Check if a tool name is a builtin tool
 */
export function isBuiltinTool(toolName: string): boolean {
  return toolName.startsWith(`${BUILTIN_SERVER_NAME}:`)
}

// Tool execution handlers
type ToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>

const toolHandlers: Record<string, ToolHandler> = {
  list_mcp_servers: async (): Promise<MCPToolResult> => {
    const config = configStore.get() as Record<string, unknown>
    const mcpConfig = (config.mcpConfig || { mcpServers: {} }) as { mcpServers: Record<string, unknown> }
    const runtimeDisabled = new Set((config.mcpRuntimeDisabledServers || []) as string[])

    const servers = Object.entries(mcpConfig.mcpServers || {}).map(([name, serverConfig]) => {
      const cfg = serverConfig as Record<string, unknown>
      const isConfigDisabled = cfg.disabled === true
      const isRuntimeDisabled = runtimeDisabled.has(name)

      return {
        name,
        status: isConfigDisabled || isRuntimeDisabled ? 'disabled' : 'enabled',
        transport: cfg.transport || 'stdio',
        configDisabled: isConfigDisabled,
        runtimeDisabled: isRuntimeDisabled,
      }
    })

    return {
      content: [{ type: 'text', text: JSON.stringify({ servers, count: servers.length }, null, 2) }],
      isError: false,
    }
  },

  toggle_mcp_server: async (args): Promise<MCPToolResult> => {
    if (typeof args.serverName !== 'string' || args.serverName.trim() === '') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'serverName required' }) }],
        isError: true,
      }
    }

    const serverName = args.serverName
    const config = configStore.get() as Record<string, unknown>
    const mcpConfig = (config.mcpConfig || { mcpServers: {} }) as { mcpServers: Record<string, unknown> }

    if (!mcpConfig.mcpServers[serverName]) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Server '${serverName}' not found` }) }],
        isError: true,
      }
    }

    const runtimeDisabled = new Set((config.mcpRuntimeDisabledServers || []) as string[])
    const isCurrentlyDisabled = runtimeDisabled.has(serverName)
    const enabled = typeof args.enabled === 'boolean' ? args.enabled : isCurrentlyDisabled

    if (enabled) {
      runtimeDisabled.delete(serverName)
    } else {
      runtimeDisabled.add(serverName)
    }

    configStore.save({ ...config, mcpRuntimeDisabledServers: Array.from(runtimeDisabled) })

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, serverName, enabled }) }],
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
    }))

    return {
      content: [{ type: 'text', text: JSON.stringify({ profiles: profileList, count: profileList.length }, null, 2) }],
      isError: false,
    }
  },

  switch_profile: async (args): Promise<MCPToolResult> => {
    const profileIdOrName = args.profileIdOrName
    if (typeof profileIdOrName !== 'string' || profileIdOrName.trim() === '') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'profileIdOrName required' }) }],
        isError: true,
      }
    }

    const profiles = profileService.getProfiles()
    const profile = profiles.find(
      (p) => p.id === profileIdOrName || p.name.toLowerCase() === profileIdOrName.toLowerCase()
    )

    if (!profile) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Profile '${profileIdOrName}' not found` }) }],
        isError: true,
      }
    }

    profileService.setCurrentProfile(profile.id)

    const config = configStore.get() as Record<string, unknown>
    configStore.save({
      ...config,
      mcpToolsSystemPrompt: profile.guidelines,
      mcpCurrentProfileId: profile.id,
      mcpCustomSystemPrompt: profile.systemPrompt || '',
    })

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, profile: { id: profile.id, name: profile.name } }) }],
      isError: false,
    }
  },

  get_current_profile: async (): Promise<MCPToolResult> => {
    const currentProfile = profileService.getCurrentProfile()
    if (!currentProfile) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No current profile' }) }],
        isError: true,
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ profile: currentProfile }, null, 2) }],
      isError: false,
    }
  },

  get_settings: async (): Promise<MCPToolResult> => {
    const config = configStore.get() as Record<string, unknown>

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ttsEnabled: config.ttsEnabled ?? true,
          toolApprovalEnabled: config.mcpRequireApprovalBeforeToolCall ?? false,
          verificationEnabled: config.mcpVerifyCompletionEnabled ?? true,
          parallelToolExecutionEnabled: config.mcpParallelToolExecution ?? true,
        }, null, 2),
      }],
      isError: false,
    }
  },

  execute_command: async (args): Promise<MCPToolResult> => {
    if (!args.command || typeof args.command !== 'string') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'command required' }) }],
        isError: true,
      }
    }

    const command = args.command
    const rawTimeout = args.timeout
    const timeout = (typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout >= 0)
      ? rawTimeout
      : 30000

    try {
      const execOptions: { timeout?: number; maxBuffer?: number; shell?: string } = {
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      }

      if (timeout > 0) {
        execOptions.timeout = timeout
      }

      const { stdout, stderr } = await execAsync(command, execOptions)

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, command, stdout: stdout || '', stderr: stderr || '' }, null, 2) }],
        isError: false,
      }
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string; code?: number }
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, command, error: err.message, exitCode: err.code, stdout: err.stdout || '', stderr: err.stderr || '' }, null, 2) }],
        isError: true,
      }
    }
  },

  kill_all_agents: async (): Promise<MCPToolResult> => {
    toolApprovalManager.cancelAllApprovals()
    const { before, after } = await emergencyStopAll()

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Emergency stop completed',
          processesKilled: before - after,
        }, null, 2),
      }],
      isError: false,
    }
  },
}

/**
 * Execute a builtin tool by name
 */
export async function executeBuiltinTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<MCPToolResult> {
  // Remove the server prefix if present
  const baseName = toolName.startsWith(`${BUILTIN_SERVER_NAME}:`)
    ? toolName.substring(BUILTIN_SERVER_NAME.length + 1)
    : toolName

  const handler = toolHandlers[baseName]
  if (!handler) {
    return {
      content: [{ type: 'text', text: `Built-in tool '${toolName}' not implemented` }],
      isError: true,
    }
  }

  try {
    return await handler(args)
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    }
  }
}

