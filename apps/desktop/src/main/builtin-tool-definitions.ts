/**
 * Builtin Tool Definitions - Dependency-Free Module
 *
 * This module contains the static definitions for built-in MCP tools.
 * It is intentionally kept free of dependencies on other app modules
 * to avoid circular import issues.
 *
 * The tool execution handlers are in builtin-tools.ts, which can safely
 * import from services that might also need access to these definitions.
 */

import { acpRouterToolDefinitions } from './acp/acp-router-tool-definitions'

// Define a local type to avoid importing from mcp-service
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
export const BUILTIN_SERVER_NAME = "speakmcp-settings"

// Tool definitions
export const builtinToolDefinitions: BuiltinToolDefinition[] = [
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
  {
    name: `${BUILTIN_SERVER_NAME}:list_running_agents`,
    description: "List all currently running agent sessions with their status, iteration count, and activity. Useful for monitoring active agents before terminating them.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:kill_agent`,
    description: "Terminate a specific agent session by its session ID. This will abort any in-flight LLM requests, kill spawned processes, and stop the agent immediately.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The session ID of the agent to terminate (get this from list_running_agents)",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:kill_all_agents`,
    description: "Emergency stop ALL running agent sessions. This will abort all in-flight LLM requests, kill all spawned processes, and stop all agents immediately. Use with caution.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:get_settings`,
    description: "Get the current status of SpeakMCP feature toggles including post-processing, TTS (text-to-speech), and tool approval settings.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:toggle_post_processing`,
    description: "Enable or disable transcript post-processing. When enabled, transcripts are cleaned up and improved using AI.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) post-processing. If not provided, toggles to the opposite of the current state.",
        },
      },
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:toggle_tts`,
    description: "Enable or disable text-to-speech (TTS). When enabled, assistant responses are read aloud.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) TTS. If not provided, toggles to the opposite of the current state.",
        },
      },
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:toggle_tool_approval`,
    description: "Enable or disable tool approval. When enabled, a confirmation dialog appears before any tool executes. Recommended for safety.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) tool approval. If not provided, toggles to the opposite of the current state.",
        },
      },
      required: [],
    },
  },
  // ACP router tools for agent delegation
  // NOTE: These tools use a different prefix (speakmcp-builtin:) than the settings tools
  // above (speakmcp-settings:). This is intentional - agent delegation tools are logically
  // distinct from settings management. Both are treated as built-in tools for execution
  // purposes (see isBuiltinTool in builtin-tools.ts). For UI grouping, all tools in this
  // array are shown under the "speakmcp-settings" virtual server.
  ...acpRouterToolDefinitions,
]

/**
 * Get all builtin tool names (for disabling by default)
 */
export function getBuiltinToolNames(): string[] {
  return builtinToolDefinitions.map((tool) => tool.name)
}

