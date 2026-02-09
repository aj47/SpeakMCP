import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  state,
  agentSessionStateManager,
  llmRequestAbortManager,
  toolApprovalManager,
  messageQueueManager,
  type SessionProfileSnapshot,
} from "./state"

// Helper to reset state before each test
function resetState() {
  state.agentSessions.clear()
  state.llmAbortControllers.clear()
  state.pendingToolApprovals.clear()
  state.shouldStopAgent = false
  state.isAgentModeActive = false
  state.agentIterationCount = 0
  state.messageQueue.length = 0
  state.pausedMessageQueues.clear()
}

describe("agentSessionStateManager", () => {
  beforeEach(() => {
    resetState()
  })

  describe("createSession", () => {
    it("should create a new session with default values", () => {
      agentSessionStateManager.createSession("session-1")
      const session = agentSessionStateManager.getSession("session-1")

      expect(session).toBeDefined()
      expect(session?.sessionId).toBe("session-1")
      expect(session?.shouldStop).toBe(false)
      expect(session?.iterationCount).toBe(0)
      expect(session?.abortControllers.size).toBe(0)
      expect(session?.processes.size).toBe(0)
      expect(state.isAgentModeActive).toBe(true)
    })

    it("should create session with profile snapshot", () => {
      const snapshot: SessionProfileSnapshot = {
        profileId: "profile-1",
        profileName: "Test Profile",
        guidelines: "Some guidelines",
      }
      agentSessionStateManager.createSession("session-1", snapshot)
      const session = agentSessionStateManager.getSession("session-1")

      expect(session?.profileSnapshot).toEqual(snapshot)
    })

    it("should not overwrite existing session (duplicate session)", () => {
      agentSessionStateManager.createSession("session-1")
      agentSessionStateManager.updateIterationCount("session-1", 5)

      // Try to create duplicate - should not overwrite
      agentSessionStateManager.createSession("session-1")
      const session = agentSessionStateManager.getSession("session-1")

      expect(session?.iterationCount).toBe(5) // Original value preserved
    })

    it("should reset shouldStopAgent flag when creating new session", () => {
      state.shouldStopAgent = true
      agentSessionStateManager.createSession("session-1")

      expect(state.shouldStopAgent).toBe(false)
    })
  })

  describe("getSession", () => {
    it("should return undefined for non-existent session", () => {
      const session = agentSessionStateManager.getSession("non-existent")
      expect(session).toBeUndefined()
    })
  })

  describe("shouldStopSession", () => {
    it("should return false for active session", () => {
      agentSessionStateManager.createSession("session-1")
      expect(agentSessionStateManager.shouldStopSession("session-1")).toBe(false)
    })

    it("should return true after session is stopped", () => {
      agentSessionStateManager.createSession("session-1")
      agentSessionStateManager.stopSession("session-1")
      expect(agentSessionStateManager.shouldStopSession("session-1")).toBe(true)
    })

    it("should fallback to global flag for non-existent session", () => {
      state.shouldStopAgent = true
      expect(agentSessionStateManager.shouldStopSession("non-existent")).toBe(true)

      state.shouldStopAgent = false
      expect(agentSessionStateManager.shouldStopSession("non-existent")).toBe(false)
    })
  })

  describe("stopSession", () => {
    it("should mark session as stopped", () => {
      agentSessionStateManager.createSession("session-1")
      agentSessionStateManager.stopSession("session-1")

      const session = agentSessionStateManager.getSession("session-1")
      expect(session?.shouldStop).toBe(true)
    })

    it("should abort all controllers in session", () => {
      agentSessionStateManager.createSession("session-1")
      const controller1 = new AbortController()
      const controller2 = new AbortController()

      agentSessionStateManager.registerAbortController("session-1", controller1)
      agentSessionStateManager.registerAbortController("session-1", controller2)

      agentSessionStateManager.stopSession("session-1")

      expect(controller1.signal.aborted).toBe(true)
      expect(controller2.signal.aborted).toBe(true)
    })

    it("should handle stopping non-existent session gracefully", () => {
      // Should not throw
      expect(() => agentSessionStateManager.stopSession("non-existent")).not.toThrow()
    })
  })

  describe("cleanupSession", () => {
    it("should remove session from state", () => {
      agentSessionStateManager.createSession("session-1")
      agentSessionStateManager.cleanupSession("session-1")

      expect(agentSessionStateManager.getSession("session-1")).toBeUndefined()
    })

    it("should abort all controllers during cleanup", () => {
      agentSessionStateManager.createSession("session-1")
      const controller = new AbortController()
      agentSessionStateManager.registerAbortController("session-1", controller)

      agentSessionStateManager.cleanupSession("session-1")

      expect(controller.signal.aborted).toBe(true)
    })

    it("should set isAgentModeActive to false when last session is cleaned up", () => {
      agentSessionStateManager.createSession("session-1")
      expect(state.isAgentModeActive).toBe(true)

      agentSessionStateManager.cleanupSession("session-1")
      expect(state.isAgentModeActive).toBe(false)
    })

    it("should keep isAgentModeActive true when other sessions exist", () => {
      agentSessionStateManager.createSession("session-1")
      agentSessionStateManager.createSession("session-2")

      agentSessionStateManager.cleanupSession("session-1")
      expect(state.isAgentModeActive).toBe(true)
    })

    it("should handle cleaning up non-existent session gracefully", () => {
      expect(() => agentSessionStateManager.cleanupSession("non-existent")).not.toThrow()
    })
  })

  describe("updateIterationCount", () => {
    it("should update iteration count for session", () => {
      agentSessionStateManager.createSession("session-1")
      agentSessionStateManager.updateIterationCount("session-1", 5)

      const session = agentSessionStateManager.getSession("session-1")
      expect(session?.iterationCount).toBe(5)
    })

    it("should update global iteration count for backward compatibility", () => {
      agentSessionStateManager.createSession("session-1")
      agentSessionStateManager.updateIterationCount("session-1", 10)

      expect(state.agentIterationCount).toBe(10)
    })

    it("should handle updating non-existent session gracefully", () => {
      expect(() => agentSessionStateManager.updateIterationCount("non-existent", 5)).not.toThrow()
    })
  })

  describe("getActiveSessionCount", () => {
    it("should return correct count of active sessions", () => {
      expect(agentSessionStateManager.getActiveSessionCount()).toBe(0)

      agentSessionStateManager.createSession("session-1")
      expect(agentSessionStateManager.getActiveSessionCount()).toBe(1)

      agentSessionStateManager.createSession("session-2")
      expect(agentSessionStateManager.getActiveSessionCount()).toBe(2)

      agentSessionStateManager.cleanupSession("session-1")
      expect(agentSessionStateManager.getActiveSessionCount()).toBe(1)
    })
  })

  describe("stopAllSessions", () => {
    it("should stop all active sessions", () => {
      agentSessionStateManager.createSession("session-1")
      agentSessionStateManager.createSession("session-2")

      agentSessionStateManager.stopAllSessions()

      expect(agentSessionStateManager.shouldStopSession("session-1")).toBe(true)
      expect(agentSessionStateManager.shouldStopSession("session-2")).toBe(true)
      expect(state.shouldStopAgent).toBe(true)
    })
  })

  describe("snooze and unsnooze", () => {
    it("should snooze and unsnooze an active session", () => {
      agentSessionStateManager.createSession("session-1")
      expect(agentSessionStateManager.snoozeSession("session-1")).toBe(true)
      expect(agentSessionStateManager.isSessionSnoozed("session-1")).toBe(true)

      expect(agentSessionStateManager.unsnoozeSession("session-1")).toBe(true)
      expect(agentSessionStateManager.isSessionSnoozed("session-1")).toBe(false)
    })

    it("should return false when snoozing an unknown session", () => {
      expect(agentSessionStateManager.snoozeSession("missing")).toBe(false)
      expect(agentSessionStateManager.unsnoozeSession("missing")).toBe(false)
    })
  })
})


describe("llmRequestAbortManager", () => {
  beforeEach(() => {
    resetState()
  })

  describe("register and unregister", () => {
    it("should register an abort controller", () => {
      const controller = new AbortController()
      llmRequestAbortManager.register(controller)

      expect(state.llmAbortControllers.has(controller)).toBe(true)
    })

    it("should unregister an abort controller", () => {
      const controller = new AbortController()
      llmRequestAbortManager.register(controller)
      llmRequestAbortManager.unregister(controller)

      expect(state.llmAbortControllers.has(controller)).toBe(false)
    })

    it("should handle unregistering non-existent controller gracefully", () => {
      const controller = new AbortController()
      expect(() => llmRequestAbortManager.unregister(controller)).not.toThrow()
    })
  })

  describe("abortAll", () => {
    it("should abort all registered controllers", () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const controller3 = new AbortController()

      llmRequestAbortManager.register(controller1)
      llmRequestAbortManager.register(controller2)
      llmRequestAbortManager.register(controller3)

      llmRequestAbortManager.abortAll()

      expect(controller1.signal.aborted).toBe(true)
      expect(controller2.signal.aborted).toBe(true)
      expect(controller3.signal.aborted).toBe(true)
    })

    it("should clear all controllers after aborting", () => {
      const controller = new AbortController()
      llmRequestAbortManager.register(controller)

      llmRequestAbortManager.abortAll()

      expect(state.llmAbortControllers.size).toBe(0)
    })

    it("should handle empty controller set gracefully", () => {
      expect(() => llmRequestAbortManager.abortAll()).not.toThrow()
    })
  })
})

describe("toolApprovalManager", () => {
  beforeEach(() => {
    resetState()
  })

  describe("requestApproval", () => {
    it("should create a pending approval with unique ID", () => {
      const { approvalId } = toolApprovalManager.requestApproval("session-1", "test-tool", { arg: "value" })

      expect(approvalId).toBeDefined()
      expect(approvalId).toContain("session-1")
      expect(toolApprovalManager.getPendingApprovalCount()).toBe(1)
    })

    it("should return a promise that resolves on approval", async () => {
      const { approvalId, promise } = toolApprovalManager.requestApproval("session-1", "test-tool", {})

      // Approve in next tick
      setTimeout(() => toolApprovalManager.respondToApproval(approvalId, true), 0)

      const result = await promise
      expect(result).toBe(true)
    })

    it("should return a promise that resolves false on rejection", async () => {
      const { approvalId, promise } = toolApprovalManager.requestApproval("session-1", "test-tool", {})

      setTimeout(() => toolApprovalManager.respondToApproval(approvalId, false), 0)

      const result = await promise
      expect(result).toBe(false)
    })
  })

  describe("respondToApproval", () => {
    it("should return true when approval exists", () => {
      const { approvalId } = toolApprovalManager.requestApproval("session-1", "test-tool", {})

      const result = toolApprovalManager.respondToApproval(approvalId, true)
      expect(result).toBe(true)
    })

    it("should return false for non-existent approval", () => {
      const result = toolApprovalManager.respondToApproval("non-existent-id", true)
      expect(result).toBe(false)
    })

    it("should remove approval after responding", () => {
      const { approvalId } = toolApprovalManager.requestApproval("session-1", "test-tool", {})

      toolApprovalManager.respondToApproval(approvalId, true)
      expect(toolApprovalManager.getPendingApprovalCount()).toBe(0)
    })
  })

  describe("getPendingApproval", () => {
    it("should return pending approval for session", () => {
      toolApprovalManager.requestApproval("session-1", "my-tool", { key: "val" })

      const pending = toolApprovalManager.getPendingApproval("session-1")
      expect(pending).toBeDefined()
      expect(pending?.toolName).toBe("my-tool")
      expect(pending?.arguments).toEqual({ key: "val" })
    })

    it("should return undefined for session with no pending approvals", () => {
      const pending = toolApprovalManager.getPendingApproval("session-1")
      expect(pending).toBeUndefined()
    })
  })

  describe("cancelSessionApprovals", () => {
    it("should cancel all approvals for a session", async () => {
      const { promise: promise1 } = toolApprovalManager.requestApproval("session-1", "tool-1", {})
      const { promise: promise2 } = toolApprovalManager.requestApproval("session-1", "tool-2", {})

      toolApprovalManager.cancelSessionApprovals("session-1")

      expect(await promise1).toBe(false)
      expect(await promise2).toBe(false)
      expect(toolApprovalManager.getPendingApprovalCount()).toBe(0)
    })

    it("should not affect approvals from other sessions", async () => {
      const { approvalId: id1 } = toolApprovalManager.requestApproval("session-1", "tool-1", {})
      toolApprovalManager.requestApproval("session-2", "tool-2", {})

      toolApprovalManager.cancelSessionApprovals("session-1")

      expect(toolApprovalManager.getPendingApprovalCount()).toBe(1)
      expect(toolApprovalManager.getPendingApproval("session-2")).toBeDefined()
    })
  })

  describe("cancelAllApprovals", () => {
    it("should cancel all pending approvals", async () => {
      const { promise: promise1 } = toolApprovalManager.requestApproval("session-1", "tool-1", {})
      const { promise: promise2 } = toolApprovalManager.requestApproval("session-2", "tool-2", {})

      toolApprovalManager.cancelAllApprovals()

      expect(await promise1).toBe(false)
      expect(await promise2).toBe(false)
      expect(toolApprovalManager.getPendingApprovalCount()).toBe(0)
    })

    it("should handle empty approvals gracefully", () => {
      expect(() => toolApprovalManager.cancelAllApprovals()).not.toThrow()
    })
  })
})

describe("messageQueueManager", () => {
  beforeEach(() => {
    resetState()
  })

  it("should manage queue per conversation", () => {
    const msg1 = messageQueueManager.enqueue("hello", "conv-a")
    const msg2 = messageQueueManager.enqueue("world", "conv-b")

    expect(messageQueueManager.getQueue("conv-a")).toHaveLength(1)
    expect(messageQueueManager.getQueue("conv-b")).toHaveLength(1)
    expect(messageQueueManager.getQueue()).toHaveLength(2)

    messageQueueManager.remove(msg2.id, "conv-b")
    expect(messageQueueManager.getQueue("conv-b")).toHaveLength(0)
    expect(messageQueueManager.getMessage(msg1.id, "conv-a")?.content).toBe("hello")
  })

  it("should pause/resume queue and skip paused dequeue", () => {
    const msg1 = messageQueueManager.enqueue("a", "conv-a")
    messageQueueManager.pause("conv-a")

    expect(messageQueueManager.isPaused("conv-a")).toBe(true)
    expect(messageQueueManager.dequeue("conv-a")).toBeUndefined()

    messageQueueManager.resume("conv-a")
    expect(messageQueueManager.isPaused("conv-a")).toBe(false)
    expect(messageQueueManager.dequeue("conv-a")?.id).toBe(msg1.id)
  })

  it("should update, retry, and reorder queue entries", () => {
    const first = messageQueueManager.enqueue("first", "conv-a")
    const second = messageQueueManager.enqueue("second", "conv-a")

    expect(messageQueueManager.updateText(second.id, "second-edited", "conv-a")).toBe(true)
    expect(messageQueueManager.getMessage(second.id, "conv-a")?.content).toBe("second-edited")

    expect(messageQueueManager.updateStatus(second.id, "failed", "error", "conv-a")).toBe(true)
    expect(messageQueueManager.retry(second.id, "conv-a")).toBe(true)
    expect(messageQueueManager.getMessage(second.id, "conv-a")?.retryCount).toBe(1)

    expect(messageQueueManager.reorder("conv-a", [second.id])).toBe(true)
    const queue = messageQueueManager.getQueue("conv-a")
    expect(queue[0]?.id).toBe(second.id)
    expect(queue[1]?.id).toBe(first.id)
  })
})
