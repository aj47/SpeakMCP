import { AgentProgressUpdate } from "@shared/types"

export type AgentSeqMap = Record<string, number>

export type AgentSnapshot = {
  sessions: Record<string, AgentProgressUpdate>
  seqBySession: AgentSeqMap
  capturedAt: number
}

/**
 * AgentSessionsStore (single source of truth)
 * - Per-session monotonic sequence numbers (seq)
 * - Last-known progress per session
 * - Snapshot + (future) subscribe support
 * - Retention hooks (TTL for completed & not snoozed)
 */
export class AgentSessionsStore {
  private sessions = new Map<string, AgentProgressUpdate>()
  private seqBySession = new Map<string, number>()

  /** Upsert progress and return assigned seq for this session */
  addOrUpdate(update: AgentProgressUpdate): { seq: number; progress: AgentProgressUpdate } {
    const { sessionId } = update
    const prevSeq = this.seqBySession.get(sessionId) ?? 0
    const nextSeq = prevSeq + 1

    // Store the latest snapshot for the session
    this.sessions.set(sessionId, update)
    this.seqBySession.set(sessionId, nextSeq)

    // Placeholder: hook for retention scheduling (e.g., schedule cleanup)
    // this.maybeScheduleCleanup(update)

    return { seq: nextSeq, progress: update }
  }

  /** Get the latest progress for a session */
  getSession(sessionId: string): AgentProgressUpdate | undefined {
    return this.sessions.get(sessionId)
  }

  /** Get current seq for a session (0 if none) */
  getSeq(sessionId: string): number {
    return this.seqBySession.get(sessionId) ?? 0
  }

  /** Return a snapshot of all known sessions with seq numbers */
  getSnapshot(): AgentSnapshot {
    const sessionsObj: Record<string, AgentProgressUpdate> = {}
    const seqObj: AgentSeqMap = {}
    for (const [id, progress] of this.sessions) sessionsObj[id] = progress
    for (const [id, seq] of this.seqBySession) seqObj[id] = seq
    return { sessions: sessionsObj, seqBySession: seqObj, capturedAt: Date.now() }
  }

  /** Remove a session (e.g., TTL cleanup) */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.seqBySession.delete(sessionId)
  }

  /**
   * Placeholder for retention logic (implemented in a later task):
   * - If update.isComplete && !update.isSnoozed: schedule TTL cleanup
   * - If snoozed: preserve; on unsnooze+complete: schedule TTL
   */
  // private maybeScheduleCleanup(update: AgentProgressUpdate) {}
}

export const agentSessionsStore = new AgentSessionsStore()

