/**
 * A2A Router Tool Definitions
 * 
 * Tool definitions that align with Google A2A protocol naming conventions.
 * These tools provide the same functionality as the ACP router tools but use
 * A2A terminology (Task instead of Run, send_to_agent instead of delegate_to_agent).
 * 
 * This module is dependency-free to avoid circular imports.
 */

/**
 * A2A-aligned tool definitions for agent routing.
 * These are exposed as built-in tools for the main agent to use.
 */
export const a2aRouterToolDefinitions = [
  {
    name: 'speakmcp-builtin:list_available_agents',
    description:
      'List all available A2A agents that can handle delegated tasks. Returns agent names, descriptions, skills, and capabilities.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        capability: {
          type: 'string',
          description: 'Optional filter to only return agents with this capability (e.g., "research", "coding", "analysis")',
        },
        skillName: {
          type: 'string',
          description: 'Optional filter to only return agents with skills matching this name',
        },
      },
      required: [],
    },
  },
  {
    name: 'speakmcp-builtin:send_to_agent',
    description:
      'Send a message/task to an A2A agent and get a task ID for tracking. The agent will process the task asynchronously. Use get_task_status to check progress.',
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
          description: 'Optional context ID to group related tasks together',
        },
        waitForResult: {
          type: 'boolean',
          description: 'Whether to wait for the agent to complete (default: true). Set to false for async tasks.',
          default: true,
        },
      },
      required: ['agentName', 'task'],
    },
  },
  {
    name: 'speakmcp-builtin:get_task_status',
    description: 'Get the current status of a task. Returns state, progress, and results if complete.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID returned from a previous send_to_agent call',
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
    description: 'Cancel a running task. The agent will attempt to stop processing.',
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
  {
    name: 'speakmcp-builtin:spawn_agent',
    description:
      'Spawn a new instance of an agent. Use when you need to ensure an agent is ready before sending tasks.',
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
    description: 'Stop a running agent process to free resources',
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
];

/**
 * Backward compatibility aliases - map old tool names to new ones.
 * The execution handler should check both old and new names.
 */
export const toolNameAliases: Record<string, string> = {
  // Old name -> New name (A2A-aligned)
  'speakmcp-builtin:delegate_to_agent': 'speakmcp-builtin:send_to_agent',
  'speakmcp-builtin:check_agent_status': 'speakmcp-builtin:get_task_status',
  'speakmcp-builtin:cancel_agent_run': 'speakmcp-builtin:cancel_task',
};

/**
 * Resolve a tool name to its canonical (A2A-aligned) name.
 */
export function resolveToolName(toolName: string): string {
  return toolNameAliases[toolName] || toolName;
}

/**
 * Check if a tool name is an A2A router tool (including aliases).
 */
export function isA2ARouterTool(toolName: string): boolean {
  const resolved = resolveToolName(toolName);
  return a2aRouterToolDefinitions.some(def => def.name === resolved);
}

/**
 * Get all tool names including aliases.
 */
export function getAllToolNames(): string[] {
  const canonical = a2aRouterToolDefinitions.map(def => def.name);
  const aliases = Object.keys(toolNameAliases);
  return [...canonical, ...aliases];
}
