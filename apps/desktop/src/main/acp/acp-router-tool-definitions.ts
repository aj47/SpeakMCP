/**
 * ACP Router Tool Definitions - Dependency-Free Module
 *
 * This module contains ONLY the static tool definitions for ACP router tools.
 * It is intentionally kept free of runtime dependencies to avoid circular
 * import issues when other modules need access to tool names/schemas.
 *
 * The tool execution handlers are in acp-router-tools.ts, which imports
 * from this file and adds runtime functionality.
 * 
 * NOTE: This module now includes A2A-aligned tool names as aliases.
 * The following mappings apply:
 * - delegate_to_agent -> send_to_agent (A2A: message/send)
 * - check_agent_status -> get_task_status (A2A: tasks/get)
 * - cancel_agent_run -> cancel_task (A2A: tasks/cancel)
 */

/**
 * Tool definitions for ACP router tools.
 * These are exposed as built-in tools for the main agent to use.
 * 
 * Tools include both legacy names and A2A-aligned names for compatibility.
 */
export const acpRouterToolDefinitions = [
  {
    name: 'speakmcp-builtin:list_available_agents',
    description:
      'List all available specialized ACP agents that can be delegated to. Returns agent names, descriptions, and capabilities.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        capability: {
          type: 'string',
          description: 'Optional filter to only return agents with this capability',
        },
      },
      required: [],
    },
  },
  {
    name: 'speakmcp-builtin:delegate_to_agent',
    description:
      'Delegate a sub-task to a specialized ACP agent. The agent will work autonomously and return results. Use this when a task is better suited for a specialist.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentName: {
          type: 'string',
          description: 'Name of the agent to delegate to',
        },
        task: {
          type: 'string',
          description: 'Description of the task to delegate',
        },
        context: {
          type: 'string',
          description: 'Optional additional context for the agent',
        },
        waitForResult: {
          type: 'boolean',
          description: 'Whether to wait for the agent to complete (default: true)',
          default: true,
        },
      },
      required: ['agentName', 'task'],
    },
  },
  {
    name: 'speakmcp-builtin:check_agent_status',
    description: 'Check the status of a running delegated agent task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: {
          type: 'string',
          description: 'The run ID returned from a previous delegate_to_agent call',
        },
      },
      required: ['runId'],
    },
  },
  {
    name: 'speakmcp-builtin:spawn_agent',
    description:
      'Spawn a new instance of an ACP agent. Use when you need to ensure an agent is ready before delegating.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentName: {
          type: 'string',
          description: 'Name of the agent to spawn',
        },
      },
      required: ['agentName'],
    },
  },
  {
    name: 'speakmcp-builtin:stop_agent',
    description: 'Stop a running ACP agent process to free resources',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentName: {
          type: 'string',
          description: 'Name of the agent to stop',
        },
      },
      required: ['agentName'],
    },
  },
  {
    name: 'speakmcp-builtin:cancel_agent_run',
    description: 'Cancel a running delegated agent task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: {
          type: 'string',
          description: 'The run ID returned from a previous delegate_to_agent call',
        },
      },
      required: ['runId'],
    },
  },
  // A2A-aligned tool names (aliases for the above)
  {
    name: 'speakmcp-builtin:send_to_agent',
    description:
      'Send a task to an A2A agent. Alias for delegate_to_agent. The agent will process the task and return results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentName: {
          type: 'string',
          description: 'Name of the agent to send the task to',
        },
        task: {
          type: 'string',
          description: 'Description of the task to send',
        },
        context: {
          type: 'string',
          description: 'Optional additional context for the agent',
        },
        contextId: {
          type: 'string',
          description: 'Optional context ID to group related tasks (A2A concept)',
        },
        waitForResult: {
          type: 'boolean',
          description: 'Whether to wait for the agent to complete (default: true)',
          default: true,
        },
      },
      required: ['agentName', 'task'],
    },
  },
  {
    name: 'speakmcp-builtin:get_task_status',
    description: 'Get the status of a task. Alias for check_agent_status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID (or run ID) returned from a previous send_to_agent/delegate_to_agent call',
        },
        historyLength: {
          type: 'number',
          description: 'Optional number of conversation history messages to include',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'speakmcp-builtin:cancel_task',
    description: 'Cancel a running task. Alias for cancel_agent_run.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID to cancel',
        },
      },
      required: ['taskId'],
    },
  },
];

/**
 * Mapping from A2A tool names to their legacy ACP equivalents.
 * Used for backward compatibility in the execution handler.
 */
export const toolNameAliases: Record<string, string> = {
  'speakmcp-builtin:send_to_agent': 'speakmcp-builtin:delegate_to_agent',
  'speakmcp-builtin:get_task_status': 'speakmcp-builtin:check_agent_status',
  'speakmcp-builtin:cancel_task': 'speakmcp-builtin:cancel_agent_run',
};

/**
 * Resolve a tool name to its canonical handler name.
 * This allows A2A-named tools to map to existing handlers.
 */
export function resolveToolName(toolName: string): string {
  return toolNameAliases[toolName] || toolName;
}

/**
 * Check if a tool name is a router tool (including aliases).
 */
export function isRouterTool(toolName: string): boolean {
  return acpRouterToolDefinitions.some(def => def.name === toolName);
}

