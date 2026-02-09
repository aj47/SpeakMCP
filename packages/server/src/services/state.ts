import { ChildProcess } from "child_process"

// SessionProfileSnapshot type for session isolation
export interface SessionProfileSnapshot {
  profileId: string
  profileName: string
  guidelines?: string
  systemPrompt?: string
  mcpServerConfig?: {
    disabledServers?: string[]
    disabledTools?: string[]
    allServersDisabledByDefault?: boolean
    enabledServers?: string[]
  }
  modelConfig?: Record<string, unknown>
  skillsConfig?: Record<string, unknown>
}

export interface AgentSessionState {
  sessionId: string
  shouldStop: boolean
  isSnoozed: boolean
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

export interface QueuedMessage {
  id: string
  content: string
  conversationId?: string
  createdAt: number
  status: 'queued' | 'processing' | 'completed' | 'failed'
  error?: string
  retryCount?: number
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
  messageQueue: [] as QueuedMessage[],
  pausedMessageQueues: new Set<string>(),
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
        isSnoozed: false,
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
      session.isSnoozed = false

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

  // Mark session as snoozed (keeps it active but hidden from focused workflows)
  snoozeSession(sessionId: string): boolean {
    const session = state.agentSessions.get(sessionId)
    if (!session) return false
    session.isSnoozed = true
    return true
  },

  // Unsnooze session
  unsnoozeSession(sessionId: string): boolean {
    const session = state.agentSessions.get(sessionId)
    if (!session) return false
    session.isSnoozed = false
    return true
  },

  // Query snoozed state
  isSessionSnoozed(sessionId: string): boolean {
    const session = state.agentSessions.get(sessionId)
    return session?.isSnoozed ?? false
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

  // Get the count of pending approvals (for debugging)
  getPendingApprovalCount(): number {
    return state.pendingToolApprovals.size
  },
}



// Message queue manager for queuing user messages when agent is busy
export const messageQueueManager = {
  normalizeConversationId(conversationId?: string): string {
    const id = conversationId?.trim()
    return id && id.length > 0 ? id : 'default'
  },

  enqueue(content: string, conversationId?: string): QueuedMessage {
    const normalizedConversationId = this.normalizeConversationId(conversationId)
    const msg: QueuedMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content,
      conversationId: normalizedConversationId,
      createdAt: Date.now(),
      status: 'queued',
      retryCount: 0,
    }
    state.messageQueue.push(msg)
    return msg
  },

  dequeue(conversationId?: string): QueuedMessage | undefined {
    const normalizedConversationId = conversationId
      ? this.normalizeConversationId(conversationId)
      : undefined

    const idx = state.messageQueue.findIndex((m) => {
      if (m.status !== 'queued') return false
      const messageConversationId = this.normalizeConversationId(m.conversationId)
      if (state.pausedMessageQueues.has(messageConversationId)) return false
      if (!normalizedConversationId) return true
      return messageConversationId === normalizedConversationId
    })

    if (idx === -1) return undefined
    state.messageQueue[idx].status = 'processing'
    return state.messageQueue[idx]
  },

  getQueue(conversationId?: string): QueuedMessage[] {
    if (!conversationId) {
      return [...state.messageQueue]
    }
    const normalizedConversationId = this.normalizeConversationId(conversationId)
    return state.messageQueue.filter(
      (m) => this.normalizeConversationId(m.conversationId) === normalizedConversationId,
    )
  },

  getAllQueues(): Array<{ conversationId: string; messages: QueuedMessage[]; isPaused: boolean }> {
    const grouped = new Map<string, QueuedMessage[]>()

    for (const message of state.messageQueue) {
      const conversationId = this.normalizeConversationId(message.conversationId)
      if (!grouped.has(conversationId)) {
        grouped.set(conversationId, [])
      }
      grouped.get(conversationId)!.push(message)
    }

    const queueIds = new Set([...grouped.keys(), ...state.pausedMessageQueues.values()])
    return [...queueIds]
      .sort((a, b) => a.localeCompare(b))
      .map((conversationId) => ({
        conversationId,
        messages: grouped.get(conversationId) || [],
        isPaused: state.pausedMessageQueues.has(conversationId),
      }))
  },

  getMessage(id: string, conversationId?: string): QueuedMessage | undefined {
    if (!conversationId) {
      return state.messageQueue.find((m) => m.id === id)
    }
    const normalizedConversationId = this.normalizeConversationId(conversationId)
    return state.messageQueue.find(
      (m) =>
        m.id === id &&
        this.normalizeConversationId(m.conversationId) === normalizedConversationId,
    )
  },

  updateStatus(
    id: string,
    status: QueuedMessage['status'],
    error?: string,
    conversationId?: string,
  ): boolean {
    const msg = this.getMessage(id, conversationId)
    if (!msg) return false
    msg.status = status
    if (error) msg.error = error
    if (!error) delete msg.error
    return true
  },

  updateText(id: string, content: string, conversationId?: string): boolean {
    const msg = this.getMessage(id, conversationId)
    if (!msg) return false
    if (msg.status === 'processing') return false
    msg.content = content
    return true
  },

  retry(id: string, conversationId?: string): boolean {
    const msg = this.getMessage(id, conversationId)
    if (!msg) return false
    msg.status = 'queued'
    delete msg.error
    msg.retryCount = (msg.retryCount || 0) + 1
    return true
  },

  reorder(conversationId: string, messageIds: string[]): boolean {
    const normalizedConversationId = this.normalizeConversationId(conversationId)
    const queueForConversation = state.messageQueue.filter(
      (m) => this.normalizeConversationId(m.conversationId) === normalizedConversationId,
    )
    const queueIds = new Set(queueForConversation.map((m) => m.id))

    // All ids provided must belong to the same conversation queue.
    for (const id of messageIds) {
      if (!queueIds.has(id)) return false
    }

    // Keep message order deterministic:
    // 1) ids provided by caller first
    // 2) remaining items in original order.
    const prioritized = new Map(queueForConversation.map((m) => [m.id, m]))
    const reorderedConversation: QueuedMessage[] = []
    for (const id of messageIds) {
      const message = prioritized.get(id)
      if (message) {
        reorderedConversation.push(message)
        prioritized.delete(id)
      }
    }
    for (const message of queueForConversation) {
      if (prioritized.has(message.id)) {
        reorderedConversation.push(message)
      }
    }

    // Replace only this conversation slice while preserving other conversations.
    const otherMessages = state.messageQueue.filter(
      (m) => this.normalizeConversationId(m.conversationId) !== normalizedConversationId,
    )
    state.messageQueue = [...otherMessages, ...reorderedConversation]
    return true
  },

  remove(id: string, conversationId?: string): boolean {
    const idx = state.messageQueue.findIndex((m) => {
      if (m.id !== id) return false
      if (!conversationId) return true
      return this.normalizeConversationId(m.conversationId) === this.normalizeConversationId(conversationId)
    })
    if (idx === -1) return false
    state.messageQueue.splice(idx, 1)
    return true
  },

  clear(conversationId?: string): void {
    if (!conversationId) {
      state.messageQueue.length = 0
      state.pausedMessageQueues.clear()
      return
    }

    const normalizedConversationId = this.normalizeConversationId(conversationId)
    state.messageQueue = state.messageQueue.filter(
      (m) => this.normalizeConversationId(m.conversationId) !== normalizedConversationId,
    )
    state.pausedMessageQueues.delete(normalizedConversationId)
  },

  pause(conversationId: string): void {
    state.pausedMessageQueues.add(this.normalizeConversationId(conversationId))
  },

  resume(conversationId: string): void {
    state.pausedMessageQueues.delete(this.normalizeConversationId(conversationId))
  },

  isPaused(conversationId: string): boolean {
    return state.pausedMessageQueues.has(this.normalizeConversationId(conversationId))
  },

  getQueuedCount(conversationId?: string): number {
    if (!conversationId) {
      return state.messageQueue.filter((m) => m.status === 'queued').length
    }
    const normalizedConversationId = this.normalizeConversationId(conversationId)
    return state.messageQueue.filter(
      (m) =>
        m.status === 'queued' &&
        this.normalizeConversationId(m.conversationId) === normalizedConversationId,
    ).length
  },
}
