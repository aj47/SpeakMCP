/**
 * Shared utility for emitting agent progress updates to renderer windows.
 * 
 * This module consolidates the emitAgentProgress function that was previously
 * duplicated in tipc.ts and llm.ts, ensuring consistent behavior across
 * the application.
 */

import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS, showPanelWindow, resizePanelForAgentMode } from "./window"
import { RendererHandlers } from "./renderer-handlers"
import { AgentProgressUpdate } from "../shared/types"
import { isPanelAutoShowSuppressed } from "./state"
import { agentSessionTracker } from "./agent-session-tracker"
import { logApp } from "./debug"

/**
 * Emit agent progress updates to the renderer.
 *
 * This function handles:
 * - Sending updates to the main window (if visible) for live progress visualization
 * - Checking if the panel window is available
 * - Auto-showing the panel for non-snoozed sessions (unless suppressed)
 * - Resizing the panel for agent mode before showing
 * - Sending updates to both panel and main windows
 *
 * @param update - The agent progress update to emit
 */
export async function emitAgentProgress(update: AgentProgressUpdate): Promise<void> {
  logApp(`[emitAgentProgress] Called for session ${update.sessionId}, isSnoozed: ${update.isSnoozed}`)
  logApp(`[emitAgentProgress] conversationHistory length: ${update.conversationHistory?.length || 0}, roles: [${update.conversationHistory?.map(m => m.role).join(', ') || 'none'}]`)

  // Always send updates to main window if it's open for live progress visualization
  // This is done first to ensure main window updates even if panel is unavailable
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
    logApp("Panel window not available for progress update")
    return
  }

  logApp(`[emitAgentProgress] Panel visible: ${panel.isVisible()}`)

  // Only show the panel window if it's not visible AND the session is not snoozed
  if (!panel.isVisible() && update.sessionId) {
    // Check if this session is snoozed before showing the panel
    const isSnoozed = agentSessionTracker.isSessionSnoozed(update.sessionId)

    logApp(`[emitAgentProgress] Panel not visible. Session ${update.sessionId} snoozed check: ${isSnoozed}`)

    if (isPanelAutoShowSuppressed()) {
      logApp(`[emitAgentProgress] Panel auto-show suppressed; NOT showing panel for session ${update.sessionId}`)
    } else if (!isSnoozed) {
      // Only show panel for non-snoozed sessions
      logApp(`[emitAgentProgress] Showing panel for non-snoozed session ${update.sessionId}`)
      // Set panel mode to agent before showing to ensure correct sizing
      resizePanelForAgentMode()
      showPanelWindow()
    } else {
      logApp(`[emitAgentProgress] Session ${update.sessionId} is snoozed, NOT showing panel`)
    }
  } else {
    logApp(`[emitAgentProgress] Skipping show check - panel visible: ${panel.isVisible()}, has sessionId: ${!!update.sessionId}`)
  }

  try {
    const handlers = getRendererHandlers<RendererHandlers>(panel.webContents)
    if (!handlers.agentProgressUpdate) {
      logApp("Agent progress handler not available")
      return
    }

    // Add a small delay to ensure UI updates are processed
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

