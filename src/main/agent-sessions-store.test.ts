import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { AgentSessionsStore } from "./agent-sessions-store"
import type { AgentProgressUpdate } from "@shared/types"

const baseUpdate = (overrides: Partial<AgentProgressUpdate> = {}): AgentProgressUpdate => ({
  sessionId: overrides.sessionId || "sess_1",
  conversationId: overrides.conversationId,
  currentIteration: overrides.currentIteration ?? 1,
  maxIterations: overrides.maxIterations ?? 50,
  steps: overrides.steps ?? [],
  isComplete: overrides.isComplete ?? false,
  isSnoozed: overrides.isSnoozed,
  finalContent: overrides.finalContent,
  conversationHistory: overrides.conversationHistory,
})

describe("AgentSessionsStore retention", () => {
  let store: AgentSessionsStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = new AgentSessionsStore()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it("does not schedule cleanup for incomplete sessions", () => {
    store.addOrUpdate(baseUpdate({ isComplete: false }))
    // advance time well past TTL; nothing should be removed
    vi.advanceTimersByTime(10_000)
    const snap = store.getSnapshot()
    expect(Object.keys(snap.sessions)).toContain("sess_1")
  })

  it("schedules TTL cleanup for complete & not snoozed sessions", () => {
    store.addOrUpdate(baseUpdate({ isComplete: true, isSnoozed: false }))
    // Just before TTL
    vi.advanceTimersByTime(4_999)
    expect(store.getSession("sess_1")).toBeDefined()
    // Cross TTL boundary
    vi.advanceTimersByTime(2)
    expect(store.getSession("sess_1")).toBeUndefined()
  })

  it("cancels cleanup when session is snoozed", () => {
    store.addOrUpdate(baseUpdate({ isComplete: true, isSnoozed: false }))
    // Now snooze it before TTL fires
    store.addOrUpdate(baseUpdate({ isComplete: true, isSnoozed: true }))
    vi.advanceTimersByTime(10_000)
    expect(store.getSession("sess_1")).toBeDefined()
  })

  it("reschedules cleanup when unsnoozed while complete", () => {
    store.addOrUpdate(baseUpdate({ isComplete: true, isSnoozed: true }))
    // Unsnooze (still complete) -> should schedule TTL now
    store.addOrUpdate(baseUpdate({ isComplete: true, isSnoozed: false }))
    vi.advanceTimersByTime(5_001)
    expect(store.getSession("sess_1")).toBeUndefined()
  })

  it("snapshot contains sessions and seq", () => {
    const r1 = store.addOrUpdate(baseUpdate({ sessionId: "a" }))
    const r2 = store.addOrUpdate(baseUpdate({ sessionId: "b", currentIteration: 2 }))
    const snap = store.getSnapshot()
    expect(Object.keys(snap.sessions).sort()).toEqual(["a", "b"])
    expect(snap.seqBySession["a"]).toBe(r1.seq)
    expect(snap.seqBySession["b"]).toBe(r2.seq)
    expect(typeof snap.capturedAt).toBe("number")
  })
})

