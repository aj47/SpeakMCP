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

/**
 * Emit agent progress updates to the renderer.
 * 
 * This function handles:
 * - Checking if the panel window is available
 * - Auto-showing the panel for non-snoozed sessions (unless suppressed)
 * - Resizing the panel for agent mode before showing
 * - Sending updates to both panel and main windows
 * 
 * @param update - The agent progress update to emit
 */
export async function emitAgentProgress(update: AgentProgressUpdate): Promise<void> {
  const panel = WINDOWS.get("panel")
  if (!panel) {
    console.warn("Panel window not available for progress update")
    return
  }

  console.log(`[emitAgentProgress] Called for session ${update.sessionId}, panel visible: ${panel.isVisible()}, isSnoozed: ${update.isSnoozed}`)
  console.log(`[emitAgentProgress] conversationHistory length: ${update.conversationHistory?.length || 0}, roles: [${update.conversationHistory?.map(m => m.role).join(', ') || 'none'}]`)

  // Only show the panel window if it's not visible AND the session is not snoozed
  if (!panel.isVisible() && update.sessionId) {
    // Check if this session is snoozed before showing the panel
    const isSnoozed = agentSessionTracker.isSessionSnoozed(update.sessionId)

    console.log(`[emitAgentProgress] Panel not visible. Session ${update.sessionId} snoozed check: ${isSnoozed}`)

    if (isPanelAutoShowSuppressed()) {
      console.log(`[emitAgentProgress] Panel auto-show suppressed; NOT showing panel for session ${update.sessionId}`)
    } else if (!isSnoozed) {
      // Only show panel for non-snoozed sessions
      console.log(`[emitAgentProgress] Showing panel for non-snoozed session ${update.sessionId}`)
      // Set panel mode to agent before showing to ensure correct sizing
      resizePanelForAgentMode()
      showPanelWindow()
    } else {
      console.log(`[emitAgentProgress] Session ${update.sessionId} is snoozed, NOT showing panel`)
    }
  } else {
    console.log(`[emitAgentProgress] Skipping show check - panel visible: ${panel.isVisible()}, has sessionId: ${!!update.sessionId}`)
  }

  // Also send updates to main window if it's open for live progress visualization
  const main = WINDOWS.get("main")
  if (main && main.isVisible()) {
    try {
      const mainHandlers = getRendererHandlers<RendererHandlers>(main.webContents)
      setTimeout(() => {
        try {
          mainHandlers.agentProgressUpdate.send(update)
        } catch (error) {
          console.warn("Failed to send progress update to main window:", error)
        }
      }, 10)
    } catch (error) {
      console.warn("Failed to get main window renderer handlers:", error)
    }
  }

  try {
    const handlers = getRendererHandlers<RendererHandlers>(panel.webContents)
    if (!handlers.agentProgressUpdate) {
      console.warn("Agent progress handler not available")
      return
    }

    // Add a small delay to ensure UI updates are processed
    setTimeout(() => {
      try {
        handlers.agentProgressUpdate.send(update)
      } catch (error) {
        console.warn("Failed to send progress update:", error)
      }
    }, 10)
  } catch (error) {
    console.warn("Failed to get renderer handlers:", error)
  }
}

