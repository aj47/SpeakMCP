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
}

class AgentSessionTracker {
  private static instance: AgentSessionTracker | null = null
  private sessions: Map<string, AgentSession> = new Map()

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
   * Mark a session as completed and remove it
   */
  completeSession(sessionId: string, finalActivity?: string): void {
    // Remove completed sessions immediately
    this.sessions.delete(sessionId)
  }

  /**
   * Mark a session as stopped (via kill switch) and remove it
   */
  stopSession(sessionId: string): void {
    // Remove stopped sessions immediately
    this.sessions.delete(sessionId)
  }

  /**
   * Mark a session as errored and remove it
   */
  errorSession(sessionId: string, errorMessage: string): void {
    // Remove errored sessions immediately
    this.sessions.delete(sessionId)
  }

  /**
   * Get all active sessions (only active sessions are stored now)
   */
  getActiveSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.startTime - a.startTime)
  }

  /**
   * Get recent sessions - returns empty array since we only track active sessions
   */
  getRecentSessions(limit: number = 4): AgentSession[] {
    return []
  }

  /**
   * Clear all sessions (for testing/debugging)
   */
  clearAllSessions(): void {
    this.sessions.clear()
  }
}

export const agentSessionTracker = AgentSessionTracker.getInstance()

