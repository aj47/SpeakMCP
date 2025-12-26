import { tipc } from "@egoist/tipc/main"
import { getRendererHandlers } from "@egoist/tipc/main"
import { logApp, logLLM } from "../debug"
import {
  WINDOWS,
  closeAgentModeAndHidePanelWindow,
  emergencyStopAgentMode,
  getWindowRendererHandlers,
} from "../window"
import { RendererHandlers } from "../renderer-handlers"
import {
  state,
  agentProcessManager,
  toolApprovalManager,
  agentSessionStateManager
} from "../state"
import { emitAgentProgress } from "../emit-agent-progress"
import { agentSessionTracker } from "../agent-session-tracker"
import { messageQueueService } from "../message-queue-service"

const t = tipc.create()

export const agentHandlers = {
  emergencyStopAgent: t.procedure.action(async () => {
    await emergencyStopAgentMode()

    return { success: true, message: "Agent mode emergency stopped" }
  }),

  clearAgentProgress: t.procedure.action(async () => {
    // Send to all windows so both main and panel can update their state
    for (const [id, win] of WINDOWS.entries()) {
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).clearAgentProgress.send()
      } catch (e) {
        logApp(`[tipc] clearAgentProgress send to ${id} failed:`, e)
      }
    }

    return { success: true }
  }),


  clearAgentSessionProgress: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      // Send to all windows (panel and main) so both can update their state
      for (const [id, win] of WINDOWS.entries()) {
        try {
          getRendererHandlers<RendererHandlers>(win.webContents).clearAgentSessionProgress?.send(input.sessionId)
        } catch (e) {
          logApp(`[tipc] clearAgentSessionProgress send to ${id} failed:`, e)
        }
      }
      return { success: true }
    }),

  clearInactiveSessions: t.procedure.action(async () => {

    // Clear completed sessions from the tracker
    agentSessionTracker.clearCompletedSessions()

    // Send to all windows so both main and panel can update their state
    for (const [id, win] of WINDOWS.entries()) {
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).clearInactiveSessions?.send()
      } catch (e) {
        logApp(`[tipc] clearInactiveSessions send to ${id} failed:`, e)
      }
    }

    return { success: true }
  }),

  closeAgentModeAndHidePanelWindow: t.procedure.action(async () => {
    closeAgentModeAndHidePanelWindow()
    return { success: true }
  }),

  getAgentStatus: t.procedure.action(async () => {
    return {
      isAgentModeActive: state.isAgentModeActive,
      shouldStopAgent: state.shouldStopAgent,
      agentIterationCount: state.agentIterationCount,
      activeProcessCount: agentProcessManager.getActiveProcessCount(),
    }
  }),

  getAgentSessions: t.procedure.action(async () => {
      return {
      activeSessions: agentSessionTracker.getActiveSessions(),
      recentSessions: agentSessionTracker.getRecentSessions(4),
    }
  }),

  // Get the profile snapshot for a specific session
  // This allows the UI to display which profile a session is using
  getSessionProfileSnapshot: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      return agentSessionStateManager.getSessionProfileSnapshot(input.sessionId)
        ?? agentSessionTracker.getSessionProfileSnapshot(input.sessionId)
    }),

  stopAgentSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {

      // Stop the session in the state manager (aborts LLM requests, kills processes)
      agentSessionStateManager.stopSession(input.sessionId)

      // Cancel any pending tool approvals for this session so executeToolCall doesn't hang
      toolApprovalManager.cancelSessionApprovals(input.sessionId)

      // Pause the message queue for this conversation to prevent processing the next queued message
      // The user can resume the queue later if they want to continue
      const session = agentSessionTracker.getSession(input.sessionId)
      if (session?.conversationId) {
        messageQueueService.pauseQueue(session.conversationId)
        logLLM(`[stopAgentSession] Paused queue for conversation ${session.conversationId}`)
      }

      // Immediately emit a final progress update with isComplete: true
      // This ensures the UI updates immediately without waiting for the agent loop
      // to detect the stop signal and emit its own final update
      await emitAgentProgress({
        sessionId: input.sessionId,
        currentIteration: 0,
        maxIterations: 0,
        steps: [
          {
            id: `stop_${Date.now()}`,
            type: "completion",
            title: "Agent stopped",
            description: "Agent mode was stopped by emergency kill switch. Queue paused.",
            status: "error",
            timestamp: Date.now(),
          },
        ],
        isComplete: true,
        finalContent: "(Agent mode was stopped by emergency kill switch)",
        conversationHistory: [],
      })

      // Mark the session as stopped in the tracker (removes from active sessions UI)
      agentSessionTracker.stopSession(input.sessionId)

      return { success: true }
    }),

  snoozeAgentSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {

      // Snooze the session (runs in background without stealing focus)
      agentSessionTracker.snoozeSession(input.sessionId)

      return { success: true }
    }),

  unsnoozeAgentSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {

      // Unsnooze the session (allow it to show progress UI again)
      agentSessionTracker.unsnoozeSession(input.sessionId)

      return { success: true }
    }),

  // Respond to a tool approval request
  respondToToolApproval: t.procedure
    .input<{ approvalId: string; approved: boolean }>()
    .action(async ({ input }) => {
      const success = toolApprovalManager.respondToApproval(input.approvalId, input.approved)
      return { success }
    }),

  // Request the Panel window to focus a specific agent session
  focusAgentSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      try {
        getWindowRendererHandlers("panel")?.focusAgentSession.send(input.sessionId)
      } catch (e) {
        logApp("[tipc] focusAgentSession send failed:", e)
      }
      return { success: true }
    }),
}
