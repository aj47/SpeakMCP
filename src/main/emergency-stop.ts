import { agentProcessManager, llmRequestAbortManager, state, agentSessionStateManager } from "./state"

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

  // Mark all active agent sessions as stopped in the tracker
  try {
    const { agentSessionTracker } = await import("./agent-session-tracker")
    const activeSessions = agentSessionTracker.getActiveSessions()
    for (const session of activeSessions) {
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

