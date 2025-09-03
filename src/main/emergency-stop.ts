import { agentProcessManager, llmRequestAbortManager, state } from "./state"
import { mcpService } from "./mcp-service"

/**
 * Centralized emergency stop: abort LLM requests, stop MCP servers,
 * kill tracked child processes, and reset agent state.
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

  // Stop all MCP server processes (stdio/ws/http transports)
  try {
    mcpService.emergencyStopAllProcesses()
  } catch {
    // ignore
  }

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

