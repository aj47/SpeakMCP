/**
 * Built-in tools for ACP agent routing/delegation.
 * These tools allow the main agent to discover, spawn, delegate to, and manage sub-agents.
 */

import { acpRegistry } from './acp-registry';
import { acpClientService } from './acp-client-service';
import { acpProcessManager } from './acp-process-manager';
import type {
  ACPAgentInstance,
  ACPRunRequest,
  ACPRunResult,
  ACPSubAgentState,
} from './types';

/**
 * Log ACP router-related debug messages.
 */
function logACPRouter(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [ACP Router]`, ...args);
}

/**
 * Generate a unique run ID for tracking delegated runs.
 */
function generateDelegationRunId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `acp_delegation_${Date.now()}_${random}`;
}

/** Track delegated sub-agent runs for status checking */
const delegatedRuns: Map<string, ACPSubAgentState> = new Map();

// ============================================================================
// Tool Definitions
// ============================================================================

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
];

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * List all available ACP agents, optionally filtered by capability.
 * @param args - Arguments containing optional capability filter
 * @returns Object with list of available agents
 */
export async function handleListAvailableAgents(args: {
  capability?: string;
}): Promise<object> {
  logACPRouter('Listing available agents', args);

  try {
    let agents: ACPAgentInstance[];

    if (args.capability) {
      agents = acpRegistry.getAgentsByCapability(args.capability);
    } else {
      agents = acpRegistry.getAllAgents();
    }

    const formattedAgents = agents.map((agent) => ({
      name: agent.definition.name,
      displayName: agent.definition.displayName,
      description: agent.definition.description,
      capabilities: agent.definition.capabilities,
      status: agent.status,
      activeRuns: agent.activeRuns,
    }));

    return {
      success: true,
      agents: formattedAgents,
      count: formattedAgents.length,
      filter: args.capability || null,
    };
  } catch (error) {
    logACPRouter('Error listing agents:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      agents: [],
      count: 0,
    };
  }
}

/**
 * Delegate a task to a specialized ACP agent.
 * @param args - Arguments containing agent name, task, optional context, and wait preference
 * @param parentSessionId - Optional parent session ID for tracking
 * @returns Object with delegation result or run ID for async delegation
 */
export async function handleDelegateToAgent(
  args: {
    agentName: string;
    task: string;
    context?: string;
    waitForResult?: boolean;
  },
  parentSessionId?: string
): Promise<object> {
  logACPRouter('Delegating to agent', { ...args, parentSessionId });

  const waitForResult = args.waitForResult !== false; // Default to true

  try {
    // Check if agent exists
    const agent = acpRegistry.getAgent(args.agentName);
    if (!agent) {
      return {
        success: false,
        error: `Agent "${args.agentName}" not found`,
      };
    }

    // Check if agent is ready, if not try to spawn it
    if (agent.status !== 'ready' && agent.status !== 'busy') {
      // Check if agent has spawn config
      if (agent.definition.spawnConfig) {
        logACPRouter(`Agent "${args.agentName}" not ready, attempting to spawn...`);
        try {
          await acpProcessManager.spawnAgent(args.agentName);
          // Wait a bit for the agent to become ready
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (spawnError) {
          return {
            success: false,
            error: `Failed to spawn agent "${args.agentName}": ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
          };
        }
      } else {
        return {
          success: false,
          error: `Agent "${args.agentName}" is not ready (status: ${agent.status}) and cannot be auto-spawned`,
        };
      }
    }

    // Prepare the input message
    let input = args.task;
    if (args.context) {
      input = `Context: ${args.context}\n\nTask: ${args.task}`;
    }

    const runId = generateDelegationRunId();
    const startTime = Date.now();

    // Create the sub-agent state for tracking
    const subAgentState: ACPSubAgentState = {
      runId,
      agentName: args.agentName,
      parentSessionId: parentSessionId || 'unknown',
      task: args.task,
      status: 'pending',
      startTime,
    };

    delegatedRuns.set(runId, subAgentState);

    // Get the base URL from agent definition
    const baseUrl = agent.definition.baseUrl;
    if (!baseUrl) {
      return {
        success: false,
        error: `Agent "${args.agentName}" does not have a base URL configured`,
      };
    }

    // Create run request - cast to include baseUrl which is used by client service
    const runRequest = {
      agentName: args.agentName,
      input,
      mode: waitForResult ? 'sync' : 'async',
      parentSessionId,
      baseUrl,
    } as ACPRunRequest & { baseUrl: string };

    if (waitForResult) {
      // Synchronous execution - wait for result
      subAgentState.status = 'running';

      try {
        const result = await acpClientService.runAgentSync(runRequest);
        subAgentState.status = 'completed';
        subAgentState.result = result;

        // Extract text content from output
        const outputText = result.output
          ?.map((msg) => msg.parts.map((p) => p.content).join('\n'))
          .join('\n\n') || '';

        return {
          success: true,
          runId,
          agentName: args.agentName,
          status: 'completed',
          output: outputText,
          duration: Date.now() - startTime,
          metadata: result.metadata,
        };
      } catch (error) {
        subAgentState.status = 'failed';
        throw error;
      }
    } else {
      // Asynchronous execution - return immediately with run ID
      subAgentState.status = 'running';

      // Start the async run (don't await the result)
      acpClientService.runAgentAsync(runRequest).then(
        (asyncRunId) => {
          logACPRouter(`Async run started for ${args.agentName}: ${asyncRunId}`);
        },
        (error) => {
          subAgentState.status = 'failed';
          logACPRouter(`Async run failed for ${args.agentName}:`, error);
        }
      );

      return {
        success: true,
        runId,
        agentName: args.agentName,
        status: 'running',
        message: `Task delegated to "${args.agentName}". Use check_agent_status with runId "${runId}" to check progress.`,
      };
    }
  } catch (error) {
    logACPRouter('Error delegating to agent:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}


/**
 * Check the status of a running delegated agent task.
 * @param args - Arguments containing the run ID
 * @returns Object with current status of the run
 */
export async function handleCheckAgentStatus(args: { runId: string }): Promise<object> {
  logACPRouter('Checking agent status', args);

  try {
    const subAgentState = delegatedRuns.get(args.runId);

    if (!subAgentState) {
      return {
        success: false,
        error: `Run "${args.runId}" not found. It may have expired or never existed.`,
      };
    }

    const response: Record<string, unknown> = {
      success: true,
      runId: subAgentState.runId,
      agentName: subAgentState.agentName,
      task: subAgentState.task,
      status: subAgentState.status,
      startTime: subAgentState.startTime,
      duration: Date.now() - subAgentState.startTime,
    };

    if (subAgentState.progress) {
      response.progress = subAgentState.progress;
    }

    if (subAgentState.status === 'completed' && subAgentState.result) {
      const outputText = subAgentState.result.output
        ?.map((msg) => msg.parts.map((p) => p.content).join('\n'))
        .join('\n\n') || '';
      response.output = outputText;
      response.metadata = subAgentState.result.metadata;
    }

    if (subAgentState.status === 'failed' && subAgentState.result?.error) {
      response.error = subAgentState.result.error;
    }

    return response;
  } catch (error) {
    logACPRouter('Error checking agent status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Spawn a new instance of an ACP agent.
 * @param args - Arguments containing the agent name
 * @returns Object with spawn result
 */
export async function handleSpawnAgent(args: { agentName: string }): Promise<object> {
  logACPRouter('Spawning agent', args);

  try {
    // Check if agent exists
    const agent = acpRegistry.getAgent(args.agentName);
    if (!agent) {
      return {
        success: false,
        error: `Agent "${args.agentName}" not found`,
      };
    }

    // Check if agent is already running
    if (agent.status === 'ready' || agent.status === 'busy') {
      return {
        success: true,
        message: `Agent "${args.agentName}" is already running (status: ${agent.status})`,
        status: agent.status,
      };
    }

    // Check if agent has spawn config
    if (!agent.definition.spawnConfig) {
      return {
        success: false,
        error: `Agent "${args.agentName}" does not have spawn configuration. It may be a remote-only agent.`,
      };
    }

    // Spawn the agent
    await acpProcessManager.spawnAgent(args.agentName);

    return {
      success: true,
      message: `Agent "${args.agentName}" spawned successfully`,
      agentName: args.agentName,
    };
  } catch (error) {
    logACPRouter('Error spawning agent:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stop a running ACP agent process.
 * @param args - Arguments containing the agent name
 * @returns Object with stop result
 */
export async function handleStopAgent(args: { agentName: string }): Promise<object> {
  logACPRouter('Stopping agent', args);

  try {
    // Check if agent exists
    const agent = acpRegistry.getAgent(args.agentName);
    if (!agent) {
      return {
        success: false,
        error: `Agent "${args.agentName}" not found`,
      };
    }

    // Check if agent is running
    if (agent.status === 'stopped') {
      return {
        success: true,
        message: `Agent "${args.agentName}" is already stopped`,
        status: 'stopped',
      };
    }

    // Stop the agent
    await acpProcessManager.stopAgent(args.agentName);

    return {
      success: true,
      message: `Agent "${args.agentName}" stopped successfully`,
      agentName: args.agentName,
    };
  } catch (error) {
    logACPRouter('Error stopping agent:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}



// ============================================================================
// Main Dispatcher
// ============================================================================

/**
 * Execute an ACP router tool by name.
 * This is the main entry point for invoking ACP router tools.
 *
 * @param toolName - The full tool name (e.g., 'speakmcp-builtin:list_available_agents')
 * @param args - Arguments to pass to the tool handler
 * @param parentSessionId - Optional parent session ID for tracking delegations
 * @returns Object with content string and error flag
 */
export async function executeACPRouterTool(
  toolName: string,
  args: Record<string, unknown>,
  parentSessionId?: string
): Promise<{ content: string; isError: boolean }> {
  logACPRouter('Executing tool', { toolName, args, parentSessionId });

  try {
    let result: object;

    switch (toolName) {
      case 'speakmcp-builtin:list_available_agents':
        result = await handleListAvailableAgents(args as { capability?: string });
        break;

      case 'speakmcp-builtin:delegate_to_agent':
        result = await handleDelegateToAgent(
          args as {
            agentName: string;
            task: string;
            context?: string;
            waitForResult?: boolean;
          },
          parentSessionId
        );
        break;

      case 'speakmcp-builtin:check_agent_status':
        result = await handleCheckAgentStatus(args as { runId: string });
        break;

      case 'speakmcp-builtin:spawn_agent':
        result = await handleSpawnAgent(args as { agentName: string });
        break;

      case 'speakmcp-builtin:stop_agent':
        result = await handleStopAgent(args as { agentName: string });
        break;

      default:
        return {
          content: JSON.stringify({
            success: false,
            error: `Unknown ACP router tool: ${toolName}`,
          }),
          isError: true,
        };
    }

    const isError = 'success' in result && result.success === false;
    return {
      content: JSON.stringify(result, null, 2),
      isError,
    };
  } catch (error) {
    logACPRouter('Error executing tool:', error);
    return {
      content: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      isError: true,
    };
  }
}

/**
 * Check if a tool name is an ACP router tool.
 * @param toolName - The tool name to check
 * @returns True if the tool is an ACP router tool
 */
export function isACPRouterTool(toolName: string): boolean {
  return acpRouterToolDefinitions.some((def) => def.name === toolName);
}

/**
 * Get the list of delegated run IDs for a parent session.
 * @param parentSessionId - The parent session ID to filter by
 * @returns Array of run IDs
 */
export function getDelegatedRunsForSession(parentSessionId: string): string[] {
  const runIds: string[] = [];
  delegatedRuns.forEach((state, runId) => {
    if (state.parentSessionId === parentSessionId) {
      runIds.push(runId);
    }
  });
  return runIds;
}

/**
 * Clean up completed/failed delegated runs older than the specified age.
 * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
 */
export function cleanupOldDelegatedRuns(maxAgeMs: number = 60 * 60 * 1000): void {
  const now = Date.now();
  const toDelete: string[] = [];

  delegatedRuns.forEach((state, runId) => {
    if (
      (state.status === 'completed' || state.status === 'failed') &&
      now - state.startTime > maxAgeMs
    ) {
      toDelete.push(runId);
    }
  });

  for (const runId of toDelete) {
    delegatedRuns.delete(runId);
    logACPRouter(`Cleaned up old delegated run: ${runId}`);
  }
}
