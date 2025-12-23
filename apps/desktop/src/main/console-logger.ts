import type { BrowserWindow } from "electron"
import { isDebugUI, logUI } from "./debug"

type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug"



/**
 * Setup console message listener for a specific window
 */
export function setupConsoleLogger(win: BrowserWindow, windowId: string) {
  // Only setup if debug UI is enabled
  if (!isDebugUI()) {
    return
  }

  const identifier = windowId.toUpperCase()

  // Listen to console messages from the renderer process
  win.webContents.on("console-message", (event, level, message, line, sourceId) => {
    // Map Electron's console level numbers to strings
    const levelMap: Record<number, ConsoleLevel> = {
      0: "log",
      1: "warn",
      2: "error",
      3: "info",
      4: "debug",
    }

    const consoleLevel = levelMap[level] || "log"

    // Extract source file name from full path
    const sourceName = sourceId ? sourceId.split("/").pop() || sourceId : "unknown"

    // Format the message with window identifier and source
    const prefix = `[${identifier}]`
    const sourceInfo = line ? `${sourceName}:${line}` : sourceName
    const levelPrefix = consoleLevel === "error" ? "[ERROR]" : consoleLevel === "warn" ? "[WARN]" : ""

    // Construct the full log message
    const fullMessage = levelPrefix
      ? `${prefix} ${levelPrefix} ${message} (${sourceInfo})`
      : `${prefix} ${message} (${sourceInfo})`

    // Use the existing logUI function which respects debug flags
    logUI(fullMessage)
  })

  // Also listen to crashed and unresponsive events for debugging
  win.webContents.on("render-process-gone", (event, details) => {
    logUI(`[${identifier}] [FATAL] Renderer process gone:`, details)
  })

  win.webContents.on("unresponsive", () => {
    logUI(`[${identifier}] [WARN] Window became unresponsive`)
  })

  win.webContents.on("responsive", () => {
    logUI(`[${identifier}] [INFO] Window became responsive again`)
  })
}

/**
 * Setup console loggers for all windows in the WINDOWS map
 */
export function setupConsoleLoggersForAllWindows(windows: Map<string, BrowserWindow>) {
  if (!isDebugUI()) {
    return
  }

  windows.forEach((win, id) => {
    setupConsoleLogger(win, id)
  })
}

