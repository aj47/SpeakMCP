/**
 * ACP Router Tool Definitions - Dependency-Free Module
 *
 * This module contains ONLY the static tool definitions for ACP router tools.
 * It is intentionally kept free of runtime dependencies to avoid circular
 * import issues when other modules need access to tool names/schemas.
 *
 * The tool execution handlers are in acp-router-tools.ts, which imports
 * from this file and adds runtime functionality.
 */

/**
 * Tool definitions for ACP router tools.
 * These are exposed as built-in tools for the main agent to use.
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
    name: 'speakmcp-builtin:run_sub_session',
    description:
      'Run an internal sub-session of SpeakMCP itself to handle a sub-task. The sub-session has access to all the same MCP tools as the main session but runs with isolated state. Useful for parallel task execution, complex sub-tasks that benefit from isolated context, or when you need to delegate work without relying on external agents. Note: There is a maximum recursion depth to prevent infinite loops.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'The task or prompt for the sub-session to execute',
        },
        context: {
          type: 'string',
          description: 'Optional additional context to provide to the sub-session',
        },
        maxIterations: {
          type: 'number',
          description: 'Maximum number of agent iterations for the sub-session (default: 10)',
          default: 10,
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'speakmcp-builtin:check_sub_session',
    description: 'Check the status of a running internal sub-session',
    inputSchema: {
      type: 'object' as const,
      properties: {
        subSessionId: {
          type: 'string',
          description: 'The sub-session ID returned from a previous run_sub_session call',
        },
      },
      required: ['subSessionId'],
    },
  },
  {
    name: 'speakmcp-builtin:cancel_sub_session',
    description: 'Cancel a running internal sub-session',
    inputSchema: {
      type: 'object' as const,
      properties: {
        subSessionId: {
          type: 'string',
          description: 'The sub-session ID to cancel',
        },
      },
      required: ['subSessionId'],
    },
  },
];

