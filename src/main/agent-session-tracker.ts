/**
 * Agent Session Tracker
 * Tracks active and recent agent sessions for visibility in settings
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
  private readonly MAX_RECENT_SESSIONS = 10 // Keep last 10 sessions

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
    this.cleanupOldSessions()
    
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
   * Mark a session as completed
   */
  completeSession(sessionId: string, finalActivity?: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.status = "completed"
      session.endTime = Date.now()
      if (finalActivity) {
        session.lastActivity = finalActivity
      }
    }
  }

  /**
   * Mark a session as stopped (via kill switch)
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.status = "stopped"
      session.endTime = Date.now()
      session.lastActivity = "Stopped by user"
    }
  }

  /**
   * Mark a session as errored
   */
  errorSession(sessionId: string, errorMessage: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.status = "error"
      session.endTime = Date.now()
      session.errorMessage = errorMessage
      session.lastActivity = `Error: ${errorMessage}`
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.status === "active")
      .sort((a, b) => b.startTime - a.startTime)
  }

  /**
   * Get recent sessions (last N sessions, excluding active ones)
   */
  getRecentSessions(limit: number = 4): AgentSession[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.status !== "active")
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit)
  }

  /**
   * Get all sessions (active + recent)
   */
  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.startTime - a.startTime)
  }

  /**
   * Clean up old sessions, keeping only the most recent ones
   */
  private cleanupOldSessions(): void {
    const allSessions = Array.from(this.sessions.values())
      .sort((a, b) => b.startTime - a.startTime)

    // Keep active sessions + recent completed/error/stopped sessions
    const sessionsToKeep = allSessions.slice(0, this.MAX_RECENT_SESSIONS)
    const sessionIdsToKeep = new Set(sessionsToKeep.map((s) => s.id))

    // Remove old sessions
    for (const [id] of this.sessions) {
      if (!sessionIdsToKeep.has(id)) {
        this.sessions.delete(id)
      }
    }
  }

  /**
   * Clear all sessions (for testing/debugging)
   */
  clearAllSessions(): void {
    this.sessions.clear()
  }
}

export const agentSessionTracker = AgentSessionTracker.getInstance()

