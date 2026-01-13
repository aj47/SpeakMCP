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
  generateSubSessionId,
} from './internal-agent';
import { agentProfileService } from '../agent-profile-service';
import type { AgentProfile } from '../../shared/types';

// ============================================================================
// Consolidated Delegation State
// ============================================================================

/**
 * Extended state for tracking delegated runs.
 * Consolidates ACPSubAgentState with conversation history and emit timing.
 */
interface DelegatedRun extends ACPSubAgentState {
  /** Conversation messages for this run */
  conversation: ACPSubAgentMessage[];
  /** Last time we emitted a progress update to the UI (for rate limiting) */
  lastEmitTime: number;
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
  // Remove runId from the agentName → runIds set
  const activeRunIds = agentNameToActiveRunIds.get(agentName);
  if (activeRunIds) {
    activeRunIds.delete(runId);
    // Clean up empty sets to prevent memory accumulation
    if (activeRunIds.size === 0) {
      agentNameToActiveRunIds.delete(agentName);
    }
  }

  // Remove any sessionId → runId mappings pointing at this run.
  for (const [sessionId, mappedRunId] of sessionToRunId.entries()) {
    if (mappedRunId === runId) {
      sessionToRunId.delete(sessionId);
    }
  }
}

// ============================================================================
// Shared Delegation Helpers
// ============================================================================

/** Arguments for creating a sub-agent state */
interface CreateSubAgentStateArgs {
  agentName: string;
  task: string;
  parentSessionId: string;
  isInternal?: boolean;
}

/**
 * Create and register a new sub-agent state for tracking delegated runs.
 * Initializes conversation with the user's task message.
 */
function createSubAgentState(args: CreateSubAgentStateArgs): DelegatedRun {
  const runId = generateDelegationRunId();
  const now = Date.now();
  const userMessage: ACPSubAgentMessage = {
    role: 'user',
    content: args.task,
    timestamp: now,
  };
  const delegatedRun: DelegatedRun = {
    runId,
    agentName: args.agentName,
    parentSessionId: args.parentSessionId,
    task: args.task,
    status: 'pending',
    startTime: now,
    isInternal: args.isInternal,
    conversation: [userMessage],
    lastEmitTime: 0,
  };
  delegatedRuns.set(runId, delegatedRun);
  return delegatedRun;
}

/**
 * Result type for delegation operations.
 */
interface DelegationResult {
  success: boolean;
  runId: string;
  agentName: string;
  status: 'completed' | 'failed' | 'running' | 'cancelled';
  output?: string;
  error?: string;
  duration?: number;
  conversation?: ACPSubAgentMessage[];
  message?: string;
  note?: string;
}

/**
 * Create a completed delegation result.
 */
function createCompletedResult(
  subAgentState: DelegatedRun,
  output: string,
  conversation: ACPSubAgentMessage[]
): DelegationResult {
  subAgentState.status = 'completed';
  return {
    success: true,
    runId: subAgentState.runId,
    agentName: subAgentState.agentName,
    status: 'completed',
    output,
    duration: Date.now() - subAgentState.startTime,
    conversation,
  };
}

/**
 * Create a failed delegation result.
 */
function createFailedResult(
  subAgentState: DelegatedRun,
  error: string,
  conversation?: ACPSubAgentMessage[]
): DelegationResult {
  subAgentState.status = 'failed';
  return {
    success: false,
    runId: subAgentState.runId,
    agentName: subAgentState.agentName,
    status: 'failed',
    error,
    duration: Date.now() - subAgentState.startTime,
    conversation,
  };
}

/**
 * Create an async running delegation result (for waitForResult=false).
 */
function createRunningResult(subAgentState: DelegatedRun): DelegationResult {
  return {
    success: true,
    runId: subAgentState.runId,
    agentName: subAgentState.agentName,
    status: 'running',
    message: `Task delegated to "${subAgentState.agentName}". Use check_agent_status with runId "${subAgentState.runId}" to check progress.`,
  };
}

/**
 * Register agent name to run ID mapping for session update fallback.
 */
function registerAgentRunMapping(agentName: string, runId: string): void {
  let activeRunIds = agentNameToActiveRunIds.get(agentName);
  if (!activeRunIds) {
    activeRunIds = new Set();
    agentNameToActiveRunIds.set(agentName, activeRunIds);
  }
  activeRunIds.add(runId);
}

/**
 * Track delegated sub-agent runs for status checking.
 * Consolidates run state, conversation history, and emit timing.
 */
const delegatedRuns: Map<string, DelegatedRun> = new Map();

/** Map from agent session IDs to our delegation run IDs (needed for stdio agent session mapping) */
const sessionToRunId: Map<string, string> = new Map();

/**
 * Map from agent names to their currently active run IDs (for session mapping fallback).
 * Uses a Set to support parallel delegations to the same agent.
 */
const agentNameToActiveRunIds: Map<string, Set<string>> = new Map();

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
 * Safely stringify a value to JSON, catching errors from circular structures or BigInt.
 * Returns a fallback string if serialization fails.
 */
function safeJsonStringify(value: unknown, indent?: number): string {
  try {
    return JSON.stringify(value, null, indent);
  } catch {
    // Handle circular references, BigInt, or other non-serializable values
    return '[Unable to serialize value]';
  }
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

  // Find the run ID for this session
  const mappedRunId = sessionToRunId.get(sessionId);
  let runId = mappedRunId;

  // If no session mapping exists, try to find by agent name (fallback for race condition)
  // Note: With parallel delegations, we pick one of the active runs. This is best-effort
  // since we can't determine which run a session belongs to without the session ID mapping.
  if (!runId) {
    const activeRunIds = agentNameToActiveRunIds.get(agentName);
    const activeRunId = activeRunIds?.values().next().value;
    if (activeRunId) {
      // Establish the session mapping now that we have both IDs
      sessionToRunId.set(sessionId, activeRunId);
      runId = activeRunId;
    } else {
      return;
    }
  }

  let subAgentState = delegatedRuns.get(runId);
  if (!subAgentState) {
    // If we got a runId from session mapping but can't find state, the mapping is stale.
    // Clean it up and retry via agent-name fallback (fixes misrouting/dropping later updates).
    if (mappedRunId) {
      sessionToRunId.delete(sessionId);
      // Remove the stale runId from the agent's active runs set
      const activeRunIds = agentNameToActiveRunIds.get(agentName);
      if (activeRunIds) {
        activeRunIds.delete(mappedRunId);
        if (activeRunIds.size === 0) {
          agentNameToActiveRunIds.delete(agentName);
        }
      }

      // Try to find another active run for this agent
      const remainingRunIds = agentNameToActiveRunIds.get(agentName);
      const activeRunId = remainingRunIds?.values().next().value;
      if (!activeRunId) {
        return;
      }

      sessionToRunId.set(sessionId, activeRunId);
      runId = activeRunId;
      subAgentState = delegatedRuns.get(runId);
      if (!subAgentState) {
        return;
      }
    } else {
      return;
    }
  }

  // Use conversation from consolidated state
  const conversation = subAgentState.conversation;

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
          message.content += `\nInput: ${truncateContent(safeJsonStringify(block.input, 2), 500)}`;
        }
        conversation.push(message);
      } else if (block.type === 'tool_result') {
        message.role = 'tool';
        const resultStr = typeof block.result === 'string' ? block.result : safeJsonStringify(block.result);
        message.content = `Tool result: ${truncateContent(resultStr, 500)}`;
        conversation.push(message);
      }
    }
  }

  // Enforce conversation size limit (keep most recent messages)
  if (conversation.length > MAX_CONVERSATION_MESSAGES * 2) {
    subAgentState.conversation = conversation.slice(-MAX_CONVERSATION_MESSAGES);
  }

  // Rate limiting: skip emit if we recently emitted (unless complete)
  const now = Date.now();
  if (!isComplete && now - subAgentState.lastEmitTime < MIN_EMIT_INTERVAL_MS) {
    return;
  }
  subAgentState.lastEmitTime = now;

  // Build delegation progress with size-limited conversation
  const delegationProgress: ACPDelegationProgress = {
    runId: subAgentState.runId,
    agentName: subAgentState.agentName,
    task: subAgentState.task,
    status: isComplete ? 'completed' : 'running',
    startTime: subAgentState.startTime,
    endTime: isComplete ? Date.now() : undefined,
    progressMessage: stopReason ? `Stop reason: ${stopReason}` : undefined,
    conversation: prepareConversationForUI(subAgentState.conversation),
  };

  // Emit progress update to UI
  // IMPORTANT: isComplete is always false because this is a delegation progress update,
  // not a completion of the parent session. The parent session continues running after
  // the delegation completes. Setting isComplete: true here would incorrectly mark the
  // parent session as done in the UI while the main agent is still processing.
  emitAgentProgress({
    sessionId: subAgentState.parentSessionId,
    currentIteration: 0,
    maxIterations: 1,
    isComplete: false,
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
  }).catch(() => {
    // Ignore emit errors
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
 * Also includes enabled personas as available agents for delegation.
 * @param args - Arguments containing optional capability filter
 * @returns Object with list of available agents
 */
export async function handleListAvailableAgents(args: {
  capability?: string;
}): Promise<object> {
  try {
    // Get all enabled agent targets from the unified agent profile service
    let agentTargets = agentProfileService.getEnabledAgentTargets();

    // If capability filter is provided, filter by it
    if (args.capability) {
      agentTargets = agentTargets.filter(
        (agent) => agent.capabilities?.includes(args.capability!) ?? false
      );
    }

    // Get runtime status from acpService (for external agents)
    const agentStatuses = acpService.getAgents();
    const statusMap = new Map(
      agentStatuses.map((a) => [a.config.name, { status: a.status, error: a.error }])
    );

    // Format agents for output
    const formattedAgents = agentTargets.map((agent) => {
      // Internal agents are always ready
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
          isAgentProfile: true,
        };
      }

      // External agents (acp, stdio, remote) - check runtime status
      const runtime = statusMap.get(agent.name);
      return {
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description || '',
        capabilities: agent.capabilities || [],
        connectionType: agent.connection.type,
        status: runtime?.status || (agent.connection.type === 'remote' ? 'ready' : 'stopped'),
        error: runtime?.error,
        isInternal: false,
        isAgentProfile: true,
      };
    });

    const agentTargetNames = new Set(agentTargets.map((a) => a.name));

    // BACKWARD COMPATIBILITY: Also include legacy ACP agents from config
    const config = configStore.get();
    const legacyAcpAgents = (config.acpAgents || []).filter(
      (a) => a.name !== 'internal' && !agentTargetNames.has(a.name)
    );

    // Filter legacy ACP agents by capability if specified
    let filteredLegacyAcpAgents = legacyAcpAgents;
    if (args.capability) {
      filteredLegacyAcpAgents = legacyAcpAgents.filter(
        (agent) => agent.capabilities?.includes(args.capability!) ?? false
      );
    }

    const formattedLegacyAcpAgents = filteredLegacyAcpAgents
      .filter((agent) => agent.enabled !== false)
      .map((agent) => {
        const runtime = statusMap.get(agent.name);
        return {
          name: agent.name,
          displayName: agent.displayName,
          description: agent.description || '',
          capabilities: agent.capabilities || [],
          connectionType: agent.connection.type,
          status: runtime?.status || 'stopped',
          error: runtime?.error,
          isInternal: agent.connection.type === 'internal',
          isLegacy: true,
        };
      });

    // Combine all agents
    const allAgents = [
      ...formattedAgents,
      ...formattedLegacyAcpAgents,
    ];

    return {
      success: true,
      agents: allAgents,
      count: allAgents.length,
      filter: args.capability || null,
    };
  } catch (error) {
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
 * Uses the unified AgentProfile system for agent lookup and routing.
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
  const waitForResult = args.waitForResult !== false; // Default to true

  // Try unified agent profile lookup first
  const profile = agentProfileService.getByName(args.agentName);
  if (profile) {
    // Check if agent is enabled
    if (!profile.enabled) {
      return {
        success: false,
        error: `Agent "${args.agentName}" is currently disabled.`,
      };
    }

    // Route based on connection type using the unified profile
    return executeAgentProfileDelegation(profile, args, parentSessionId, waitForResult);
  }

  // BACKWARD COMPATIBILITY: Handle explicit 'internal' agent name
  if (args.agentName === 'internal') {
    return executeInternalAgent(args, parentSessionId, waitForResult);
  }

  // BACKWARD COMPATIBILITY: Fall back to legacy ACP agent lookup from config
  return executeACPAgent(args, parentSessionId, waitForResult);
}

/**
 * Execute delegation based on unified AgentProfile.
 * Routes to appropriate execution method based on connection type.
 */
async function executeAgentProfileDelegation(
  profile: AgentProfile,
  args: { agentName: string; task: string; context?: string },
  parentSessionId: string | undefined,
  waitForResult: boolean
): Promise<object> {
  switch (profile.connection.type) {
    case 'internal':
      // Use internal agent with profile's config
      // Pass profile name as personaName so it can use the profile's configuration
      return executeInternalAgent(
        { ...args, personaName: profile.name },
        parentSessionId,
        waitForResult
      );

    case 'acp':
    case 'stdio':
      // Add profile context (system prompt, guidelines) to the task context
      const profileContext = buildProfileContext(profile, args.context);
      return executeACPAgent(
        { ...args, context: profileContext },
        parentSessionId,
        waitForResult
      );

    case 'remote':
      // Remote HTTP endpoint - add profile context
      const remoteContext = buildProfileContext(profile, args.context);
      return executeACPAgent(
        { ...args, context: remoteContext },
        parentSessionId,
        waitForResult
      );

    default:
      return {
        success: false,
        error: `Unsupported connection type for agent "${profile.name}": ${profile.connection.type}`,
      };
  }
}

/**
 * Build context string from agent profile, optionally combining with existing context.
 */
function buildProfileContext(profile: AgentProfile, existingContext?: string): string {
  const parts: (string | null | undefined)[] = [
    existingContext,
    `[Acting as: ${profile.displayName}]`,
    profile.systemPrompt ? `System Prompt: ${profile.systemPrompt}` : null,
    profile.guidelines ? `Guidelines: ${profile.guidelines}` : null,
  ];
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Execute delegation to the internal agent.
 * Uses the internal sub-session system with unified tracking.
 * Can optionally run as a specific persona when personaName is provided.
 */
async function executeInternalAgent(
  args: { task: string; context?: string; personaName?: string },
  parentSessionId: string | undefined,
  waitForResult: boolean
): Promise<object> {
  // Check if internal agent is enabled
  const internalConfig = getInternalAgentConfig();
  if (internalConfig.enabled === false) {
    return { success: false, error: 'Internal agent is disabled' };
  }

  if (!parentSessionId) {
    return { success: false, error: 'Parent session ID is required for internal agent delegation' };
  }

  // Use persona name for agent identification if provided, otherwise 'internal'
  const agentName = args.personaName || 'internal';

  // Create unified sub-agent state (conversation initialized automatically)
  const subAgentState = createSubAgentState({
    agentName,
    task: args.task,
    parentSessionId,
    isInternal: true,
  });
  subAgentState.status = 'running';

  // Pre-generate sub-session ID and store it BEFORE starting execution.
  // This enables cancel_agent_run to work for in-flight internal tasks.
  const preGeneratedSubSessionId = generateSubSessionId();
  subAgentState.subSessionId = preGeneratedSubSessionId;

  // Internal agent always executes synchronously
  // waitForResult is ignored for internal agent (always waits)
  try {
    const result = await runInternalSubSession({
      task: args.task,
      context: args.context,
      parentSessionId,
      subSessionId: preGeneratedSubSessionId,
      personaName: args.personaName,
    });

    // Update conversation history in consolidated state
    subAgentState.conversation = result.conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }));

    if (result.success) {
      return createCompletedResult(subAgentState, result.result || '', subAgentState.conversation);
    } else {
      return createFailedResult(subAgentState, result.error || 'Unknown error', subAgentState.conversation);
    }
  } catch (error) {
    return createFailedResult(subAgentState, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Execute delegation to an external ACP agent (stdio or remote).
 * Handles both synchronous and asynchronous execution modes.
 */
async function executeACPAgent(
  args: { agentName: string; task: string; context?: string },
  parentSessionId: string | undefined,
  waitForResult: boolean
): Promise<object> {
  try {
    // Check if agent exists in config
    const config = configStore.get();
    const agentConfig = config.acpAgents?.find((a) => a.name === args.agentName);
    if (!agentConfig) {
      return { success: false, error: `Agent "${args.agentName}" not found in configuration` };
    }

    if (agentConfig.enabled === false) {
      return { success: false, error: `Agent "${args.agentName}" is disabled` };
    }

    // Ensure stdio agents are spawned
    if (agentConfig.connection.type === 'stdio') {
      const agentStatus = acpService.getAgentStatus(args.agentName);
      if (agentStatus?.status !== 'ready') {
        try {
          await acpService.spawnAgent(args.agentName);
        } catch (spawnError) {
          return {
            success: false,
            error: `Failed to spawn agent "${args.agentName}": ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
          };
        }
      }
    }

    // Create unified sub-agent state (conversation initialized automatically)
    const subAgentState = createSubAgentState({
      agentName: args.agentName,
      task: args.task,
      parentSessionId: parentSessionId || `orphaned-${Date.now()}`,
    });
    subAgentState.status = 'running';
    registerAgentRunMapping(args.agentName, subAgentState.runId);

    // Helper to register session mapping
    const registerSessionMapping = () => {
      const sessionId = acpService.getAgentSessionId(args.agentName);
      if (sessionId) {
        sessionToRunId.set(sessionId, subAgentState.runId);
      }
    };

    if (waitForResult) {
      return executeACPAgentSync(subAgentState, args, registerSessionMapping);
    } else {
      return executeACPAgentAsync(subAgentState, args, agentConfig, parentSessionId, registerSessionMapping);
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute synchronous ACP agent delegation.
 */
async function executeACPAgentSync(
  subAgentState: DelegatedRun,
  args: { agentName: string; task: string; context?: string },
  registerSessionMapping: () => void
): Promise<object> {
  try {
    registerSessionMapping();

    const result = await acpService.runTask({
      agentName: args.agentName,
      input: args.task,
      context: args.context,
      mode: 'sync',
    });

    registerSessionMapping();

    // Add final assistant message if we got a result
    if (result.result) {
      subAgentState.conversation.push({
        role: 'assistant',
        content: result.result,
        timestamp: Date.now(),
      });
    }

    // Note: Don't cleanup delegation mappings here - the sessionUpdate handler
    // will clean up when isComplete arrives. Early cleanup can cause late
    // session/update notifications to be dropped/misrouted.

    if (result.success) {
      return createCompletedResult(subAgentState, result.result || '', subAgentState.conversation);
    } else {
      return createFailedResult(subAgentState, result.error || 'Unknown error', subAgentState.conversation);
    }
  } catch (error) {
    // Note: Don't cleanup delegation mappings here - the sessionUpdate handler
    // will clean up when isComplete arrives. Early cleanup can cause late
    // session/update notifications to be dropped/misrouted.
    throw error;
  }
}

/**
 * Execute asynchronous ACP agent delegation.
 */
function executeACPAgentAsync(
  subAgentState: DelegatedRun,
  args: { agentName: string; task: string; context?: string },
  agentConfig: NonNullable<ReturnType<typeof configStore.get>['acpAgents']>[number],
  parentSessionId: string | undefined,
  registerSessionMapping: () => void
): DelegationResult {
  // Start background polling for notifications
  acpBackgroundNotifier.startPolling();

  if (agentConfig.connection.type === 'remote' && agentConfig.connection.baseUrl) {
    executeRemoteAgentAsync(subAgentState, args, agentConfig.connection.baseUrl, parentSessionId);
  } else if (agentConfig.connection.type === 'remote') {
    // Remote agent without baseUrl is a configuration error
    subAgentState.status = 'failed';
    return createFailedResult(subAgentState, `Remote agent "${args.agentName}" has no baseUrl configured`);
  } else {
    executeStdioAgentAsync(subAgentState, args, registerSessionMapping);
  }

  return createRunningResult(subAgentState);
}

/**
 * Execute async remote HTTP agent delegation (fire-and-forget).
 */
function executeRemoteAgentAsync(
  subAgentState: DelegatedRun,
  args: { agentName: string; task: string },
  baseUrl: string,
  parentSessionId: string | undefined
): void {
  subAgentState.baseUrl = baseUrl;

  acpClientService.runAgentAsync({
    agentName: args.agentName,
    input: args.task,
    mode: 'async',
    parentSessionId,
  }).then(
    (acpRunId) => {
      subAgentState.acpRunId = acpRunId;
    },
    (error) => {
      finalizeAsyncRunWithError(subAgentState, args.agentName, error);
    }
  );
}

/**
 * Execute async stdio agent delegation (fire-and-forget).
 */
function executeStdioAgentAsync(
  subAgentState: DelegatedRun,
  args: { agentName: string; task: string; context?: string },
  registerSessionMapping: () => void
): void {
  acpService.runTask({
    agentName: args.agentName,
    input: args.task,
    context: args.context,
    mode: 'async',
  }).then(
    (result) => {
      registerSessionMapping();
      const endTime = Date.now();

      if (result.success) {
        subAgentState.status = 'completed';
        subAgentState.result = {
          runId: subAgentState.runId,
          agentName: args.agentName,
          status: 'completed',
          startTime: subAgentState.startTime,
          endTime,
          metadata: { duration: endTime - subAgentState.startTime },
          output: [{ role: 'assistant', parts: [{ content: result.result || '' }] }],
        };
      } else {
        subAgentState.status = 'failed';
        subAgentState.result = {
          runId: subAgentState.runId,
          agentName: args.agentName,
          status: 'failed',
          startTime: subAgentState.startTime,
          endTime,
          metadata: { duration: endTime - subAgentState.startTime },
          error: result.error || 'Unknown error',
        };
      }
      // Note: Don't cleanup delegation mappings here - the sessionUpdate handler
      // will clean up when isComplete arrives. Early cleanup can cause late
      // session/update notifications to be dropped/misrouted.
    },
    (error) => {
      finalizeAsyncRunWithError(subAgentState, args.agentName, error);
    }
  );
}

/**
 * Finalize an async run that failed with an error.
 */
function finalizeAsyncRunWithError(
  subAgentState: DelegatedRun,
  agentName: string,
  error: unknown
): void {
  subAgentState.status = 'failed';
  const endTime = Date.now();
  subAgentState.result = {
    runId: subAgentState.runId,
    agentName,
    status: 'failed',
    startTime: subAgentState.startTime,
    endTime,
    metadata: { duration: endTime - subAgentState.startTime },
    error: error instanceof Error ? error.message : String(error),
  };
  // Note: Don't cleanup delegation mappings here - the sessionUpdate handler
  // will clean up when isComplete arrives. Early cleanup can cause late
  // session/update notifications to be dropped/misrouted.
}


/**
 * Check the status of a running delegated agent task.
 * @param args - Arguments containing the run ID and optional history length
 * @returns Object with current status of the run
 */
export async function handleCheckAgentStatus(args: { runId: string; historyLength?: number }): Promise<object> {
  try {
    const subAgentState = delegatedRuns.get(args.runId);

    if (!subAgentState) {
      return {
        success: false,
        error: `Run "${args.runId}" not found. It may have expired or never existed.`,
      };
    }

    // Query remote server for actual status if we have tracking info and the task is still running
    if (subAgentState.acpRunId && subAgentState.baseUrl && subAgentState.status === 'running') {
      try {
        // ACP protocol: Use ACP client to query run status
        const acpResult = await acpClientService.getRunStatus(
          subAgentState.baseUrl,
          subAgentState.acpRunId
        );

        // Update local state based on ACP server response for terminal states
        if (acpResult.status === 'completed' || acpResult.status === 'failed' || acpResult.status === 'cancelled') {
          subAgentState.status = acpResult.status;
          subAgentState.result = acpResult;
        }
        // If still running, keep local status as 'running'
      } catch {
        // Continue with local state if query fails
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
  // Resolve alias tool names to their canonical handlers
  const resolvedToolName = resolveToolName(toolName);

  try {
    let result: object;

    switch (resolvedToolName) {
      case 'speakmcp-builtin:list_available_agents':
        result = await handleListAvailableAgents(args as { capability?: string; skillName?: string });
        break;

      case 'speakmcp-builtin:delegate_to_agent':
        // Handle both 'runId' and 'taskId' terminology
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
        // Handle both 'runId' and 'taskId' parameter names
        const statusArgs = args as { runId?: string; taskId?: string; historyLength?: number };
        const statusRunId = statusArgs.runId || statusArgs.taskId;
        if (!statusRunId) {
          result = {
            success: false,
            error: 'Missing required parameter: runId or taskId must be provided',
          };
        } else {
          result = await handleCheckAgentStatus({ 
            runId: statusRunId,
            historyLength: statusArgs.historyLength,
          });
        }
        break;

      case 'speakmcp-builtin:spawn_agent':
        result = await handleSpawnAgent(args as { agentName: string });
        break;

      case 'speakmcp-builtin:stop_agent':
        result = await handleStopAgent(args as { agentName: string });
        break;

      case 'speakmcp-builtin:cancel_agent_run':
        // Handle both 'runId' and 'taskId' parameter names
        const cancelArgs = args as { runId?: string; taskId?: string };
        const cancelRunId = cancelArgs.runId || cancelArgs.taskId;
        if (!cancelRunId) {
          result = {
            success: false,
            error: 'Missing required parameter: runId or taskId must be provided',
          };
        } else {
          result = await handleCancelAgentRun({ 
            runId: cancelRunId 
          });
        }
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
 * Includes both canonical names and aliases.
 * @param toolName - The tool name to check
 * @returns True if the tool is an ACP router tool
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

  return {
    runId: state.runId,
    agentName: state.agentName,
    task: state.task,
    status: state.status,
    startTime: state.startTime,
    // Use stored endTime from result if available, otherwise undefined for in-progress runs
    endTime: state.result?.endTime,
    progressMessage: state.progress,
    resultSummary: state.result?.output?.[0]?.parts?.[0]?.content?.substring(0, 200),
    error: state.result?.error,
    conversation: [...state.conversation],
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
  }
}

// ============================================================================
// Cancellation Support
// ============================================================================

/**
 * Cancel a running agent task (internal or external).
 * @param args - Arguments containing the run ID
 * @returns Object with cancellation result
 */
export async function handleCancelAgentRun(args: { runId: string }): Promise<object> {
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
      // Use the stored subSessionId for cancellation (this is the actual internal sub-session ID,
      // whereas state.runId is the delegation tracking ID 'acp_delegation_*')
      const subSessionId = state.subSessionId;
      if (!subSessionId) {
        return {
          success: false,
          error: `Failed to cancel internal agent run "${args.runId}": sub-session ID not found (task may have completed before cancellation was attempted)`,
        };
      }
      const cancelled = cancelSubSession(subSessionId);
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
