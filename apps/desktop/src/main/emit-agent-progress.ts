import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS, showPanelWindow, resizePanelForAgentMode } from "./window"
import { RendererHandlers } from "./renderer-handlers"
import { AgentProgressUpdate } from "../shared/types"
import { isPanelAutoShowSuppressed, agentSessionStateManager } from "./state"
import { agentSessionTracker } from "./agent-session-tracker"
import { configStore } from "./config"
import { logApp } from "./debug"

// Throttle for repeated identical state logging
let lastLogTime = 0
let lastLogState = ""
const LOG_THROTTLE_MS = 100

export async function emitAgentProgress(update: AgentProgressUpdate): Promise<void> {
  // Skip updates for stopped sessions, except final completion updates
  if (update.sessionId && !update.isComplete) {
    const shouldStop = agentSessionStateManager.shouldStopSession(update.sessionId)
    if (shouldStop) {
      logApp(`[emitAgentProgress] Skipping update for stopped session ${update.sessionId}`)
      return
    }
  }

  // Throttle repeated identical state logging
  const now = Date.now()
  const stateKey = `${update.sessionId}-${update.isComplete}-${update.isSnoozed}`
  const shouldLog = lastLogState !== stateKey || (now - lastLogTime) > LOG_THROTTLE_MS

  if (shouldLog) {
    logApp(`[emitAgentProgress] Called for session ${update.sessionId}, isSnoozed: ${update.isSnoozed}`)
    lastLogTime = now
    lastLogState = stateKey
  }

  // Helper for throttled logging - errors are always logged directly with logApp
  const throttledLog = (msg: string, ...rest: unknown[]) => {
    if (shouldLog) logApp(msg, ...rest)
  }

  // Send updates to main window if visible
  const main = WINDOWS.get("main")
  if (main && main.isVisible()) {
    try {
      const mainHandlers = getRendererHandlers<RendererHandlers>(main.webContents)
      setTimeout(() => {
        try {
          mainHandlers.agentProgressUpdate.send(update)
        } catch (error) {
          logApp("Failed to send progress update to main window:", error)
        }
      }, 10)
    } catch (error) {
      logApp("Failed to get main window renderer handlers:", error)
    }
  }

  // Now handle panel window updates
  const panel = WINDOWS.get("panel")
  if (!panel) {
    throttledLog("Panel window not available for progress update")
    return
  }

  throttledLog(`[emitAgentProgress] Panel visible: ${panel.isVisible()}`)

  // Check if floating panel auto-show is globally disabled in settings
  const config = configStore.get()
  const floatingPanelAutoShowEnabled = config.floatingPanelAutoShow !== false

  if (!panel.isVisible() && update.sessionId) {
    const isSnoozed = agentSessionTracker.isSessionSnoozed(update.sessionId)
    throttledLog(`[emitAgentProgress] Panel not visible. Session ${update.sessionId} snoozed check: ${isSnoozed}, floatingPanelAutoShow: ${floatingPanelAutoShowEnabled}`)

    if (!floatingPanelAutoShowEnabled) {
      throttledLog(`[emitAgentProgress] Floating panel auto-show disabled in settings; NOT showing panel for session ${update.sessionId}`)
    } else if (isPanelAutoShowSuppressed()) {
      throttledLog(`[emitAgentProgress] Panel auto-show suppressed; NOT showing panel for session ${update.sessionId}`)
    } else if (!isSnoozed) {
      throttledLog(`[emitAgentProgress] Showing panel for non-snoozed session ${update.sessionId}`)
      resizePanelForAgentMode()
      showPanelWindow()
    } else {
      throttledLog(`[emitAgentProgress] Session ${update.sessionId} is snoozed, NOT showing panel`)
    }
  } else {
    throttledLog(`[emitAgentProgress] Skipping show check - panel visible: ${panel.isVisible()}, has sessionId: ${!!update.sessionId}`)
  }

  try {
    const handlers = getRendererHandlers<RendererHandlers>(panel.webContents)
    if (!handlers.agentProgressUpdate) {
      throttledLog("Agent progress handler not available")
      return
    }

    setTimeout(() => {
      try {
        handlers.agentProgressUpdate.send(update)
      } catch (error) {
        logApp("Failed to send progress update:", error)
      }
    }, 10)
  } catch (error) {
    logApp("Failed to get renderer handlers:", error)
  }
}

