import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS } from "./window"
import { RendererHandlers } from "./renderer-handlers"
import { ContextLimitWarning } from "../shared/types"
import { logApp } from "./debug"

/**
 * Emit a context limit warning to renderer windows.
 * This warns the user when context usage approaches the limit (≥85%).
 * The user can choose to:
 * - Clear & Load Ledger (lossless state preservation)
 * - Summarize Messages (lossy compression)
 * - Continue Anyway (risk hitting hard limit)
 * - Dismiss (hide warning for this session)
 */
export async function emitContextWarning(warning: ContextLimitWarning): Promise<void> {
  logApp(`[emitContextWarning] Context at ${warning.contextUsagePercent.toFixed(1)}% (${warning.estTokens}/${warning.maxTokens} tokens) for session ${warning.sessionId}`)

  // Send to main window if visible
  const main = WINDOWS.get("main")
  if (main && main.isVisible()) {
    try {
      const mainHandlers = getRendererHandlers<RendererHandlers>(main.webContents)
      setTimeout(() => {
        try {
          mainHandlers["context:limit-warning"].send(warning)
        } catch (error) {
          logApp("Failed to send context warning to main window:", error)
        }
      }, 10)
    } catch (error) {
      logApp("Failed to get main window renderer handlers for context warning:", error)
    }
  }

  // Send to panel window if available
  const panel = WINDOWS.get("panel")
  if (panel) {
    try {
      const panelHandlers = getRendererHandlers<RendererHandlers>(panel.webContents)
      setTimeout(() => {
        try {
          panelHandlers["context:limit-warning"].send(warning)
        } catch (error) {
          logApp("Failed to send context warning to panel window:", error)
        }
      }, 10)
    } catch (error) {
      logApp("Failed to get panel window renderer handlers for context warning:", error)
    }
  }
}
