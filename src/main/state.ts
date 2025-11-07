import { ChildProcess } from "child_process"

// Per-session agent state
interface AgentSessionState {
  sessionId: string
  shouldStop: boolean
  iterationCount: number
  abortControllers: Set<AbortController>
  processes: Set<ChildProcess>
}

export const state = {
  isRecording: false,
  isTextInputActive: false,
  focusedAppBeforeRecording: null as string | null,
  // Toggle voice dictation state
  isToggleRecordingActive: false,
  // Agent mode state - legacy global flags (kept for backward compatibility)
  isAgentModeActive: false,
  agentProcesses: new Set<ChildProcess>(),
  shouldStopAgent: false,
  agentIterationCount: 0,
  // Track in-flight LLM abort controllers - legacy global (kept for backward compatibility)
  llmAbortControllers: new Set<AbortController>(),
  // Per-session agent state (new approach for multi-session support)
  agentSessions: new Map<string, AgentSessionState>(),
}

// Process management for agent mode
export const agentProcessManager = {
  // Register a process created during agent mode
  registerProcess(process: ChildProcess) {
    state.agentProcesses.add(process)

    // Clean up when process exits
    process.on("exit", (_code, _signal) => {
      state.agentProcesses.delete(process)
    })

    process.on("error", (_error) => {
      state.agentProcesses.delete(process)
    })
  },

  // Kill all agent processes gracefully
  async killAllProcesses(): Promise<void> {
    const processes = Array.from(state.agentProcesses)
    const killPromises: Promise<void>[] = []

    for (const process of processes) {
      killPromises.push(
        new Promise<void>((resolve) => {
          if (process.killed || process.exitCode !== null) {
            resolve()
            return
          }

          // Try graceful shutdown first
          process.kill("SIGTERM")

          // Force kill after timeout
          const forceKillTimeout = setTimeout(() => {
            if (!process.killed && process.exitCode === null) {
              process.kill("SIGKILL")
            }
            resolve()
          }, 3000) // 3 second timeout

          process.on("exit", () => {
            clearTimeout(forceKillTimeout)
            resolve()
          })
        }),
      )
    }

    await Promise.all(killPromises)
    state.agentProcesses.clear()
  },

  // Emergency stop - immediately kill all processes
  emergencyStop(): void {
    for (const process of state.agentProcesses) {
      try {
        if (!process.killed && process.exitCode === null) {
          process.kill("SIGKILL")
        }
      } catch (error) {
        // Ignore errors during emergency stop
      }
    }
    state.agentProcesses.clear()
  },

  // Get count of active processes
  getActiveProcessCount(): number {
    return state.agentProcesses.size
  },
}

// Abort management for LLM HTTP requests
export const llmRequestAbortManager = {
  register(controller: AbortController) {
    state.llmAbortControllers.add(controller)
  },
  unregister(controller: AbortController) {
    state.llmAbortControllers.delete(controller)
  },
  abortAll() {
    for (const controller of state.llmAbortControllers) {
      try {
        controller.abort()
      } catch (_e) {
        // ignore
      }
    }
    state.llmAbortControllers.clear()
  },
}

// Per-session agent state management
export const agentSessionStateManager = {
  // Create a new session state
  createSession(sessionId: string): void {
    if (!state.agentSessions.has(sessionId)) {
      state.agentSessions.set(sessionId, {
        sessionId,
        shouldStop: false,
        iterationCount: 0,
        abortControllers: new Set(),
        processes: new Set(),
      })
      // Update legacy global flag
      state.isAgentModeActive = true
    }
  },

  // Get session state
  getSession(sessionId: string): AgentSessionState | undefined {
    return state.agentSessions.get(sessionId)
  },

  // Check if session should stop
  shouldStopSession(sessionId: string): boolean {
    const session = state.agentSessions.get(sessionId)
    return session?.shouldStop ?? state.shouldStopAgent // Fallback to global flag
  },

  // Mark session for stop
  stopSession(sessionId: string): void {
    const session = state.agentSessions.get(sessionId)
    if (session) {
      session.shouldStop = true
      // Abort all controllers for this session
      for (const controller of session.abortControllers) {
        try {
          controller.abort()
        } catch (_e) {
          // ignore
        }
      }
    }
  },

  // Stop all sessions
  stopAllSessions(): void {
    for (const [sessionId] of state.agentSessions) {
      this.stopSession(sessionId)
    }
    // Also set legacy global flag
    state.shouldStopAgent = true
  },

  // Register abort controller for session
  registerAbortController(sessionId: string, controller: AbortController): void {
    const session = state.agentSessions.get(sessionId)
    if (session) {
      session.abortControllers.add(controller)
    }
    // Also register globally for backward compatibility
    llmRequestAbortManager.register(controller)
  },

  // Unregister abort controller for session
  unregisterAbortController(sessionId: string, controller: AbortController): void {
    const session = state.agentSessions.get(sessionId)
    if (session) {
      session.abortControllers.delete(controller)
    }
    // Also unregister globally
    llmRequestAbortManager.unregister(controller)
  },

  // Register process for session
  registerProcess(sessionId: string, process: ChildProcess): void {
    const session = state.agentSessions.get(sessionId)
    if (session) {
      session.processes.add(process)

      // Clean up when process exits
      process.on("exit", () => {
        session.processes.delete(process)
      })
      process.on("error", () => {
        session.processes.delete(process)
      })
    }
    // Also register globally for backward compatibility
    agentProcessManager.registerProcess(process)
  },

  // Update iteration count for session
  updateIterationCount(sessionId: string, count: number): void {
    const session = state.agentSessions.get(sessionId)
    if (session) {
      session.iterationCount = count
    }
    // Also update global for backward compatibility
    state.agentIterationCount = count
  },

  // Clean up session state
  cleanupSession(sessionId: string): void {
    const session = state.agentSessions.get(sessionId)
    if (session) {
      // Abort any remaining controllers
      for (const controller of session.abortControllers) {
        try {
          controller.abort()
        } catch (_e) {
          // ignore
        }
      }
      session.abortControllers.clear()

      // Kill any remaining processes
      for (const process of session.processes) {
        try {
          if (!process.killed && process.exitCode === null) {
            process.kill("SIGKILL")
          }
        } catch (_e) {
          // ignore
        }
      }
      session.processes.clear()

      // Remove session
      state.agentSessions.delete(sessionId)

      // Update legacy global flag if no more sessions
      if (state.agentSessions.size === 0) {
        state.isAgentModeActive = false
        state.shouldStopAgent = false
        state.agentIterationCount = 0
      }
    }
  },

  // Get count of active sessions
  getActiveSessionCount(): number {
    return state.agentSessions.size
  },
}
