import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS, showPanelWindow, resizePanelForAgentMode } from "./window"
import { RendererHandlers } from "./renderer-handlers"
import { AgentProgressUpdate } from "../shared/types"
import { isPanelAutoShowSuppressed, agentSessionStateManager } from "./state"
import { agentSessionTracker } from "./agent-session-tracker"
import { configStore } from "./config"

export async function emitAgentProgress(update: AgentProgressUpdate): Promise<void> {
  // Skip updates for stopped sessions, except final completion updates
  if (update.sessionId && !update.isComplete) {
    const shouldStop = agentSessionStateManager.shouldStopSession(update.sessionId)
    if (shouldStop) {
      return
    }
  }

  // Send updates to main window if visible
  const main = WINDOWS.get("main")
  if (main && main.isVisible()) {
    try {
      const mainHandlers = getRendererHandlers<RendererHandlers>(main.webContents)
      setTimeout(() => {
        try {
          mainHandlers.agentProgressUpdate.send(update)
        } catch {
          // Silently ignore send failures
        }
      }, 10)
    } catch {
      // Silently ignore handler failures
    }
  }

  // Now handle panel window updates
  const panel = WINDOWS.get("panel")
  if (!panel) {
    return
  }

  // Check if floating panel auto-show is globally disabled in settings
  const config = configStore.get()
  const floatingPanelAutoShowEnabled = config.floatingPanelAutoShow !== false
  const hidePanelWhenMainFocused = config.hidePanelWhenMainFocused !== false

  // Check if main window is focused (to prevent panel showing when main app is focused)
  // Reuse the 'main' variable from above to avoid redeclaration
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
    if (!handlers.agentProgressUpdate) {
      return
    }

    setTimeout(() => {
      try {
        handlers.agentProgressUpdate.send(update)
      } catch {
        // Silently ignore send failures
      }
    }, 10)
  } catch {
    // Silently ignore handler failures
  }
}

