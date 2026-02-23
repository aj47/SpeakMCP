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

import { BUILTIN_SERVER_NAME } from '../shared/builtin-tool-names'
import { acpRouterToolDefinitions } from './acp/acp-router-tool-definitions'

// Re-export for backward compatibility (single source of truth in @shared/builtin-tool-names)
export { BUILTIN_SERVER_NAME }

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
    name: `${BUILTIN_SERVER_NAME}:list_running_agents`,
    description: "List all currently running agent sessions with their status, iteration count, and activity. Useful for monitoring active agents before terminating them.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:send_agent_message`,
    description: "Send a message to another running agent session. The message will be queued and processed by the target agent's conversation. Use list_running_agents first to get session IDs. This enables agent coordination and task delegation.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The session ID of the target agent (get this from list_running_agents)",
        },
        message: {
          type: "string",
          description: "The message to send to the target agent",
        },
      },
      required: ["sessionId", "message"],
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
    description: "Get the current status of SpeakMCP feature toggles including post-processing, TTS (text-to-speech), tool approval, verification, message queue, and parallel tool execution settings.",
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
  {
    name: `${BUILTIN_SERVER_NAME}:toggle_verification`,
    description: "Enable or disable task completion verification. When enabled (default), the agent verifies whether the user's task has been completed before finishing. Disable for faster responses without verification.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) verification. If not provided, toggles to the opposite of the current state.",
        },
      },
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:respond_to_user`,
    description:
      "Send a response directly to the user. On voice interfaces this will be spoken aloud via TTS; on messaging channels (mobile, WhatsApp, etc.) it will be sent as a message. Regular assistant text is internal and not guaranteed to reach the user; use this tool to explicitly communicate with them.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "The response text for the user. Write naturally and conversationally, without markdown or code formatting.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:speak_to_user`,
    description:
      "[DEPRECATED] Use respond_to_user instead. This is a backward compatibility alias for existing prompts/clients.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "The response text for the user. Write naturally and conversationally, without markdown or code formatting.",
        },
      },
      required: ["text"],
    },
  },

  {
    name: `${BUILTIN_SERVER_NAME}:mark_work_complete`,
    description: "Signal explicit completion for the current task. Call this only when all requested work is actually finished and ready for final delivery.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Concise summary of what was completed for the user.",
        },
        confidence: {
          type: "number",
          description: "Optional confidence from 0 to 1 that the task is fully complete.",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:toggle_whatsapp`,
    description: "Enable or disable WhatsApp integration. When enabled, allows sending and receiving WhatsApp messages through SpeakMCP.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) WhatsApp integration. If not provided, toggles to the opposite of the current state.",
        },
      },
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:execute_command`,
    description: "Execute any shell command. This is the primary tool for file operations, running scripts, and automation. Use for: reading files (cat), writing files (cat/echo with redirection), listing directories (ls), creating directories (mkdir -p), git operations, npm/python/node commands, and any shell command. If skillId is provided, the command runs in that skill's directory.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute. Examples: 'cat file.txt' (read), 'echo content > file.txt' (write), 'ls -la' (list), 'mkdir -p dir' (create dir), 'git status', 'npm install', 'python script.py'",
        },
        skillId: {
          type: "string",
          description: "Optional skill ID to run the command in that skill's directory. Get skill IDs from the enabled skills in the system prompt.",
        },
        timeout: {
          type: "number",
          description: "Command timeout in milliseconds (default: 30000). Set to 0 for no timeout.",
        },
      },
      required: ["command"],
    },
  },

  {
    name: `${BUILTIN_SERVER_NAME}:save_memory`,
    description: "Save a single-line memory note. Memories persist across sessions. Keep content ultra-compact (max 80 chars), skip grammar.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Single-line memory (max 80 chars). Examples: 'user prefers dark mode', 'uses pnpm not npm', 'api key in .env'",
        },
        importance: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "low=routine, medium=useful, high=discovery, critical=error (default: medium)",
        },
      },
      required: ["content"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:list_memories`,
    description: "List all saved memories for the current profile. Use this to check what's already remembered before saving duplicates, or to find memories to delete.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:delete_memory`,
    description: "Delete a memory by ID. Use this to remove redundant or outdated memories. Call list_memories first to get IDs.",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: {
          type: "string",
          description: "The memory ID to delete (from list_memories)",
        },
      },
      required: ["memoryId"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:delete_multiple_memories`,
    description: "Delete multiple memories by their IDs in a single operation. More efficient than calling delete_memory repeatedly. Call list_memories first to get IDs.",
    inputSchema: {
      type: "object",
      properties: {
        memoryIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of memory IDs to delete (from list_memories)",
        },
      },
      required: ["memoryIds"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:delete_all_memories`,
    description: "Delete ALL memories for the current profile. Use with caution - this cannot be undone. Consider using delete_multiple_memories for selective deletion.",
    inputSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          description: "Must be set to true to confirm deletion of all memories",
        },
      },
      required: ["confirm"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:list_server_tools`,
    description: "List all tools available from a specific MCP server. Use this to discover what tools a server provides before calling them.",
    inputSchema: {
      type: "object",
      properties: {
        serverName: {
          type: "string",
          description: "The name of the MCP server to list tools from (e.g., 'github', 'filesystem'). Use list_mcp_servers first to see available servers.",
        },
      },
      required: ["serverName"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:get_tool_schema`,
    description: "Get the full JSON schema for a specific tool, including all parameter details. Use this when you need to know the exact parameters to pass to a tool.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: {
          type: "string",
          description: "The full tool name including server prefix (e.g., 'github:create_issue', 'filesystem:read_file')",
        },
      },
      required: ["toolName"],
    },
  },
  {
    name: `${BUILTIN_SERVER_NAME}:load_skill_instructions`,
    description: "Load the full instructions for an agent skill. Skills are listed in the system prompt with just name and description. Call this tool to get the complete instructions when you need to use a skill.",
    inputSchema: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          description: "The skill ID to load instructions for. Get skill IDs from the Available Skills section in the system prompt.",
        },
      },
      required: ["skillId"],
    },
  },
]

/**
 * Get all builtin tool names (for disabling by default)
 */
export function getBuiltinToolNames(): string[] {
  return builtinToolDefinitions.map((tool) => tool.name)
}
