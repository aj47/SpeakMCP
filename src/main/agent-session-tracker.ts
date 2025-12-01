/**
 * Agent Session Tracker
 * Tracks only active agent sessions for visibility in sidebar
 */

import type { RendererHandlers } from "./renderer-handlers"
import { logApp } from "./debug"

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

/**
 * Emit session updates to all renderer windows
 */
async function emitSessionUpdate() {
  try {
    const { WINDOWS } = await import("./window")
    const { getRendererHandlers } = await import("@egoist/tipc/main")

    const agentSessionTracker = AgentSessionTracker.getInstance()
    const data = {
      activeSessions: agentSessionTracker.getActiveSessions(),
      recentSessions: agentSessionTracker.getRecentSessions(4),
    }

    // Emit to main window
    const mainWindow = WINDOWS.get("main")
    if (mainWindow) {
      try {
        const handlers = getRendererHandlers<RendererHandlers>(mainWindow.webContents)
        handlers.agentSessionsUpdated?.send(data)
      } catch (e) {
        // Window might not be ready yet
      }
    }

    // Emit to panel window
    const panelWindow = WINDOWS.get("panel")
    if (panelWindow) {
      try {
        const handlers = getRendererHandlers<RendererHandlers>(panelWindow.webContents)
        handlers.agentSessionsUpdated?.send(data)
      } catch (e) {
        // Window might not be ready yet
      }
    }
  } catch (e) {
    // Silently fail - this is a best-effort notification
  }
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
   * Sessions start snoozed by default - they run in background without showing floating panel
   * User can explicitly maximize/focus a session to see its progress
   */
  startSession(conversationId?: string, conversationTitle?: string, startSnoozed: boolean = true): string {
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
      isSnoozed: startSnoozed, // Start snoozed by default - no floating panel auto-show
    }

    this.sessions.set(sessionId, session)
    logApp(`[AgentSessionTracker] Started session: ${sessionId}, snoozed: ${startSnoozed}, total sessions: ${this.sessions.size}`)

    // Emit update to UI
    emitSessionUpdate()

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
      logApp(`[AgentSessionTracker] Complete requested for non-existent session: ${sessionId}`)
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
    logApp(`[AgentSessionTracker] Completing session: ${sessionId}, remaining sessions: ${this.sessions.size}`)

    // Emit update to UI
    emitSessionUpdate()
  }

  /**
   * Mark a session as stopped and move it to recent sessions
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      logApp(`[AgentSessionTracker] Stop requested for non-existent session: ${sessionId}`)
      return
    }
    session.status = "stopped"
    session.endTime = Date.now()
    this.completedSessions.unshift({ ...session })
    if (this.completedSessions.length > 20) {
      this.completedSessions.length = 20
    }
    this.sessions.delete(sessionId)
    logApp(`[AgentSessionTracker] Stopping session: ${sessionId}, remaining sessions: ${this.sessions.size}`)

    // Emit update to UI
    emitSessionUpdate()
  }

  /**
   * Mark a session as errored and move it to recent sessions
   */
  errorSession(sessionId: string, errorMessage: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      logApp(`[AgentSessionTracker] Error reported for non-existent session: ${sessionId}`)
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
    logApp(`[AgentSessionTracker] Error in session: ${sessionId}, remaining sessions: ${this.sessions.size}`)

    // Emit update to UI
    emitSessionUpdate()
  }

  /**
   * Get all active sessions (only active sessions are stored now)
   */
  getActiveSessions(): AgentSession[] {
    const sessions = Array.from(this.sessions.values())
      .sort((a, b) => b.startTime - a.startTime)
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
      logApp(`[AgentSessionTracker] Snoozing session: ${sessionId}, was snoozed: ${session.isSnoozed}`)
      session.isSnoozed = true
      this.sessions.set(sessionId, session)
      logApp(`[AgentSessionTracker] Session ${sessionId} is now snoozed: ${session.isSnoozed}`)

      // Emit update to UI
      emitSessionUpdate()
    } else {
      logApp(`[AgentSessionTracker] Cannot snooze - session not found: ${sessionId}`)
    }
  }

  /**
   * Unsnooze a session (allow it to show progress UI again)
   */
  unsnoozeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      logApp(`[AgentSessionTracker] Unsnoozing session: ${sessionId}, was snoozed: ${session.isSnoozed}`)
      session.isSnoozed = false
      this.sessions.set(sessionId, session)
      logApp(`[AgentSessionTracker] Session ${sessionId} is now snoozed: ${session.isSnoozed}`)

      // Emit update to UI
      emitSessionUpdate()
    } else {
      logApp(`[AgentSessionTracker] Cannot unsnooze - session not found: ${sessionId}`)
    }
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId)
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

