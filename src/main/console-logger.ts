/**
 * Console Logger for Renderer Processes
 *
 * Captures console messages from all renderer windows (main, panel, setup)
 * and pipes them to the main process console with [DEBUG][UI] prefix
 * when --debug-ui flag is enabled.
 *
 * This module provides two approaches:
 * 1. setupConsoleLogger: Uses Electron's built-in 'console-message' event
 *    - Simpler, more reliable
 *    - Captures all console output automatically
 *    - Limited formatting control
 *
 * 2. injectConsoleForwarder: Injects JavaScript to intercept console methods
 *    - More detailed control over formatting
 *    - Can capture console.log arguments separately
 *    - Requires IPC setup in preload
 *    - Currently not used, but available for future enhancements
 */

import { BrowserWindow } from "electron"
import { isDebugUI, logUI } from "./debug"

type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug"

interface ConsoleMessage {
  level: ConsoleLevel
  message: string
  source: string
  line?: number
  column?: number
}

/**
 * Format console arguments into a readable string
 */
function formatConsoleArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg
      }
      if (typeof arg === "object" && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2)
        } catch {
          return String(arg)
        }
      }
      return String(arg)
    })
    .join(" ")
}

/**
 * Get a short window identifier from the window title or URL
 */
function getWindowIdentifier(win: BrowserWindow): string {
  const title = win.getTitle()
  const url = win.webContents.getURL()

  // Extract route from URL (e.g., /panel, /setup, or main)
  if (url.includes("/panel")) return "PANEL"
  if (url.includes("/setup")) return "SETUP"
  return "MAIN"
}

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

/**
 * Alternative: Execute script in renderer to forward console messages via IPC
 * This captures more detailed console.log calls with arguments
 */
export function injectConsoleForwarder(win: BrowserWindow, windowId: string) {
  if (!isDebugUI()) {
    return
  }

  // Wait for the window to finish loading
  win.webContents.once("did-finish-load", () => {
    // Inject a script that intercepts console methods and forwards to main process
    win.webContents.executeJavaScript(`
      (function() {
        const windowId = '${windowId.toUpperCase()}';
        const originalConsole = {
          log: console.log,
          warn: console.warn,
          error: console.error,
          info: console.info,
          debug: console.debug
        };

        function formatArg(arg) {
          if (typeof arg === 'string') return arg;
          if (typeof arg === 'object' && arg !== null) {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        }

        function createInterceptor(level, original) {
          return function(...args) {
            // Call original console method
            original.apply(console, args);

            // Format and send to main process via IPC
            const message = args.map(formatArg).join(' ');

            // Use window.electron.ipcRenderer if available (from preload)
            if (window.electron && window.electron.ipcRenderer) {
              window.electron.ipcRenderer.send('console-message-from-renderer', {
                windowId,
                level,
                message,
                timestamp: new Date().toISOString()
              });
            }
          };
        }

        // Intercept all console methods
        console.log = createInterceptor('log', originalConsole.log);
        console.warn = createInterceptor('warn', originalConsole.warn);
        console.error = createInterceptor('error', originalConsole.error);
        console.info = createInterceptor('info', originalConsole.info);
        console.debug = createInterceptor('debug', originalConsole.debug);
      })();
    `).catch((err) => {
      console.error(`Failed to inject console forwarder for ${windowId}:`, err)
    })
  })
}

