/**
 * Agent Session Tracker
 * Tracks only active agent sessions for visibility in sidebar
 */

import type { RendererHandlers } from "./renderer-handlers"
import { logApp } from "./debug"
import { WINDOWS } from "./window"
import { getRendererHandlers } from "@egoist/tipc/main"
import type { SessionProfileSnapshot } from "../shared/types"

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
  /**
   * Profile snapshot captured at session creation time.
   * This ensures session isolation - changes to the global profile don't affect running sessions.
   */
  profileSnapshot?: SessionProfileSnapshot
}

/**
 * Emit session updates to all renderer windows
 */
async function emitSessionUpdate() {
  try {
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
      } catch (e) {}

    }

    // Emit to panel window
    const panelWindow = WINDOWS.get("panel")
    if (panelWindow) {
      try {
        const handlers = getRendererHandlers<RendererHandlers>(panelWindow.webContents)
        handlers.agentSessionsUpdated?.send(data)
      } catch (e) {}

    }
  } catch (e) {}

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

  private constructor() {}

  /**
   * Start tracking a new agent session
   * Sessions start snoozed by default - they run in background without showing floating panel
   * User can explicitly maximize/focus a session to see its progress
   * @param conversationId - Optional conversation ID to link the session to
   * @param conversationTitle - Optional title for the session
   * @param startSnoozed - If true, session runs in background without showing floating panel
   * @param profileSnapshot - Optional profile snapshot to bind to this session for isolation
   */
  startSession(
    conversationId?: string,
    conversationTitle?: string,
    startSnoozed: boolean = true,
    profileSnapshot?: SessionProfileSnapshot
  ): string {
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
      profileSnapshot, // Capture profile settings at session creation for isolation
    }

    this.sessions.set(sessionId, session)
    logApp(`[AgentSessionTracker] Started session: ${sessionId}, snoozed: ${startSnoozed}, profile: ${profileSnapshot?.profileName || 'none'}, total sessions: ${this.sessions.size}`)

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
   * Get the profile snapshot for a session
   * Returns the profile snapshot if the session exists and has one, undefined otherwise
   */
  getSessionProfileSnapshot(sessionId: string): SessionProfileSnapshot | undefined {
    const session = this.sessions.get(sessionId)
    return session?.profileSnapshot
  }

  /**
   * Find a session by conversationId (active or completed)
   * Returns the session ID if found, undefined otherwise
   */
  findSessionByConversationId(conversationId: string): string | undefined {
    // First check active sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.conversationId === conversationId) {
        return sessionId
      }
    }
    // Then check completed sessions
    for (const session of this.completedSessions) {
      if (session.conversationId === conversationId) {
        return session.id
      }
    }
    return undefined
  }

  /**
   * Revive a completed session to continue it
   * Moves the session from completedSessions back to active sessions
   * @param sessionId - The session ID to revive
   * @param startSnoozed - If true, session stays snoozed (runs in background without showing panel)
   */
  reviveSession(sessionId: string, startSnoozed: boolean = false): boolean {
    // Find in completed sessions
    const completedIndex = this.completedSessions.findIndex(s => s.id === sessionId)
    if (completedIndex === -1) {
      // Maybe it's already active?
      if (this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)
        // Preserve the current snooze state for already-active sessions
        // This ensures that if the user is actively watching the floating panel,
        // queued message executions will still be visible (not forced to snooze)
        logApp(`[AgentSessionTracker] Session ${sessionId} is already active, preserving snooze state: ${session?.isSnoozed}`)
        return true
      }
      logApp(`[AgentSessionTracker] Cannot revive - session not found: ${sessionId}`)
      return false
    }

    // Remove from completed and add back to active
    const [session] = this.completedSessions.splice(completedIndex, 1)
    session.status = "active"
    session.isSnoozed = startSnoozed
    delete session.endTime
    this.sessions.set(sessionId, session)

    logApp(`[AgentSessionTracker] Revived session: ${sessionId}, snoozed: ${startSnoozed}`)
    emitSessionUpdate()
    return true
  }

  /**
   * Clear all sessions (for testing/debugging)
   */
  clearAllSessions(): void {
    this.sessions.clear()
  }

  /**
   * Clear all completed/recent sessions (move to history)
   * Active sessions are preserved
   */
  clearCompletedSessions(): void {
    logApp(`[AgentSessionTracker] Clearing ${this.completedSessions.length} completed sessions`)
    this.completedSessions = []
    emitSessionUpdate()
  }
}

export const agentSessionTracker = AgentSessionTracker.getInstance()

