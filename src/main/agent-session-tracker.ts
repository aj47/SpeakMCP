/**
 * Agent Session Tracker
 * Tracks only active agent sessions for visibility in sidebar
 */

export interface AgentSession {
  id: string
  conversationId?: string
  conversationTitle?: string
  status: "active" | "completed" | "error" | "stopped"
  startTime: number
  endTime?: number
  currentIteration?: number
  maxIterations?: number
  lastActivity?: string
  errorMessage?: string
  isSnoozed?: boolean // When true, session runs in background without stealing focus
}

class AgentSessionTracker {
  private static instance: AgentSessionTracker | null = null
  private sessions: Map<string, AgentSession> = new Map()
  private completedSessions: AgentSession[] = []


  static getInstance(): AgentSessionTracker {
    if (!AgentSessionTracker.instance) {
      AgentSessionTracker.instance = new AgentSessionTracker()
    }
    return AgentSessionTracker.instance
  }

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Start tracking a new agent session
   */
  startSession(conversationId?: string, conversationTitle?: string): string {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const session: AgentSession = {
      id: sessionId,
      conversationId,
      conversationTitle: conversationTitle || "Untitled Agent Session",
      status: "active",
      startTime: Date.now(),
      currentIteration: 0,
      maxIterations: 10,
      lastActivity: "Starting agent session...",
    }

    this.sessions.set(sessionId, session)
    console.log(`[AgentSessionTracker] Started session: ${sessionId}, total sessions: ${this.sessions.size}`)

    return sessionId
  }

  /**
   * Update an existing session
   */
  updateSession(
    sessionId: string,
    updates: Partial<Omit<AgentSession, "id" | "startTime">>
  ): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      Object.assign(session, updates)
    }
  }

  /**
   * Mark a session as completed and move it to recent sessions
   */
  completeSession(sessionId: string, finalActivity?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      console.log(`[AgentSessionTracker] Complete requested for non-existent session: ${sessionId}`)
      return
    }
    session.status = "completed"
    session.endTime = Date.now()
    if (finalActivity) {
      session.lastActivity = finalActivity
    }
    // Move to recent list (newest first), cap length
    this.completedSessions.unshift({ ...session })
    if (this.completedSessions.length > 20) {
      this.completedSessions.length = 20
    }
    this.sessions.delete(sessionId)
    console.log(`[AgentSessionTracker] Completing session: ${sessionId}, remaining sessions: ${this.sessions.size}`)
  }

  /**
   * Mark a session as stopped and move it to recent sessions
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      console.log(`[AgentSessionTracker] Stop requested for non-existent session: ${sessionId}`)
      return
    }
    session.status = "stopped"
    session.endTime = Date.now()
    this.completedSessions.unshift({ ...session })
    if (this.completedSessions.length > 20) {
      this.completedSessions.length = 20
    }
    this.sessions.delete(sessionId)
    console.log(`[AgentSessionTracker] Stopping session: ${sessionId}, remaining sessions: ${this.sessions.size}`)
  }

  /**
   * Mark a session as errored and move it to recent sessions
   */
  errorSession(sessionId: string, errorMessage: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      console.log(`[AgentSessionTracker] Error reported for non-existent session: ${sessionId}`)
      return
    }
    session.status = "error"
    session.errorMessage = errorMessage
    session.endTime = Date.now()
    this.completedSessions.unshift({ ...session })
    if (this.completedSessions.length > 20) {
      this.completedSessions.length = 20
    }
    this.sessions.delete(sessionId)
    console.log(`[AgentSessionTracker] Error in session: ${sessionId}, remaining sessions: ${this.sessions.size}`)
  }

  /**
   * Get all active sessions (only active sessions are stored now)
   */
  getActiveSessions(): AgentSession[] {
    const sessions = Array.from(this.sessions.values())
      .sort((a, b) => b.startTime - a.startTime)
    console.log(`[AgentSessionTracker] getActiveSessions called, returning ${sessions.length} sessions:`, sessions.map(s => ({ id: s.id, title: s.conversationTitle, snoozed: s.isSnoozed })))
    return sessions
  }

  /**
   * Get recent sessions (completed/stopped/error), newest first
   */
  getRecentSessions(limit: number = 4): AgentSession[] {
    return this.completedSessions
      .slice(0, limit)
      .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
  }

  /**
   * Snooze a session (runs in background without stealing focus)
   */
  snoozeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      console.log(`[AgentSessionTracker] Snoozing session: ${sessionId}, was snoozed: ${session.isSnoozed}`)
      session.isSnoozed = true
      this.sessions.set(sessionId, session)
      console.log(`[AgentSessionTracker] Session ${sessionId} is now snoozed: ${session.isSnoozed}`)
    } else {
      console.log(`[AgentSessionTracker] Cannot snooze - session not found: ${sessionId}`)
    }
  }

  /**
   * Unsnooze a session (allow it to show progress UI again)
   */
  unsnoozeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      console.log(`[AgentSessionTracker] Unsnoozing session: ${sessionId}, was snoozed: ${session.isSnoozed}`)
      session.isSnoozed = false
      this.sessions.set(sessionId, session)
      console.log(`[AgentSessionTracker] Session ${sessionId} is now snoozed: ${session.isSnoozed}`)
    } else {
      console.log(`[AgentSessionTracker] Cannot unsnooze - session not found: ${sessionId}`)
    }
  }

  /**
   * Check if a session is snoozed
   */
  isSessionSnoozed(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    return session?.isSnoozed ?? false
  }

  /**
   * Clear all sessions (for testing/debugging)
   */
  clearAllSessions(): void {
    this.sessions.clear()
  }
}

export const agentSessionTracker = AgentSessionTracker.getInstance()

