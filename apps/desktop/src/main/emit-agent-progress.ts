import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS, showPanelWindow, resizePanelForAgentMode } from "./window"
import { RendererHandlers } from "./renderer-handlers"
import { AgentProgressUpdate } from "../shared/types"
import { isPanelAutoShowSuppressed, agentSessionStateManager } from "./state"
import { agentSessionTracker } from "./agent-session-tracker"
import { configStore } from "./config"

// Throttle interval for non-critical progress updates (ms).
// Updates within this window are collapsed — only the latest is sent.
const THROTTLE_INTERVAL_MS = 150

// Per-session throttle state
const sessionThrottleState = new Map<string, {
  timer: ReturnType<typeof setTimeout> | null
  lastSendTime: number
  pendingUpdate: AgentProgressUpdate | null
}>()

/**
 * Send the update payload to all visible windows.
 */
function sendToWindows(update: AgentProgressUpdate): void {
  const main = WINDOWS.get("main")
  if (main && main.isVisible()) {
    try {
      const mainHandlers = getRendererHandlers<RendererHandlers>(main.webContents)
      mainHandlers.agentProgressUpdate.send(update)
    } catch {
      // Silently ignore send failures
    }
  }

  const panel = WINDOWS.get("panel")
  if (!panel) return

  // Handle auto-show logic for panel window
  const config = configStore.get()
  const floatingPanelAutoShowEnabled = config.floatingPanelAutoShow !== false
  const hidePanelWhenMainFocused = config.hidePanelWhenMainFocused !== false
  const isMainFocused = main?.isFocused() ?? false

  if (!panel.isVisible() && update.sessionId) {
    const isSnoozed = agentSessionTracker.isSessionSnoozed(update.sessionId)
    if (floatingPanelAutoShowEnabled && !isPanelAutoShowSuppressed() && !isSnoozed && !(hidePanelWhenMainFocused && isMainFocused)) {
      resizePanelForAgentMode()
      showPanelWindow()
    }
  }

  try {
    const handlers = getRendererHandlers<RendererHandlers>(panel.webContents)
    if (!handlers.agentProgressUpdate) return
    handlers.agentProgressUpdate.send(update)
  } catch {
    // Silently ignore handler failures
  }
}

/**
 * Determine whether an update must be sent immediately (not throttled).
 * Critical updates include: completion, tool approvals, errors, and the first update for a session.
 */
function isCriticalUpdate(update: AgentProgressUpdate): boolean {
  if (update.isComplete) return true
  if (update.pendingToolApproval) return true
  // First update for a session — send immediately
  if (update.sessionId && !sessionThrottleState.has(update.sessionId)) return true
  // Steps with error or awaiting_approval status
  if (update.steps?.some(s => s.status === "error" || s.status === "awaiting_approval")) return true
  return false
}

export async function emitAgentProgress(update: AgentProgressUpdate): Promise<void> {
  // Skip updates for stopped sessions, except final completion updates
  if (update.sessionId && !update.isComplete) {
    const shouldStop = agentSessionStateManager.shouldStopSession(update.sessionId)
    if (shouldStop) {
      const state = sessionThrottleState.get(update.sessionId)
      if (state?.timer) {
        clearTimeout(state.timer)
      }
      sessionThrottleState.delete(update.sessionId)
      return
    }
  }

  const sessionId = update.sessionId || "__global__"

  // Critical updates bypass the throttle entirely
  if (isCriticalUpdate(update)) {
    // Flush any pending throttled update for this session first
    const state = sessionThrottleState.get(sessionId)
    if (state?.timer) {
      clearTimeout(state.timer)
      state.timer = null
      state.pendingUpdate = null
    }

    // Send immediately
    sendToWindows(update)

    // Update throttle state
    sessionThrottleState.set(sessionId, {
      timer: null,
      lastSendTime: Date.now(),
      pendingUpdate: null,
    })

    // Clean up throttle state when session completes
    if (update.isComplete) {
      sessionThrottleState.delete(sessionId)
    }
    return
  }

  // Non-critical update — apply throttling
  let state = sessionThrottleState.get(sessionId)
  if (!state) {
    state = { timer: null, lastSendTime: 0, pendingUpdate: null }
    sessionThrottleState.set(sessionId, state)
  }

  const now = Date.now()
  const elapsed = now - state.lastSendTime

  if (elapsed >= THROTTLE_INTERVAL_MS) {
    // Enough time has passed — send immediately
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    state.pendingUpdate = null
    state.lastSendTime = now
    sendToWindows(update)
  } else {
    // Within throttle window — store as pending and schedule a trailing send
    state.pendingUpdate = update
    if (!state.timer) {
      const remaining = THROTTLE_INTERVAL_MS - elapsed
      state.timer = setTimeout(() => {
        const s = sessionThrottleState.get(sessionId)
        if (s?.pendingUpdate) {
          if (
            s.pendingUpdate.sessionId &&
            !s.pendingUpdate.isComplete &&
            agentSessionStateManager.shouldStopSession(s.pendingUpdate.sessionId)
          ) {
            s.pendingUpdate = null
            s.timer = null
            sessionThrottleState.delete(sessionId)
            return
          }
          s.lastSendTime = Date.now()
          sendToWindows(s.pendingUpdate)
          s.pendingUpdate = null
        }
        if (s) s.timer = null
      }, remaining)
    }
  }
}
