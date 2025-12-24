/**
 * Internal Sub-Session Service
 * 
 * Allows SpeakMCP to spawn internal sub-sessions of itself as ACP-style agents.
 * Unlike external ACP agents, these run within the same process with isolated state.
 * 
 * Key features:
 * - Runs in the same process (platform-agnostic, no OS process spawning)
 * - Isolated conversation history per sub-session
 * - Access to the same MCP tools as the parent
 * - Configurable recursion depth limits to prevent infinite loops
 * - Progress updates flow to parent session
 */

import { v4 as uuidv4 } from 'uuid';
import { processTranscriptWithAgentMode } from '../llm';
import { mcpService } from '../mcp-service';
import { agentSessionStateManager } from '../state';
import { agentSessionTracker } from '../agent-session-tracker';
import { emitAgentProgress } from '../emit-agent-progress';
import type { AgentProgressUpdate, SessionProfileSnapshot } from '../../shared/types';
import type { MCPToolCall, MCPToolResult } from '../mcp-service';

const logSubSession = (...args: unknown[]) => {
  console.log(`[${new Date().toISOString()}] [InternalSubSession]`, ...args);
};

// ============================================================================
// Configuration & Limits
// ============================================================================

/** Maximum recursion depth for sub-sessions (prevents infinite loops) */
const MAX_RECURSION_DEPTH = 3;

/** Maximum concurrent sub-sessions per parent session */
const MAX_CONCURRENT_SUB_SESSIONS = 5;

/** Default max iterations for sub-session agent loops */
const DEFAULT_SUB_SESSION_MAX_ITERATIONS = 10;

// ============================================================================
// Sub-Session State Tracking
// ============================================================================

export interface InternalSubSession {
  /** Unique ID for this sub-session */
  id: string;
  /** Parent session ID that spawned this sub-session */
  parentSessionId: string;
  /** Current recursion depth (1 = first level sub-session) */
  depth: number;
  /** The task being executed */
  task: string;
  /** Current status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** Start timestamp */
  startTime: number;
  /** End timestamp (when completed/failed) */
  endTime?: number;
  /** Final result text */
  result?: string;
  /** Error message if failed */
  error?: string;
  /** Conversation history for this sub-session */
  conversationHistory: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
  }>;
}

/** Active sub-sessions indexed by their ID */
const activeSubSessions = new Map<string, InternalSubSession>();

/** Map parent session ID -> Set of child sub-session IDs */
const parentToChildren = new Map<string, Set<string>>();

/** Map sub-session ID -> recursion depth (includes parent chain) */
const sessionDepthMap = new Map<string, number>();

// ============================================================================
// Depth Tracking Helpers
// ============================================================================

/**
 * Get the recursion depth for a session.
 * Returns 0 for root sessions (no parent), 1+ for sub-sessions.
 */
export function getSessionDepth(sessionId: string): number {
  return sessionDepthMap.get(sessionId) ?? 0;
}

/**
 * Set the recursion depth for a session.
 */
export function setSessionDepth(sessionId: string, depth: number): void {
  sessionDepthMap.set(sessionId, depth);
}

/**
 * Check if we can spawn a sub-session from the given parent.
 * Returns an error message if not allowed, undefined if OK.
 */
export function canSpawnSubSession(parentSessionId: string): string | undefined {
  const parentDepth = getSessionDepth(parentSessionId);
  
  if (parentDepth >= MAX_RECURSION_DEPTH) {
    return `Maximum recursion depth (${MAX_RECURSION_DEPTH}) reached. Cannot spawn more sub-sessions.`;
  }
  
  const childrenCount = parentToChildren.get(parentSessionId)?.size ?? 0;
  if (childrenCount >= MAX_CONCURRENT_SUB_SESSIONS) {
    return `Maximum concurrent sub-sessions (${MAX_CONCURRENT_SUB_SESSIONS}) reached for this parent.`;
  }
  
  return undefined;
}

// ============================================================================
// Sub-Session Management
// ============================================================================

/**
 * Get all active sub-sessions for a parent session.
 */
export function getChildSubSessions(parentSessionId: string): InternalSubSession[] {
  const childIds = parentToChildren.get(parentSessionId);
  if (!childIds) return [];
  
  return Array.from(childIds)
    .map(id => activeSubSessions.get(id))
    .filter((s): s is InternalSubSession => s !== undefined);
}

/**
 * Get a sub-session by ID.
 */
export function getSubSession(subSessionId: string): InternalSubSession | undefined {
  return activeSubSessions.get(subSessionId);
}

/**
 * Clean up completed/failed sub-sessions that are older than the threshold.
 */
export function cleanupOldSubSessions(maxAgeMs: number = 30 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, session] of activeSubSessions) {
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
      if (session.endTime && (now - session.endTime) > maxAgeMs) {
        activeSubSessions.delete(id);
        sessionDepthMap.delete(id);
        const children = parentToChildren.get(session.parentSessionId);
        children?.delete(id);
        logSubSession(`Cleaned up old sub-session: ${id}`);
      }
    }
  }
}

// ============================================================================
// Sub-Session Execution
// ============================================================================

export interface RunSubSessionOptions {
  /** The task/prompt to execute in the sub-session */
  task: string;
  /** Optional additional context to prepend to the task */
  context?: string;
  /** Parent session ID (for tracking and depth calculation) */
  parentSessionId: string;
  /** Maximum agent iterations for this sub-session */
  maxIterations?: number;
  /** Profile snapshot to use (inherits from parent if not specified) */
  profileSnapshot?: SessionProfileSnapshot;
  /** Optional callback for progress updates */
  onProgress?: (update: AgentProgressUpdate) => void;
}

export interface SubSessionResult {
  success: boolean;
  subSessionId: string;
  result?: string;
  error?: string;
  conversationHistory: InternalSubSession['conversationHistory'];
  duration: number;
}

/**
 * Run an internal sub-session.
 * This creates an isolated agent session that runs within the same process.
 */
export async function runInternalSubSession(
  options: RunSubSessionOptions
): Promise<SubSessionResult> {
  const { task, context, parentSessionId, maxIterations, profileSnapshot, onProgress } = options;

  // Check if we can spawn
  const canSpawnError = canSpawnSubSession(parentSessionId);
  if (canSpawnError) {
    return {
      success: false,
      subSessionId: '',
      error: canSpawnError,
      conversationHistory: [],
      duration: 0,
    };
  }

  // Calculate depth
  const parentDepth = getSessionDepth(parentSessionId);
  const subSessionDepth = parentDepth + 1;

  // Generate sub-session ID
  const subSessionId = `subsession_${Date.now()}_${uuidv4().substring(0, 8)}`;

  // Create sub-session state
  const subSession: InternalSubSession = {
    id: subSessionId,
    parentSessionId,
    depth: subSessionDepth,
    task,
    status: 'pending',
    startTime: Date.now(),
    conversationHistory: [],
  };

  // Register sub-session
  activeSubSessions.set(subSessionId, subSession);
  setSessionDepth(subSessionId, subSessionDepth);

  // Track parent -> child relationship
  if (!parentToChildren.has(parentSessionId)) {
    parentToChildren.set(parentSessionId, new Set());
  }
  parentToChildren.get(parentSessionId)!.add(subSessionId);

  logSubSession(`Starting sub-session ${subSessionId} (depth: ${subSessionDepth}, parent: ${parentSessionId})`);

  // Get profile snapshot (inherit from parent if not provided)
  const effectiveProfileSnapshot = profileSnapshot
    ?? agentSessionStateManager.getSessionProfileSnapshot(parentSessionId)
    ?? agentSessionTracker.getSessionProfileSnapshot(parentSessionId);

  // Create isolated session state for this sub-session
  agentSessionStateManager.createSession(subSessionId, effectiveProfileSnapshot);

  // Format the full prompt
  const fullPrompt = context
    ? `Context: ${context}\n\nTask: ${task}`
    : task;

  // Add user message to conversation history
  subSession.conversationHistory.push({
    role: 'user',
    content: fullPrompt,
    timestamp: Date.now(),
  });

  subSession.status = 'running';

  try {
    // Get available tools - use profile-filtered tools if we have a profile snapshot
    const availableTools = effectiveProfileSnapshot?.mcpServerConfig
      ? mcpService.getAvailableToolsForProfile(effectiveProfileSnapshot.mcpServerConfig)
      : mcpService.getAvailableTools();

    // Create tool executor that respects session isolation
    const executeToolCall = async (
      toolCall: MCPToolCall,
      toolOnProgress?: (message: string) => void
    ): Promise<MCPToolResult> => {
      // Check if session should stop
      if (agentSessionStateManager.shouldStopSession(subSessionId)) {
        return {
          content: [{ type: 'text', text: 'Sub-session was stopped.' }],
          isError: true,
        };
      }

      // Execute the tool via MCP service
      // Use executeToolCall which handles routing to correct server based on tool name
      const result = await mcpService.executeToolCall(
        toolCall,
        toolOnProgress,
        false, // skipApprovalCheck
        subSessionId,
        effectiveProfileSnapshot?.mcpServerConfig
      );

      return result;
    };

    // Sub-session progress handler
    const subSessionOnProgress = (update: AgentProgressUpdate) => {
      // Tag progress as coming from a sub-session
      const taggedUpdate: AgentProgressUpdate = {
        ...update,
        sessionId: subSessionId,
        // Could add metadata about parent session here
      };

      // Forward to caller's progress callback
      onProgress?.(taggedUpdate);

      // Also emit to UI (snoozed by default for sub-sessions)
      emitAgentProgress(taggedUpdate).catch(() => {});
    };

    // Run the agent loop in the sub-session
    const result = await processTranscriptWithAgentMode(
      fullPrompt,
      availableTools,
      executeToolCall,
      maxIterations ?? DEFAULT_SUB_SESSION_MAX_ITERATIONS,
      undefined, // No previous conversation history for sub-session
      undefined, // No conversation ID for sub-session (isolated)
      subSessionId,
      subSessionOnProgress,
      effectiveProfileSnapshot
    );

    // Update sub-session state
    subSession.status = 'completed';
    subSession.endTime = Date.now();
    subSession.result = result.content;

    // Add assistant message to conversation history
    subSession.conversationHistory.push({
      role: 'assistant',
      content: result.content,
      timestamp: Date.now(),
    });

    logSubSession(`Sub-session ${subSessionId} completed successfully`);

    return {
      success: true,
      subSessionId,
      result: result.content,
      conversationHistory: subSession.conversationHistory,
      duration: Date.now() - subSession.startTime,
    };

  } catch (error) {
    subSession.status = 'failed';
    subSession.endTime = Date.now();
    subSession.error = error instanceof Error ? error.message : String(error);

    logSubSession(`Sub-session ${subSessionId} failed:`, error);

    return {
      success: false,
      subSessionId,
      error: subSession.error,
      conversationHistory: subSession.conversationHistory,
      duration: Date.now() - subSession.startTime,
    };

  } finally {
    // Clean up session state
    agentSessionStateManager.cleanupSession(subSessionId);
  }
}

/**
 * Cancel a running sub-session.
 */
export function cancelSubSession(subSessionId: string): boolean {
  const subSession = activeSubSessions.get(subSessionId);
  if (!subSession || subSession.status !== 'running') {
    return false;
  }

  // Signal the session to stop
  agentSessionStateManager.stopSession(subSessionId);

  subSession.status = 'cancelled';
  subSession.endTime = Date.now();

  logSubSession(`Sub-session ${subSessionId} cancelled`);
  return true;
}

/**
 * Get the internal agent definition for use in tool listings.
 */
export function getInternalAgentInfo() {
  return {
    name: 'speakmcp-internal',
    displayName: 'SpeakMCP Internal Sub-Agent',
    description: 'An internal sub-session of SpeakMCP itself. Can perform any task the main agent can, with access to all configured MCP tools. Useful for parallel task execution or isolating complex sub-tasks.',
    capabilities: ['general', 'research', 'coding', 'analysis', 'writing', 'tools'],
    isInternal: true,
    maxRecursionDepth: MAX_RECURSION_DEPTH,
    maxConcurrent: MAX_CONCURRENT_SUB_SESSIONS,
  };
}

