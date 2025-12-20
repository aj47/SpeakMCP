import { agentProcessManager, llmRequestAbortManager, state, agentSessionStateManager, toolApprovalManager } from "./state"
import { emitAgentProgress } from "./emit-agent-progress"

/**
 * Centralized emergency stop: abort LLM requests, kill tracked child processes,
 * and reset agent state.
 *
 * NOTE: This does NOT stop MCP servers - they are persistent infrastructure
 * that should remain running across agent mode sessions.
 *
 * Returns before/after counts for logging.
 */
export async function emergencyStopAll(): Promise<{ before: number; after: number }> {
  // Signal all sessions to stop ASAP (both new session-based and legacy global)
  agentSessionStateManager.stopAllSessions()

  // Mark all active agent sessions as stopped in the tracker and emit progress updates
  try {
    const { agentSessionTracker } = await import("./agent-session-tracker")
    const activeSessions = agentSessionTracker.getActiveSessions()
    for (const session of activeSessions) {
      // Cancel any pending tool approvals for this session
      toolApprovalManager.cancelSessionApprovals(session.id)

      // Emit a final progress update so the UI shows "Stopped" state
      // This allows users to see the stopped state and send follow-up messages
      // Note: pendingToolApproval is explicitly set to undefined to clear any stale
      // approval bubble from the UI since updateSessionProgress preserves fields not
      // present in the update (spreads existing state)
      await emitAgentProgress({
        sessionId: session.id,
        conversationId: session.conversationId,
        conversationTitle: session.conversationTitle,
        currentIteration: 0,
        maxIterations: 0,
        steps: [
          {
            id: `stop_${Date.now()}`,
            type: "completion",
            title: "Agent stopped",
            description: "Agent mode was stopped by emergency kill switch",
            status: "error",
            timestamp: Date.now(),
          },
        ],
        isComplete: true,
        finalContent: "(Agent mode was stopped by emergency kill switch)",
        conversationHistory: [],
        pendingToolApproval: undefined,
      })

      // Mark the session as stopped in the tracker
      agentSessionTracker.stopSession(session.id)
    }
  } catch {
    // ignore
  }

  // Abort any in-flight LLM HTTP requests (handled by session state manager)
  // This is already done in stopAllSessions(), but we keep the legacy call for safety
  try {
    llmRequestAbortManager.abortAll()
  } catch {
    // ignore
  }

  // NOTE: We do NOT stop MCP servers here - they are persistent infrastructure
  // that should remain running. Only agent-spawned child processes are killed.

  const before = agentProcessManager.getActiveProcessCount()

  // Kill all tracked child processes immediately
  try {
    agentProcessManager.emergencyStop()
  } catch {
    // ignore
  }

  const after = agentProcessManager.getActiveProcessCount()

  // Clean up all session states
  for (const [sessionId] of state.agentSessions) {
    agentSessionStateManager.cleanupSession(sessionId)
  }

  // Reset some core agent state flags for clean state
  // NOTE: We intentionally do NOT reset state.shouldStopAgent here!
  // It should remain true to block any late/in-flight progress updates that may
  // arrive after cleanup. It will be reset to false when a new session is created.
  // This prevents a race condition where stray updates slip through after emergency stop.
  state.isAgentModeActive = false
  state.agentIterationCount = 0

  return { before, after }
}

