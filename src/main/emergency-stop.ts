import { agentProcessManager, llmRequestAbortManager, state } from "./state"

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
  // Signal all consumers to stop ASAP
  state.shouldStopAgent = true

  // Abort any in-flight LLM HTTP requests
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

  // Reset core agent state flags (keep shouldStopAgent=true for agent loop visibility)
  state.isAgentModeActive = false
  state.agentIterationCount = 0

  return { before, after }
}

