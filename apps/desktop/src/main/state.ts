import { ChildProcess } from "child_process"
import type { SessionProfileSnapshot } from "../shared/types"

export interface AgentSessionState {
  sessionId: string
  shouldStop: boolean
  iterationCount: number
  abortControllers: Set<AbortController>
  processes: Set<ChildProcess>
  /**
   * Profile snapshot captured at session creation time.
   * This ensures session isolation - changes to the global profile don't affect running sessions.
   */
  profileSnapshot?: SessionProfileSnapshot
}

interface PendingToolApproval {
  approvalId: string
  sessionId: string
  toolName: string
  arguments: any
  resolve: (approved: boolean) => void
}

export const state = {
  isRecording: false,
  isTextInputActive: false,
  focusedAppBeforeRecording: null as string | null,
  isToggleRecordingActive: false,
  isRecordingFromButtonClick: false,
  isRecordingMcpMode: false,
  isAgentModeActive: false,
  agentProcesses: new Set<ChildProcess>(),
  shouldStopAgent: false,
  agentIterationCount: 0,
  llmAbortControllers: new Set<AbortController>(),
  agentSessions: new Map<string, AgentSessionState>(),
  panelAutoShowSuppressedUntil: 0,
  pendingToolApprovals: new Map<string, PendingToolApproval>(),
  /** Flag to indicate the app is quitting - prevents crash recovery during shutdown */
  isQuitting: false,
}

/**
 * Mark the app as quitting. Once set, crash recovery will not recreate windows.
 * This prevents the recovery system from interfering with normal app shutdown.
 */
export function setAppQuitting(): void {
  state.isQuitting = true
}

export const agentProcessManager = {
  registerProcess(process: ChildProcess) {
    state.agentProcesses.add(process)

    process.on("exit", (_code, _signal) => {
      state.agentProcesses.delete(process)
    })

    process.on("error", (_error) => {
      state.agentProcesses.delete(process)
    })
  },

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

          process.kill("SIGTERM")

          const forceKillTimeout = setTimeout(() => {
            if (!process.killed && process.exitCode === null) {
              process.kill("SIGKILL")
            }
            resolve()
          }, 3000)

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

  emergencyStop(): void {
    for (const process of state.agentProcesses) {
      try {
        if (!process.killed && process.exitCode === null) {
          process.kill("SIGKILL")
        }
      } catch (error) {}
    }
    state.agentProcesses.clear()
  },

  getActiveProcessCount(): number {
    return state.agentProcesses.size
  },
}

export function suppressPanelAutoShow(ms: number = 750): void {
  state.panelAutoShowSuppressedUntil = Date.now() + ms
}

export function isPanelAutoShowSuppressed(): boolean {
  return Date.now() < state.panelAutoShowSuppressedUntil
}

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
      } catch (_e) {}
    }
    state.llmAbortControllers.clear()
  },
}

export const agentSessionStateManager = {
  /**
   * Create a new agent session state
   * @param sessionId - Unique session identifier
   * @param profileSnapshot - Optional profile snapshot for session isolation
   */
  createSession(sessionId: string, profileSnapshot?: SessionProfileSnapshot): void {
    if (!state.agentSessions.has(sessionId)) {
      state.agentSessions.set(sessionId, {
        sessionId,
        shouldStop: false,
        iterationCount: 0,
        abortControllers: new Set(),
        processes: new Set(),
        profileSnapshot,
      })
      // Update legacy global flag
      state.isAgentModeActive = true
      // Reset the global stop flag when starting a new session
      // (it may have been left true from a previous emergency stop)
      state.shouldStopAgent = false
    }
  },

  // Get session state
  getSession(sessionId: string): AgentSessionState | undefined {
    return state.agentSessions.get(sessionId)
  },

  // Get profile snapshot for a session
  getSessionProfileSnapshot(sessionId: string): SessionProfileSnapshot | undefined {
    const session = state.agentSessions.get(sessionId)
    return session?.profileSnapshot
  },

  // Check if session should stop
  shouldStopSession(sessionId: string): boolean {
    const session = state.agentSessions.get(sessionId)
    return session?.shouldStop ?? state.shouldStopAgent // Fallback to global flag
  },

  // Mark session for stop and kill its processes
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
      session.abortControllers.clear()

      // Kill all processes for this session
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
      // NOTE: We intentionally do NOT reset state.shouldStopAgent here!
      // It should remain true to block any late/in-flight progress updates.
      // It will be reset to false only when a new session is created.
      if (state.agentSessions.size === 0) {
        state.isAgentModeActive = false
        state.agentIterationCount = 0
      }
    }
  },

  // Get count of active sessions
  getActiveSessionCount(): number {
    return state.agentSessions.size
  },
}

// Tool approval manager for inline approval in agent progress UI
export const toolApprovalManager = {
  // Request approval for a tool call - returns approvalId and a promise that resolves when user responds
  requestApproval(sessionId: string, toolName: string, args: any): { approvalId: string; promise: Promise<boolean> } {
    const approvalId = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const promise = new Promise<boolean>((resolve) => {
      const approval: PendingToolApproval = {
        approvalId,
        sessionId,
        toolName,
        arguments: args,
        resolve,
      }
      state.pendingToolApprovals.set(approvalId, approval)
    })

    return { approvalId, promise }
  },

  // Respond to a tool approval request
  respondToApproval(approvalId: string, approved: boolean): boolean {
    const approval = state.pendingToolApprovals.get(approvalId)
    if (approval) {
      approval.resolve(approved)
      state.pendingToolApprovals.delete(approvalId)
      return true
    }
    return false
  },

  // Get pending approval for a session
  getPendingApproval(sessionId: string): PendingToolApproval | undefined {
    for (const approval of state.pendingToolApprovals.values()) {
      if (approval.sessionId === sessionId) {
        return approval
      }
    }
    return undefined
  },

  // Cancel all pending approvals for a session (e.g., when session is stopped)
  cancelSessionApprovals(sessionId: string): void {
    for (const [approvalId, approval] of state.pendingToolApprovals.entries()) {
      if (approval.sessionId === sessionId) {
        approval.resolve(false) // Deny the tool call
        state.pendingToolApprovals.delete(approvalId)
      }
    }
  },

  // Cancel all pending approvals
  cancelAllApprovals(): void {
    for (const approval of state.pendingToolApprovals.values()) {
      approval.resolve(false) // Deny all tool calls
    }
    state.pendingToolApprovals.clear()
  },
}
