/**
 * Built-in tools for ACP agent routing/delegation.
 * These tools allow the main agent to discover, spawn, delegate to, and manage sub-agents.
 */

import { acpClientService } from './acp-client-service';
import { acpRouterToolDefinitions, resolveToolName } from './acp-router-tool-definitions';
import type {
  ACPRunResult,
  ACPSubAgentState,
} from './types';
import { acpBackgroundNotifier } from './acp-background-notifier';
import { configStore } from '../config';
import { acpService, ACPContentBlock } from '../acp-service';
import { emitAgentProgress } from '../emit-agent-progress';
import type { ACPDelegationProgress, ACPSubAgentMessage } from '../../shared/types';
import {
  runInternalSubSession,
  cancelSubSession,
  getInternalAgentInfo,
  getSessionDepth,
} from './internal-agent';
import { a2aAgentRegistry, createA2AClient, a2aTaskManager } from '../a2a';
import type { A2ATextPart, A2AMessage, A2ATask, A2AArtifact } from '../a2a/types';

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

/**
 * Cleanup per-run mapping state so stale entries don't leak or misroute future session updates.
 *
 * Note: deletion is conditional to avoid clobbering mappings for a newer run that may have
 * already replaced the agentName/session mapping.
 */
function cleanupDelegationMappings(runId: string, agentName: string): void {
  // Remove agentName → runId fallback mapping only if it still points at this run.
  if (agentNameToActiveRunId.get(agentName) === runId) {
    agentNameToActiveRunId.delete(agentName);
    logACPRouter(`Cleaned up active run mapping for ${agentName}: ${runId}`);
  }

  // Remove any sessionId → runId mappings pointing at this run.
  for (const [sessionId, mappedRunId] of sessionToRunId.entries()) {
    if (mappedRunId === runId) {
      sessionToRunId.delete(sessionId);
      logACPRouter(`Cleaned up session mapping: ${sessionId} -> ${runId}`);
    }
  }
}

/** Track delegated sub-agent runs for status checking */
const delegatedRuns: Map<string, ACPSubAgentState> = new Map();

/** Track conversation messages per session for UI display */
const sessionConversations: Map<string, ACPSubAgentMessage[]> = new Map();

/** Map from agent session IDs to our delegation run IDs */
const sessionToRunId: Map<string, string> = new Map();

/** Map from agent names to their currently active run IDs (for session mapping fallback) */
const agentNameToActiveRunId: Map<string, string> = new Map();

/** Track last emit time per runId for rate limiting */
const lastEmitTime: Map<string, number> = new Map();

// ============================================================================
// Streaming Safeguards Configuration
// ============================================================================

/** Minimum interval between UI updates per run (ms) */
const MIN_EMIT_INTERVAL_MS = 100;

/** Maximum number of messages to keep in conversation history */
const MAX_CONVERSATION_MESSAGES = 100;

/** Maximum size of a single message content (characters) */
const MAX_MESSAGE_CONTENT_SIZE = 10000;

/** Maximum total conversation size to send to UI (characters) */
const MAX_CONVERSATION_SIZE_FOR_UI = 50000;

// Initialize background notifier with our delegated runs map
acpBackgroundNotifier.setDelegatedRunsMap(delegatedRuns);

/**
 * Truncate content to max size, adding ellipsis if truncated
 */
function truncateContent(content: string, maxSize: number): string {
  if (content.length <= maxSize) return content;
  return content.substring(0, maxSize - 3) + '...';
}

/**
 * Prepare conversation for UI transmission with size limits
 */
function prepareConversationForUI(conversation: ACPSubAgentMessage[]): ACPSubAgentMessage[] {
  // Take only the last N messages
  const recentMessages = conversation.slice(-MAX_CONVERSATION_MESSAGES);

  // Calculate total size and truncate if needed
  let totalSize = 0;
  const result: ACPSubAgentMessage[] = [];

  // Process from end to start to keep most recent messages
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    const msgSize = msg.content.length;

    if (totalSize + msgSize > MAX_CONVERSATION_SIZE_FOR_UI) {
      // Add a truncation notice at the start
      result.unshift({
        role: 'assistant',
        content: `[${i + 1} earlier messages truncated for display]`,
        timestamp: msg.timestamp,
      });
      break;
    }

    totalSize += msgSize;
    result.unshift({
      ...msg,
      content: truncateContent(msg.content, MAX_MESSAGE_CONTENT_SIZE),
    });
  }

  return result;
}

/**
 * Listen to session updates from ACP service and forward to UI
 */
acpService.on('sessionUpdate', (event: {
  agentName: string;
  sessionId: string;
  content?: ACPContentBlock[];
  isComplete?: boolean;
  stopReason?: string;
  totalBlocks: number;
}) => {
  const { agentName, sessionId, content, isComplete, stopReason } = event;

  logACPRouter(`Session update from ${agentName}:`, { sessionId, isComplete, contentBlocks: content?.length });

  // Find the run ID for this session
  const mappedRunId = sessionToRunId.get(sessionId);
  let runId = mappedRunId;

  // If no session mapping exists, try to find by agent name (fallback for race condition)
  if (!runId) {
    const activeRunId = agentNameToActiveRunId.get(agentName);
    if (activeRunId) {
      // Establish the session mapping now that we have both IDs
      sessionToRunId.set(sessionId, activeRunId);
      runId = activeRunId;
      logACPRouter(`Created session mapping: ${sessionId} -> ${runId} (via agent name fallback)`);
    } else {
      logACPRouter(`No run ID found for session ${sessionId} or agent ${agentName}`);
      return;
    }
  }

  let subAgentState = delegatedRuns.get(runId);
  if (!subAgentState) {
    // If we got a runId from session mapping but can't find state, the mapping is stale.
    // Clean it up and retry via agent-name fallback (fixes misrouting/dropping later updates).
    if (mappedRunId) {
      sessionToRunId.delete(sessionId);
      if (agentNameToActiveRunId.get(agentName) === mappedRunId) {
        agentNameToActiveRunId.delete(agentName);
      }
      logACPRouter(`Removed stale session mapping: ${sessionId} -> ${mappedRunId}`);

      const activeRunId = agentNameToActiveRunId.get(agentName);
      if (!activeRunId) {
        logACPRouter(`No active run found for agent ${agentName} after stale mapping cleanup`);
        return;
      }

      sessionToRunId.set(sessionId, activeRunId);
      runId = activeRunId;
      subAgentState = delegatedRuns.get(runId);
      if (!subAgentState) {
        logACPRouter(`No sub-agent state found for recovered run ${runId}`);
        return;
      }
      logACPRouter(`Recovered session mapping: ${sessionId} -> ${runId} (after stale cleanup)`);
    } else {
      logACPRouter(`No sub-agent state found for run ${runId}`);
      return;
    }
  }

  // Get or create conversation for this run (use runId, not sessionId, for consistency)
  let conversation = sessionConversations.get(runId);
  if (!conversation) {
    conversation = [];
    sessionConversations.set(runId, conversation);
  }

  // Convert content blocks to conversation messages with size limits
  if (content && Array.isArray(content)) {
    for (const block of content) {
      const message: ACPSubAgentMessage = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      if (block.type === 'text' && block.text) {
        // Truncate individual message content
        message.content = truncateContent(block.text, MAX_MESSAGE_CONTENT_SIZE);
        conversation.push(message);
      } else if (block.type === 'tool_use' && block.name) {
        message.role = 'tool';
        message.toolName = block.name;
        message.toolInput = block.input;
        message.content = `Using tool: ${block.name}`;
        if (block.input) {
          message.content += `\nInput: ${truncateContent(JSON.stringify(block.input, null, 2), 500)}`;
        }
        conversation.push(message);
      } else if (block.type === 'tool_result') {
        message.role = 'tool';
        const resultStr = typeof block.result === 'string' ? block.result : JSON.stringify(block.result);
        message.content = `Tool result: ${truncateContent(resultStr, 500)}`;
        conversation.push(message);
      }
    }
  }

  // Enforce conversation size limit (keep most recent messages)
  if (conversation.length > MAX_CONVERSATION_MESSAGES * 2) {
    const trimmed = conversation.slice(-MAX_CONVERSATION_MESSAGES);
    sessionConversations.set(runId, trimmed);
    conversation = trimmed;
  }

  // Rate limiting: skip emit if we recently emitted (unless complete)
  const now = Date.now();
  const lastEmit = lastEmitTime.get(runId) || 0;
  if (!isComplete && now - lastEmit < MIN_EMIT_INTERVAL_MS) {
    logACPRouter(`Rate limiting UI emit for run ${runId} (${now - lastEmit}ms since last)`);
    return;
  }
  lastEmitTime.set(runId, now);

  // Build delegation progress with size-limited conversation
  const delegationProgress: ACPDelegationProgress = {
    runId: subAgentState.runId,
    agentName: subAgentState.agentName,
    task: subAgentState.task,
    status: isComplete ? 'completed' : 'running',
    startTime: subAgentState.startTime,
    endTime: isComplete ? Date.now() : undefined,
    progressMessage: stopReason ? `Stop reason: ${stopReason}` : undefined,
    conversation: prepareConversationForUI(conversation),
  };

  // Emit progress update to UI
  emitAgentProgress({
    sessionId: subAgentState.parentSessionId,
    currentIteration: 0,
    maxIterations: 1,
    isComplete: isComplete || false,
    steps: [
      {
        id: `delegation-${runId}`,
        type: 'completion',
        title: `Sub-agent: ${agentName}`,
        description: subAgentState.task,
        status: isComplete ? 'completed' : 'in_progress',
        timestamp: Date.now(),
        delegation: delegationProgress,
      },
    ],
  }).catch(err => {
    logACPRouter('Failed to emit agent progress:', err);
  });

  // Once the agent reports completion for this session, the mappings are no longer needed.
  // Clean them up to prevent leaks / stale fallbacks affecting future runs.
  if (isComplete) {
    cleanupDelegationMappings(runId, subAgentState.agentName);
  }
});

// Re-export tool definitions from the dependency-free module
export { acpRouterToolDefinitions } from './acp-router-tool-definitions';

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Get the internal agent config, merged with enabled state from user config if present.
 */
export function getInternalAgentConfig(): import('../../shared/types').ACPAgentConfig {
  const internalInfo = getInternalAgentInfo();
  const config = configStore.get();

  // Check if user has explicitly disabled internal agent
  const userInternalConfig = config.acpAgents?.find(a => a.name === 'internal');
  const enabled = userInternalConfig?.enabled !== false; // Default to true

  return {
    name: internalInfo.name,
    displayName: internalInfo.displayName,
    description: internalInfo.description,
    capabilities: internalInfo.capabilities,
    enabled,
    isInternal: true,
    connection: { type: 'internal' },
  };
}

/**
 * List all available ACP agents, optionally filtered by capability.
 * Uses configStore for agent definitions and acpService for runtime status.
 * Includes the built-in internal agent alongside configured external agents.
 * @param args - Arguments containing optional capability filter
 * @returns Object with list of available agents
 */
export async function handleListAvailableAgents(args: {
  capability?: string;
}): Promise<object> {
  logACPRouter('Listing available agents', args);

  try {
    // Get agents from the actual config (shared/types.ts ACPAgentConfig)
    const config = configStore.get();

    // Start with external agents from config (excluding any 'internal' entry - we add it separately)
    let agentConfigs = (config.acpAgents || []).filter(a => a.name !== 'internal');

    // Add the internal agent
    const internalAgentConfig = getInternalAgentConfig();
    agentConfigs = [internalAgentConfig, ...agentConfigs];

    // Filter by capability if specified
    if (args.capability) {
      agentConfigs = agentConfigs.filter(
        (agent) => agent.capabilities?.includes(args.capability!) ?? false
      );
    }

    // Get runtime status from acpService (for external agents)
    const agentStatuses = acpService.getAgents();
    const statusMap = new Map(
      agentStatuses.map((a) => [a.config.name, { status: a.status, error: a.error }])
    );

    const formattedAgents = agentConfigs
      .filter((agent) => agent.enabled !== false) // Exclude disabled agents
      .map((agent) => {
        // Internal agent is always ready
        if (agent.connection.type === 'internal') {
          return {
            name: agent.name,
            displayName: agent.displayName,
            description: agent.description || '',
            capabilities: agent.capabilities || [],
            connectionType: agent.connection.type,
            status: 'ready' as const,
            error: undefined,
            isInternal: true,
          };
        }

        // External agents - check runtime status
        const runtime = statusMap.get(agent.name);
        return {
          name: agent.name,
          displayName: agent.displayName,
          description: agent.description || '',
          capabilities: agent.capabilities || [],
          connectionType: agent.connection.type,
          status: runtime?.status || 'stopped',
          error: runtime?.error,
          isInternal: false,
        };
      });

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
 * Delegate a task to a specialized ACP agent (external or internal).
 * Routes to internal sub-session for 'internal' agent, otherwise uses acpService.
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

  // Handle internal agent delegation
  if (args.agentName === 'internal') {
    return handleInternalAgentDelegation(args, parentSessionId);
  }

  // Check if this is an A2A agent (by URL or name match in A2A registry)
  const a2aAgent = a2aAgentRegistry.getAllAgents().find(
    a => a.card.name === args.agentName || a.card.url === args.agentName
  );
  if (a2aAgent) {
    return handleA2ADelegation(args, a2aAgent.card.url, parentSessionId);
  }

  try {
    // Check if agent exists in config
    const config = configStore.get();
    const agentConfig = config.acpAgents?.find((a) => a.name === args.agentName);
    if (!agentConfig) {
      return {
        success: false,
        error: `Agent "${args.agentName}" not found in configuration or A2A registry`,
      };
    }

    if (agentConfig.enabled === false) {
      return {
        success: false,
        error: `Agent "${args.agentName}" is disabled`,
      };
    }

    // Check current status via acpService
    const agentStatus = acpService.getAgentStatus(args.agentName);

    // If agent is not ready, try to spawn it (only for stdio agents)
    if (agentStatus?.status !== 'ready') {
      if (agentConfig.connection.type === 'stdio') {
        logACPRouter(`Agent "${args.agentName}" not ready, attempting to spawn...`);
        try {
          await acpService.spawnAgent(args.agentName);
        } catch (spawnError) {
          return {
            success: false,
            error: `Failed to spawn agent "${args.agentName}": ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
          };
        }
      } else {
        return {
          success: false,
          error: `Agent "${args.agentName}" is not ready (status: ${agentStatus?.status || 'stopped'}) and is a remote agent that cannot be auto-spawned`,
        };
      }
    }

    // Prepare the input message
    // NOTE: Do not inline context formatting here; ACP service handles context formatting.
    const input = args.task;

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

    // Use acpService.runTask for the actual delegation
    subAgentState.status = 'running';

    // Register the agent name -> runId mapping for session update fallback
    agentNameToActiveRunId.set(args.agentName, runId);
    logACPRouter(`Registered active run for ${args.agentName}: ${runId}`);

    // Add user message to conversation
    const userMessage: ACPSubAgentMessage = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    sessionConversations.set(runId, [userMessage]);

    // Helper to register session mapping after task starts
    const registerSessionMapping = () => {
      const sessionId = acpService.getAgentSessionId(args.agentName);
      if (sessionId) {
        sessionToRunId.set(sessionId, runId);
        logACPRouter(`Mapped session ${sessionId} to run ${runId}`);
      }
    };

    if (waitForResult) {
      // Synchronous execution - wait for result
      try {
        // Register mapping before running (session may already exist)
        registerSessionMapping();

        const result = await acpService.runTask({
          agentName: args.agentName,
          input,
          context: args.context,
          mode: 'sync',
        });

        // Register mapping again after task (session may have been created)
        registerSessionMapping();

        // Get collected conversation
        const conversation = sessionConversations.get(runId) || [];

        // Add final assistant message if we got a result
        if (result.result) {
          conversation.push({
            role: 'assistant',
            content: result.result,
            timestamp: Date.now(),
          });
        }

        if (result.success) {
          subAgentState.status = 'completed';
          cleanupDelegationMappings(runId, args.agentName);
          return {
            success: true,
            runId,
            agentName: args.agentName,
            status: 'completed',
            output: result.result || '',
            duration: Date.now() - startTime,
            conversation,
          };
        } else {
          subAgentState.status = 'failed';
          cleanupDelegationMappings(runId, args.agentName);
          return {
            success: false,
            runId,
            agentName: args.agentName,
            status: 'failed',
            error: result.error || 'Unknown error',
            duration: Date.now() - startTime,
            conversation,
          };
        }
      } catch (error) {
        subAgentState.status = 'failed';
        cleanupDelegationMappings(runId, args.agentName);
        throw error;
      }
    } else {
      // Asynchronous execution - return immediately with run ID
      // Start background polling for notifications
      acpBackgroundNotifier.startPolling();

      // For remote HTTP agents, use acpClientService which returns a server run_id for status polling
      if (agentConfig.connection.type === 'remote') {
        const baseUrl = agentConfig.connection.baseUrl;
        // Store baseUrl in subAgentState for background notifier to use
        subAgentState.baseUrl = baseUrl;

        // Start the async run via HTTP API
        acpClientService.runAgentAsync({
          agentName: args.agentName,
          input,
          mode: 'async',
          parentSessionId,
        }).then(
          (acpRunId) => {
            // Store the server's run ID for status polling
            subAgentState.acpRunId = acpRunId;
            logACPRouter(`Async HTTP run started for ${args.agentName}: acpRunId=${acpRunId}`);
          },
          (error) => {
            subAgentState.status = 'failed';
            const endTime = Date.now();
            subAgentState.result = {
              runId,
              agentName: args.agentName,
              status: 'failed',
              startTime: subAgentState.startTime,
              endTime,
              metadata: { duration: endTime - subAgentState.startTime },
              error: error instanceof Error ? error.message : String(error),
            };
            cleanupDelegationMappings(runId, args.agentName);
            logACPRouter(`Async HTTP run failed for ${args.agentName}:`, error);
          }
        );
      } else {
        // For stdio agents, use acpService.runTask
        acpService.runTask({
          agentName: args.agentName,
          input,
          context: args.context,
          mode: 'async',
        }).then(
          (result) => {
            // Register mapping after task completes (session should now exist)
            registerSessionMapping();

            const endTime = Date.now();

            if (result.success) {
              subAgentState.status = 'completed';
              // Store result for later retrieval
              const runResult: ACPRunResult = {
                runId,
                agentName: args.agentName,
                status: 'completed',
                startTime: subAgentState.startTime,
                endTime,
                metadata: { duration: endTime - subAgentState.startTime },
                output: [
                  {
                    role: 'assistant',
                    parts: [{ content: result.result || '' }],
                  },
                ],
              };
              subAgentState.result = runResult;
            } else {
              subAgentState.status = 'failed';
              const runResult: ACPRunResult = {
                runId,
                agentName: args.agentName,
                status: 'failed',
                startTime: subAgentState.startTime,
                endTime,
                metadata: { duration: endTime - subAgentState.startTime },
                error: result.error || 'Unknown error',
              };
              subAgentState.result = runResult;
            }
            // Clean up mappings now that the run is done to avoid stale routing.
            cleanupDelegationMappings(runId, args.agentName);
            logACPRouter(`Async run completed for ${args.agentName}:`, result.success ? 'success' : 'failed');
          },
          (error) => {
            subAgentState.status = 'failed';
            const endTime = Date.now();
            subAgentState.result = {
              runId,
              agentName: args.agentName,
              status: 'failed',
              startTime: subAgentState.startTime,
              endTime,
              metadata: { duration: endTime - subAgentState.startTime },
              error: error instanceof Error ? error.message : String(error),
            };
            // Best-effort mapping cleanup for hard failures (no further session updates expected)
            cleanupDelegationMappings(runId, args.agentName);
            logACPRouter(`Async run failed for ${args.agentName}:`, error);
          }
        );
      }

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

    // If we have an acpRunId and baseUrl, query the ACP server for actual status
    if (subAgentState.acpRunId && subAgentState.baseUrl && subAgentState.status === 'running') {
      try {
        const acpResult = await acpClientService.getRunStatus(
          subAgentState.baseUrl,
          subAgentState.acpRunId
        );

        // Update local state based on ACP server response
        if (acpResult.status === 'completed') {
          subAgentState.status = 'completed';
          subAgentState.result = acpResult;
        } else if (acpResult.status === 'failed') {
          subAgentState.status = 'failed';
          subAgentState.result = acpResult;
        }
        // If still running, keep local status as 'running'
      } catch (statusError) {
        logACPRouter('Error querying ACP server status:', statusError);
        // Continue with local state if ACP query fails
      }
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
 * Uses acpService to spawn stdio-based agents.
 * @param args - Arguments containing the agent name
 * @returns Object with spawn result
 */
export async function handleSpawnAgent(args: { agentName: string }): Promise<object> {
  logACPRouter('Spawning agent', args);

  try {
    // Check if agent exists in config
    const config = configStore.get();
    const agentConfig = config.acpAgents?.find((a) => a.name === args.agentName);
    if (!agentConfig) {
      return {
        success: false,
        error: `Agent "${args.agentName}" not found in configuration`,
      };
    }

    if (agentConfig.enabled === false) {
      return {
        success: false,
        error: `Agent "${args.agentName}" is disabled`,
      };
    }

    // Check current status
    const agentStatus = acpService.getAgentStatus(args.agentName);

    // Check if agent is already running
    if (agentStatus?.status === 'ready') {
      return {
        success: true,
        message: `Agent "${args.agentName}" is already running`,
        status: 'ready',
      };
    }

    // Only stdio agents can be spawned
    if (agentConfig.connection.type !== 'stdio') {
      return {
        success: false,
        error: `Agent "${args.agentName}" is a remote agent and cannot be spawned. It should be started externally.`,
      };
    }

    // Spawn the agent via acpService
    await acpService.spawnAgent(args.agentName);

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
 * Uses acpService to stop agents.
 * @param args - Arguments containing the agent name
 * @returns Object with stop result
 */
export async function handleStopAgent(args: { agentName: string }): Promise<object> {
  logACPRouter('Stopping agent', args);

  try {
    // Check if agent exists in config
    const config = configStore.get();
    const agentConfig = config.acpAgents?.find((a) => a.name === args.agentName);
    if (!agentConfig) {
      return {
        success: false,
        error: `Agent "${args.agentName}" not found in configuration`,
      };
    }

    // Check current status
    const agentStatus = acpService.getAgentStatus(args.agentName);

    // Check if agent is already stopped
    if (agentStatus?.status === 'stopped' || !agentStatus) {
      return {
        success: true,
        message: `Agent "${args.agentName}" is already stopped`,
        status: 'stopped',
      };
    }

    // Stop the agent via acpService
    await acpService.stopAgent(args.agentName);

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
  // Resolve A2A-aligned tool names to their canonical handlers
  const resolvedToolName = resolveToolName(toolName);
  logACPRouter('Executing tool', { toolName, resolvedToolName, args, parentSessionId });

  try {
    let result: object;

    switch (resolvedToolName) {
      case 'speakmcp-builtin:list_available_agents':
        result = await handleListAvailableAgents(args as { capability?: string; skillName?: string });
        break;

      case 'speakmcp-builtin:delegate_to_agent':
        // Handle both legacy 'runId' and A2A 'taskId' terminology
        result = await handleDelegateToAgent(
          args as {
            agentName: string;
            task: string;
            context?: string;
            contextId?: string;
            waitForResult?: boolean;
          },
          parentSessionId
        );
        break;

      case 'speakmcp-builtin:check_agent_status':
        // Handle both legacy 'runId' and A2A 'taskId' parameter names
        const statusArgs = args as { runId?: string; taskId?: string; historyLength?: number };
        result = await handleCheckAgentStatus({ 
          runId: statusArgs.runId || statusArgs.taskId || '' 
        });
        break;

      case 'speakmcp-builtin:spawn_agent':
        result = await handleSpawnAgent(args as { agentName: string });
        break;

      case 'speakmcp-builtin:stop_agent':
        result = await handleStopAgent(args as { agentName: string });
        break;

      case 'speakmcp-builtin:cancel_agent_run':
        // Handle both legacy 'runId' and A2A 'taskId' parameter names
        const cancelArgs = args as { runId?: string; taskId?: string };
        result = await handleCancelAgentRun({ 
          runId: cancelArgs.runId || cancelArgs.taskId || '' 
        });
        break;

      default:
        return {
          content: JSON.stringify({
            success: false,
            error: `Unknown ACP/A2A router tool: ${toolName}`,
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
 * Includes both legacy names and A2A-aligned aliases.
 * @param toolName - The tool name to check
 * @returns True if the tool is an ACP/A2A router tool
 */
export function isACPRouterTool(toolName: string): boolean {
  // Check both the original name and any aliases
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
 * Get detailed information about a delegated run, including conversation.
 * @param runId - The run ID to look up
 * @returns The delegation progress with conversation, or null if not found
 */
export function getDelegatedRunDetails(runId: string): ACPDelegationProgress | null {
  const state = delegatedRuns.get(runId);
  if (!state) {
    return null;
  }

  const conversation = sessionConversations.get(runId) || [];

  return {
    runId: state.runId,
    agentName: state.agentName,
    task: state.task,
    status: state.status,
    startTime: state.startTime,
    endTime: state.status === 'completed' || state.status === 'failed' ? Date.now() : undefined,
    progressMessage: state.progress,
    resultSummary: state.result?.output?.[0]?.parts?.[0]?.content?.substring(0, 200),
    error: state.result?.error,
    conversation: [...conversation],
  };
}

/**
 * Get all delegated runs with their conversations for a session.
 * Useful for inspecting subagent activity.
 * @param parentSessionId - The parent session ID
 * @returns Array of delegation progress objects with conversations
 */
export function getAllDelegationsForSession(parentSessionId: string): ACPDelegationProgress[] {
  const results: ACPDelegationProgress[] = [];

  delegatedRuns.forEach((state, runId) => {
    if (state.parentSessionId === parentSessionId) {
      const details = getDelegatedRunDetails(runId);
      if (details) {
        results.push(details);
      }
    }
  });

  return results;
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
    const state = delegatedRuns.get(runId);
    if (state) {
      cleanupDelegationMappings(runId, state.agentName);
    }
    delegatedRuns.delete(runId);
    sessionConversations.delete(runId);
    lastEmitTime.delete(runId);
    logACPRouter(`Cleaned up old delegated run: ${runId}`);
  }
}

// ============================================================================
// Internal Agent Delegation (unified with external agents)
// ============================================================================

/**
 * Handle delegation to the internal agent.
 * This routes to the internal sub-session system but tracks in delegatedRuns like external agents.
 */
async function handleInternalAgentDelegation(
  args: {
    task: string;
    context?: string;
    waitForResult?: boolean;
  },
  parentSessionId?: string
): Promise<object> {
  logACPRouter('Delegating to internal agent', { task: args.task.substring(0, 100), parentSessionId });

  // Check if internal agent is enabled
  const internalConfig = getInternalAgentConfig();
  if (internalConfig.enabled === false) {
    return {
      success: false,
      error: 'Internal agent is disabled',
    };
  }

  if (!parentSessionId) {
    return {
      success: false,
      error: 'Parent session ID is required for internal agent delegation',
    };
  }

  const runId = generateDelegationRunId();
  const startTime = Date.now();

  // Create sub-agent state for unified tracking
  const subAgentState: ACPSubAgentState = {
    runId,
    agentName: 'internal',
    parentSessionId,
    task: args.task,
    status: 'pending',
    startTime,
    isInternal: true,
  };

  delegatedRuns.set(runId, subAgentState);
  subAgentState.status = 'running';

  // Add user message to conversation
  const userMessage: ACPSubAgentMessage = {
    role: 'user',
    content: args.task,
    timestamp: Date.now(),
  };
  sessionConversations.set(runId, [userMessage]);

  try {
    // Run the internal sub-session
    const result = await runInternalSubSession({
      task: args.task,
      context: args.context,
      parentSessionId,
    });

    // Convert conversation history to ACPSubAgentMessage format
    const conversation = result.conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }));
    sessionConversations.set(runId, conversation);

    if (result.success) {
      subAgentState.status = 'completed';
      return {
        success: true,
        runId,
        agentName: 'internal',
        status: 'completed',
        output: result.result || '',
        duration: Date.now() - startTime,
        conversation,
      };
    } else {
      subAgentState.status = 'failed';
      return {
        success: false,
        runId,
        agentName: 'internal',
        status: 'failed',
        error: result.error || 'Unknown error',
        duration: Date.now() - startTime,
        conversation,
      };
    }
  } catch (error) {
    subAgentState.status = 'failed';
    logACPRouter('Error in internal agent delegation:', error);
    return {
      success: false,
      runId,
      agentName: 'internal',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// A2A Agent Delegation (Google Agent-to-Agent Protocol)
// ============================================================================

/**
 * Handle delegation to an A2A remote agent.
 * Uses the A2A protocol (message/send, tasks/get, etc.) for communication.
 */
async function handleA2ADelegation(
  args: {
    agentName: string;
    task: string;
    context?: string;
    contextId?: string;
    waitForResult?: boolean;
  },
  agentUrl: string,
  parentSessionId?: string
): Promise<object> {
  logACPRouter('Delegating to A2A agent', { agentName: args.agentName, agentUrl, parentSessionId });

  const waitForResult = args.waitForResult !== false;
  const runId = generateDelegationRunId();
  const startTime = Date.now();

  // Create sub-agent state for tracking
  const subAgentState: ACPSubAgentState = {
    runId,
    agentName: args.agentName,
    parentSessionId: parentSessionId || 'unknown',
    task: args.task,
    status: 'pending',
    startTime,
    baseUrl: agentUrl,
    isA2A: true,
  };

  delegatedRuns.set(runId, subAgentState);
  subAgentState.status = 'running';

  // Add user message to conversation
  const userMessage: ACPSubAgentMessage = {
    role: 'user',
    content: args.task,
    timestamp: Date.now(),
  };
  sessionConversations.set(runId, [userMessage]);

  // Helper to extract text from A2A message parts
  const extractTextFromParts = (parts: Array<A2ATextPart | unknown>): string => {
    return parts
      .filter((p): p is A2ATextPart => typeof p === 'object' && p !== null && 'text' in p)
      .map(p => p.text)
      .join('\n');
  };

  // Helper to extract text from A2A artifacts
  const extractTextFromArtifacts = (artifacts: A2AArtifact[]): string => {
    return artifacts
      .filter(a => a.parts?.some(p => 'text' in p))
      .map(a => extractTextFromParts(a.parts || []))
      .join('\n\n');
  };

  try {
    // Create A2A client for this agent
    const a2aClient = createA2AClient(agentUrl);
    const a2aClientOptions = { timeoutMs: 300000 }; // 5 minutes

    // Build the message content
    const messageContent = args.context
      ? `Context: ${args.context}\n\nTask: ${args.task}`
      : args.task;

    // Create a task via the task manager for tracking
    const contextId = args.contextId || parentSessionId || `ctx_${Date.now()}`;
    const managedTask = a2aTaskManager.createTask({
      agentUrl,
      description: messageContent,
      contextId,
    });

    // Store the A2A task ID for status polling
    subAgentState.acpRunId = managedTask.task.id;

    if (waitForResult) {
      // Synchronous execution - send message and wait for completion
      try {
        const result = await a2aClient.sendMessage({
          message: {
            role: 'user',
            parts: [{ text: messageContent }],
          },
          configuration: {
            acceptedOutputModes: ['text'],
          },
        }, a2aClientOptions);

        // Process the response - could be { task: A2ATask } or { message: A2AMessage }
        const conversation: ACPSubAgentMessage[] = [userMessage];
        let outputText = '';
        let taskState: string = 'unknown';
        let taskId: string | undefined;

        if ('task' in result && result.task) {
          const task = result.task;
          taskId = task.id;
          taskState = task.status?.state || 'unknown';

          // Extract from task history
          if (task.history) {
            for (const msg of task.history) {
              const textContent = extractTextFromParts(msg.parts);
              if (textContent) {
                conversation.push({
                  role: msg.role === 'user' ? 'user' : 'assistant',
                  content: textContent,
                  timestamp: Date.now(),
                });
              }
            }
          }

          // Extract from artifacts
          if (task.artifacts) {
            outputText = extractTextFromArtifacts(task.artifacts);
          }

          // Update task manager status
          a2aTaskManager.updateStatus(managedTask.task.id, task.status?.state || 'working');
        } else if ('message' in result && result.message) {
          // Direct message response (no task created)
          const msg = result.message;
          const textContent = extractTextFromParts(msg.parts);
          if (textContent) {
            outputText = textContent;
            conversation.push({
              role: 'assistant',
              content: textContent,
              timestamp: Date.now(),
            });
          }
          taskState = 'completed'; // Direct message means task is done
        }

        sessionConversations.set(runId, conversation);

        // Check task status
        if (taskState === 'completed') {
          subAgentState.status = 'completed';
          cleanupDelegationMappings(runId, args.agentName);
          return {
            success: true,
            runId,
            agentName: args.agentName,
            status: 'completed',
            output: outputText || 'Task completed',
            duration: Date.now() - startTime,
            conversation,
            isA2A: true,
          };
        } else if (taskState === 'failed') {
          subAgentState.status = 'failed';
          cleanupDelegationMappings(runId, args.agentName);
          return {
            success: false,
            runId,
            agentName: args.agentName,
            status: 'failed',
            error: 'A2A task failed',
            duration: Date.now() - startTime,
            conversation,
            isA2A: true,
          };
        } else {
          // Task is still running or in input-required state
          subAgentState.status = 'running';
          return {
            success: true,
            runId,
            agentName: args.agentName,
            status: taskState,
            message: `A2A task submitted. Current state: ${taskState}`,
            taskId,
            isA2A: true,
          };
        }
      } catch (error) {
        subAgentState.status = 'failed';
        cleanupDelegationMappings(runId, args.agentName);
        throw error;
      }
    } else {
      // Asynchronous execution - return immediately
      acpBackgroundNotifier.startPolling();

      // Send message asynchronously
      a2aClient.sendMessage({
        message: {
          role: 'user',
          parts: [{ text: messageContent }],
        },
        configuration: {
          acceptedOutputModes: ['text'],
        },
      }).then(
        (result) => {
          let taskState = 'unknown';
          let outputText = '';

          if ('task' in result && result.task) {
            const task = result.task;
            taskState = task.status?.state || 'unknown';
            a2aTaskManager.updateStatus(managedTask.task.id, task.status?.state || 'working');

            if (task.artifacts) {
              outputText = extractTextFromArtifacts(task.artifacts);
            }
          } else if ('message' in result && result.message) {
            outputText = extractTextFromParts(result.message.parts);
            taskState = 'completed';
          }

          if (taskState === 'completed') {
            subAgentState.status = 'completed';
            subAgentState.result = {
              runId,
              agentName: args.agentName,
              status: 'completed',
              startTime: subAgentState.startTime,
              endTime: Date.now(),
              metadata: { duration: Date.now() - subAgentState.startTime },
              output: [{ role: 'assistant', parts: [{ content: outputText }] }],
            };
          } else if (taskState === 'failed') {
            subAgentState.status = 'failed';
            subAgentState.result = {
              runId,
              agentName: args.agentName,
              status: 'failed',
              startTime: subAgentState.startTime,
              endTime: Date.now(),
              metadata: { duration: Date.now() - subAgentState.startTime },
              error: 'A2A task failed',
            };
          }
          cleanupDelegationMappings(runId, args.agentName);
        },
        (error) => {
          subAgentState.status = 'failed';
          subAgentState.result = {
            runId,
            agentName: args.agentName,
            status: 'failed',
            startTime: subAgentState.startTime,
            endTime: Date.now(),
            metadata: { duration: Date.now() - subAgentState.startTime },
            error: error instanceof Error ? error.message : String(error),
          };
          cleanupDelegationMappings(runId, args.agentName);
          logACPRouter(`Async A2A run failed for ${args.agentName}:`, error);
        }
      );

      return {
        success: true,
        runId,
        agentName: args.agentName,
        status: 'running',
        message: `Task delegated to A2A agent "${args.agentName}". Use check_agent_status with runId "${runId}" to check progress.`,
        taskId: managedTask.task.id,
        isA2A: true,
      };
    }
  } catch (error) {
    subAgentState.status = 'failed';
    cleanupDelegationMappings(runId, args.agentName);
    logACPRouter('Error in A2A agent delegation:', error);
    return {
      success: false,
      runId,
      agentName: args.agentName,
      error: error instanceof Error ? error.message : String(error),
      isA2A: true,
    };
  }
}

/**
 * Cancel a running agent task (internal or external).
 * @param args - Arguments containing the run ID
 * @returns Object with cancellation result
 */
export async function handleCancelAgentRun(args: { runId: string }): Promise<object> {
  logACPRouter('Cancelling agent run', args);

  const state = delegatedRuns.get(args.runId);
  if (!state) {
    return {
      success: false,
      error: `Run "${args.runId}" not found`,
    };
  }

  if (state.status !== 'running' && state.status !== 'pending') {
    return {
      success: false,
      error: `Run "${args.runId}" is not running (status: ${state.status})`,
    };
  }

  try {
    // Handle internal agent cancellation
    if (state.isInternal) {
      // The runId for internal agents is the sub-session ID format
      // Find the sub-session by looking for it in active sessions
      const cancelled = cancelSubSession(args.runId);
      if (cancelled) {
        state.status = 'cancelled';
        return {
          success: true,
          message: `Internal agent run "${args.runId}" cancelled`,
        };
      }
      // Sub-session not found or already completed - report failure
      // Don't mark local state as cancelled since sub-session cancellation failed
      return {
        success: false,
        error: `Failed to cancel internal agent run "${args.runId}": sub-session not found or already completed`,
      };
    }

    // For external agents, we can't really cancel mid-run but we can mark it
    state.status = 'cancelled';
    return {
      success: true,
      message: `Agent run "${args.runId}" marked as cancelled`,
      note: 'External agent tasks cannot be forcefully stopped mid-execution',
    };
  } catch (error) {
    logACPRouter('Error cancelling agent run:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get the current recursion depth for a session.
 * Useful for debugging and UI display.
 */
export function getCurrentSessionDepth(sessionId: string): number {
  return getSessionDepth(sessionId);
}
