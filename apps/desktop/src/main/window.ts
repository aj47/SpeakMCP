import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  shell,
  screen,
  app,
} from "electron"
import path from "path"
import { getRendererHandlers } from "@egoist/tipc/main"
import { RendererHandlers } from "./renderer-handlers"
import { logApp, logUI } from "./debug"
import { configStore } from "./config"
import { getFocusedAppInfo } from "./keyboard"
import { state, agentProcessManager, suppressPanelAutoShow } from "./state"
import { calculatePanelPosition } from "./panel-position"
import { setupConsoleLogger } from "./console-logger"
import { emergencyStopAll } from "./emergency-stop"
import { diagnosticsService } from "./diagnostics"

type WINDOW_ID = "main" | "panel" | "setup"

export const WINDOWS = new Map<WINDOW_ID, BrowserWindow>()

// Crash recovery tracking to prevent infinite restart loops
interface CrashRecord {
  count: number
  firstCrashTime: number
  lastCrashTime: number
}

const crashRecords = new Map<WINDOW_ID, CrashRecord>()
const MAX_CRASHES_IN_WINDOW = 3 // Max crashes allowed before giving up
const CRASH_WINDOW_MS = 60000 // 1 minute window for counting crashes
const CRASH_RECOVERY_DELAY_MS = 1000 // Delay before attempting recovery

/**
 * Check if we should attempt crash recovery for a window
 */
function shouldAttemptCrashRecovery(windowId: WINDOW_ID): boolean {
  const record = crashRecords.get(windowId)
  const now = Date.now()

  if (!record) {
    // First crash, allow recovery
    crashRecords.set(windowId, {
      count: 1,
      firstCrashTime: now,
      lastCrashTime: now,
    })
    return true
  }

  // Reset crash count if outside the time window
  if (now - record.firstCrashTime > CRASH_WINDOW_MS) {
    crashRecords.set(windowId, {
      count: 1,
      firstCrashTime: now,
      lastCrashTime: now,
    })
    return true
  }

  // Within time window, check crash count
  record.count++
  record.lastCrashTime = now

  if (record.count > MAX_CRASHES_IN_WINDOW) {
    logApp(`[CRASH RECOVERY] Window ${windowId} has crashed ${record.count} times in ${CRASH_WINDOW_MS / 1000}s, not attempting recovery`)
    return false
  }

  return true
}

/**
 * Handle renderer process crash with recovery attempt
 */
function handleRendererCrash(
  windowId: WINDOW_ID,
  crashedWindow: BrowserWindow,
  details: Electron.RenderProcessGoneDetails,
  recreateWindow: () => BrowserWindow | void
): void {
  const crashInfo = {
    windowId,
    reason: details.reason,
    exitCode: details.exitCode,
    timestamp: new Date().toISOString(),
  }

  // Log to console (always, not just in debug mode)
  console.error(`[CRASH] Renderer process gone for ${windowId}:`, crashInfo)

  // Log to diagnostics service
  diagnosticsService.logError(
    "window",
    `Renderer process crashed: ${windowId}`,
    { ...crashInfo, details }
  )

  // IMMEDIATELY clear the crashed window from WINDOWS map to prevent
  // other code from attempting IPC against the dead webContents during
  // the recovery delay. This fixes the race condition where:
  // - whenPanelReady() might see isLoading()==false on dead webContents
  // - getWindowRendererHandlers() would return handlers for dead webContents
  WINDOWS.delete(windowId)

  // Also reset panel-specific ready state if the panel crashed
  if (windowId === "panel") {
    panelWebContentsReady = false
  }

  // Check if we should attempt recovery
  if (!shouldAttemptCrashRecovery(windowId)) {
    diagnosticsService.logError(
      "window",
      `Crash recovery disabled for ${windowId} due to repeated crashes`,
      crashInfo
    )
    // Still destroy the crashed window even if not recovering
    try {
      crashedWindow.destroy()
    } catch (e) {
      // Window may already be destroyed
    }
    return
  }

  logApp(`[CRASH RECOVERY] Attempting to recreate ${windowId} window after crash...`)

  // Delay before recreating to prevent rapid crash loops
  setTimeout(() => {
    // Re-check isQuitting inside timeout - app may have entered quit mode
    // after the crash event but before this delayed callback runs
    if (state.isQuitting) {
      logApp(`[CRASH RECOVERY] App is quitting, skipping recovery for ${windowId}`)
      // Still destroy the crashed window during quit
      try {
        crashedWindow.destroy()
      } catch (e) {
        // Window may already be destroyed
      }
      return
    }

    try {
      // Destroy the crashed window (already removed from WINDOWS map above)
      try {
        crashedWindow.destroy()
      } catch (e) {
        // Window may already be destroyed
      }

      // Recreate the window
      const newWin = recreateWindow()
      if (newWin) {
        logApp(`[CRASH RECOVERY] Successfully recreated ${windowId} window`)
        diagnosticsService.logInfo(
          "window",
          `Successfully recovered ${windowId} window after crash`,
          crashInfo
        )
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logApp(`[CRASH RECOVERY] Failed to recreate ${windowId} window:`, errorMsg)
      diagnosticsService.logError(
        "window",
        `Failed to recover ${windowId} window after crash`,
        { ...crashInfo, error: errorMsg }
      )
    }
  }, CRASH_RECOVERY_DELAY_MS)
}

// Track panel webContents ready state to avoid sending IPC before renderer is ready
let panelWebContentsReady = false

/**
 * Ensures the panel webContents is ready before executing a callback.
 * If already ready (not loading), executes immediately.
 * If still loading (e.g., right after app launch), waits for did-finish-load.
 */
function whenPanelReady(callback: () => void): void {
  const win = WINDOWS.get("panel")
  if (!win) return

  // If webContents is not loading, it's ready to receive IPC messages
  // This handles both cases:
  // 1. panelWebContentsReady is true (normal case after did-finish-load)
  // 2. panelWebContentsReady is false but did-finish-load already fired before we attached listener
  if (!win.webContents.isLoading()) {
    // Mark as ready in case the flag wasn't set (handles the race condition
    // where did-finish-load fired before createPanelWindow's listener was attached)
    panelWebContentsReady = true
    callback()
  } else {
    // Still loading, wait for the renderer to finish
    win.webContents.once("did-finish-load", () => {
      panelWebContentsReady = true
      callback()
    })
  }
}


function createBaseWindow({
  id,
  url,
  showWhenReady = true,
  windowOptions,
  onCrashRecreate,
}: {
  id: WINDOW_ID
  url?: string
  showWhenReady?: boolean
  windowOptions?: BrowserWindowConstructorOptions
  onCrashRecreate?: () => BrowserWindow | void
}) {
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'win32' && {
      icon: path.join(process.resourcesPath, 'icon.ico')
    }),
    ...windowOptions,
    webPreferences: {
      ...windowOptions?.webPreferences,
      preload: path.join(__dirname, "../preload/index.cjs"),
      sandbox: true,
    },
  })

  WINDOWS.set(id, win)

  setupConsoleLogger(win, id)

  const _label = id.toUpperCase()
  win.on("show", () => logUI(`[WINDOW ${_label}] show`))
  win.on("hide", () => logUI(`[WINDOW ${_label}] hide`))
  win.on("minimize", () => logUI(`[WINDOW ${_label}] minimize`))
  win.on("restore", () => logUI(`[WINDOW ${_label}] restore`))
  win.on("focus", () => logUI(`[WINDOW ${_label}] focus`))
  win.on("blur", () => logUI(`[WINDOW ${_label}] blur`))

  if (showWhenReady) {
    win.on("ready-to-show", () => {
      win.show()
    })
  }

  win.on("close", () => {
    logUI(`[WINDOW ${_label}] close`)
    WINDOWS.delete(id)
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  // Handle renderer process crashes with recovery attempt
  if (onCrashRecreate) {
    win.webContents.on("render-process-gone", (_event, details) => {
      // Only attempt recovery for crash reasons (not clean exit)
      // Also skip recovery if app is quitting - SIGTERM during shutdown is not a crash
      if (details.reason !== "clean-exit" && !state.isQuitting) {
        handleRendererCrash(id, win, details, onCrashRecreate)
      }
    })
  }

  const baseUrl = import.meta.env.PROD
    ? "assets://app"
    : process.env["ELECTRON_RENDERER_URL"]

  const fullUrl = `${baseUrl}${url || ""}`
  win.loadURL(fullUrl)

  return win
}

export function createMainWindow({ url }: { url?: string } = {}) {
  logApp("Creating main window...")
  const win = createBaseWindow({
    id: "main",
    url,
    windowOptions: {
      titleBarStyle: "hiddenInset",
    },
    // Enable crash recovery for main window
    onCrashRecreate: () => createMainWindow({ url }),
  })

  if (process.env.IS_MAC) {
    win.on("close", () => {
      if (configStore.get().hideDockIcon) {
        app.setActivationPolicy("accessory")
        app.dock.hide()
      }
    })

    win.on("show", () => {
      if (configStore.get().hideDockIcon && !app.dock.isVisible()) {
        app.dock.show()
        // Reset activation policy to "regular" so app appears in Command+Tab
        app.setActivationPolicy("regular")
      }
    })
  }

  return win
}

export function createSetupWindow() {
  const win = createBaseWindow({
    id: "setup",
    url: "/setup",
    windowOptions: {
      titleBarStyle: "hiddenInset",
      width: 800,
      height: 600,
      resizable: false,
    },
    // Enable crash recovery for setup window
    onCrashRecreate: () => createSetupWindow(),
  })

  return win
}

export function showMainWindow(url?: string) {
  const win = WINDOWS.get("main")

  if (win) {
    win.show()
    if (url) {
      getRendererHandlers<RendererHandlers>(win.webContents).navigate.send(url)
    }
  } else {
    createMainWindow({ url })
  }
}

const VISUALIZER_BUFFER_LENGTH = 70
const WAVEFORM_BAR_WIDTH = 2
const WAVEFORM_GAP = 2 // gap-0.5 = 2px in Tailwind
const WAVEFORM_PADDING = 32 // px-4 = 16px on each side

// Calculate minimum width needed for waveform
const calculateMinWaveformWidth = () => {
  return (VISUALIZER_BUFFER_LENGTH * (WAVEFORM_BAR_WIDTH + WAVEFORM_GAP)) + WAVEFORM_PADDING
}

const MIN_WAVEFORM_WIDTH = calculateMinWaveformWidth() // ~172px

const panelWindowSize = {
  width: Math.max(260, MIN_WAVEFORM_WIDTH),
  height: 50,
}

const agentPanelWindowSize = {
  width: 600,
  height: 400,
}

const textInputPanelWindowSize = {
  width: 380,
  height: 180,
}

// Get the saved panel size (unified across all modes)
const getSavedPanelSize = () => {
  const config = configStore.get()

  logApp(`[window.ts] getSavedPanelSize - checking config...`)

  const validateSize = (savedSize: { width: number; height: number }) => {
    const maxWidth = 3000
    const maxHeight = 2000
    const minWidth = 200
    const minHeight = 100

    if (savedSize.width > maxWidth || savedSize.height > maxHeight) {
      logApp(`[window.ts] Saved size too large (${savedSize.width}x${savedSize.height}), using default:`, panelWindowSize)
      return panelWindowSize
    }

    if (savedSize.width < minWidth || savedSize.height < minHeight) {
      logApp(`[window.ts] Saved size too small (${savedSize.width}x${savedSize.height}), using default:`, panelWindowSize)
      return panelWindowSize
    }

    return savedSize
  }

  if (config.panelCustomSize) {
    logApp(`[window.ts] Found saved panel size:`, config.panelCustomSize)
    return validateSize(config.panelCustomSize)
  }

  logApp(`[window.ts] No saved panel size, using default:`, panelWindowSize)
  return panelWindowSize
}

// Unified size getter - mode parameter kept for API compatibility but ignored
const getSavedSizeForMode = (_mode: "normal" | "agent" | "textInput") => {
  return getSavedPanelSize()
}

const getPanelWindowPosition = (
  mode: "normal" | "agent" | "textInput" = "normal",
) => {
  const size = getSavedSizeForMode(mode)
  return calculatePanelPosition(size, mode)
}

// Ensure the panel stays above all windows and visible on all workspaces (esp. macOS)
function ensurePanelZOrder(win: BrowserWindow) {
  try {
    if (process.platform === "darwin") {
      // Show on all Spaces and above fullscreen apps
      try {
        // @ts-ignore - macOS-only options not in cross-platform typings
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      } catch (e) {
        logApp("[window.ts] setVisibleOnAllWorkspaces not supported:", e)
      }
      try {
        // Prefer NSModalPanel-like level for WM compatibility (Aerospace)
        // @ts-ignore - level arg is macOS-specific
        win.setAlwaysOnTop(true, "modal-panel", 1)
      } catch (e) {
        logApp("[window.ts] setAlwaysOnTop('modal-panel') failed, trying 'screen-saver':", e)
        try {
          // @ts-ignore - level arg is macOS-specific
          win.setAlwaysOnTop(true, "screen-saver")
        } catch (e2) {
          logApp("[window.ts] setAlwaysOnTop('screen-saver') failed, falling back to default:", e2)
          win.setAlwaysOnTop(true)
        }
      }
    } else {
      // Windows/Linux
      win.setAlwaysOnTop(true)
      try {
        win.setVisibleOnAllWorkspaces(true)

      } catch {}
    }
  } catch (error) {
    logApp("[window.ts] ensurePanelZOrder error:", error)
  }
}


// Adjust focusability based on panel mode to play nice with tiling WMs (e.g., Aerospace)
function setPanelFocusableForMode(win: BrowserWindow, mode: "normal"|"agent"|"textInput") {
  try {
    if (mode === "textInput") {
      win.setFocusable(true)
    } else {
      // Avoid stealing focus so tiling WMs treat it like a floating overlay
      win.setFocusable(false)
    }
  } catch (e) {
    logApp("[window.ts] setPanelFocusableForMode failed:", e)
  }
}


// Centralized panel mode management and deduped resize/apply
let _currentPanelMode: "normal" | "agent" | "textInput" = "normal"

type PanelBounds = { width: number; height: number; x: number; y: number }
let _lastApplied: { mode: "normal" | "agent" | "textInput"; ts: number; bounds?: PanelBounds } = {
  mode: "normal",
  ts: 0,
  bounds: undefined,
}

let _lastManualResizeTs = 0
export function markManualResize() {
  _lastManualResizeTs = Date.now()
}

function applyPanelMode(mode: "normal" | "agent" | "textInput") {
  const win = WINDOWS.get("panel")
  if (!win) return

  // Panel size is now unified across all modes
  // Mode switching only affects focus behavior and z-order, not size
  // Position is not updated on mode change - this is intentional since:
  // 1. Size is unified so position doesn't need adjustment for different dimensions
  // 2. User's custom positioning should be respected
  const now = Date.now()

  // Ensure minimum size is enforced (prevents OS-level resize below waveform requirements)
  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  try {
    win.setMinimumSize(minWidth, 100)
  } catch {}

  // Update focus behavior for the mode
  try {
    setPanelFocusableForMode(win, mode)
    ensurePanelZOrder(win)
  } catch {}

  // Track mode change for deduplication
  _lastApplied = {
    mode,
    ts: now,
    bounds: _lastApplied.bounds, // Keep existing bounds since we don't resize
  }
}

export function setPanelMode(mode: "normal" | "agent" | "textInput") {
  _currentPanelMode = mode
  applyPanelMode(mode)
}

export function getCurrentPanelMode(): "normal" | "agent" | "textInput" {
  return _currentPanelMode
}


export function createPanelWindow() {
  logApp("Creating panel window...")
  logApp("[window.ts] createPanelWindow - MIN_WAVEFORM_WIDTH:", MIN_WAVEFORM_WIDTH)

  const position = getPanelWindowPosition()
  logApp("[window.ts] createPanelWindow - position:", position)

  const savedSize = getSavedSizeForMode("normal")
  logApp("[window.ts] createPanelWindow - savedSize:", savedSize)

  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  logApp("[window.ts] createPanelWindow - minWidth:", minWidth)


  const win = createBaseWindow({
    id: "panel",
    url: "/panel",
    showWhenReady: false,
    windowOptions: {
      hiddenInMissionControl: true,
      skipTaskbar: true,
      closable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,

      frame: false,
      // transparent: true,
      paintWhenInitiallyHidden: true,
      // hasShadow: false,
      width: savedSize.width,
      height: savedSize.height,
      minWidth: minWidth, // Ensure minimum waveform width
      minHeight: 100, // Allow resizing down to minimum
      resizable: true, // Enable resizing
      focusable: false,

      visualEffectState: "active",
      vibrancy: "under-window",
      alwaysOnTop: true,
      x: position.x,
      y: position.y,
    },
    // Enable crash recovery for panel window
    onCrashRecreate: () => createPanelWindow(),
  })

  logApp("[window.ts] createPanelWindow - window created with size:", { width: savedSize.width, height: savedSize.height })

  // Track when the panel renderer is ready to receive IPC messages
  // Reset the ready flag since we're creating a new panel window
  panelWebContentsReady = false
  win.webContents.once("did-finish-load", () => {
    panelWebContentsReady = true
    logApp("[window.ts] Panel webContents finished loading, ready for IPC")
  })

  win.on("hide", () => {
    getRendererHandlers<RendererHandlers>(win.webContents).stopRecording.send()
  })

  // Reassert z-order on lifecycle changes
  win.on("show", () => ensurePanelZOrder(win))
  win.on("blur", () => ensurePanelZOrder(win))
  win.on("focus", () => ensurePanelZOrder(win))
  win.on("move", () => ensurePanelZOrder(win))
  win.on("resize", () => ensurePanelZOrder(win))


  // Ensure correct z-order for our panel-like window
  ensurePanelZOrder(win)

  return win
}

export function showPanelWindow() {
  const win = WINDOWS.get("panel")
  if (win) {
    logApp(`[showPanelWindow] Called. Current visibility: ${win.isVisible()}`)

    const mode = getCurrentPanelMode()
    // Apply mode sizing/positioning just before showing
    try { applyPanelMode(mode) } catch {}

    if (mode === "textInput") {
      logApp(`[showPanelWindow] Showing panel with show() for ${mode} mode`)
      win.show()
    } else {
      logApp(`[showPanelWindow] Showing panel with showInactive() for ${mode} mode`)
      win.showInactive()
      if (process.platform === "win32") {
        win.focus()
      }
    }

    ensurePanelZOrder(win)
  }
}

export async function showPanelWindowAndStartRecording(fromButtonClick?: boolean) {
  // Capture focus before showing panel
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }

  // Track button click state for global Enter key handling
  state.isRecordingFromButtonClick = fromButtonClick ?? false
  state.isRecordingMcpMode = false

  // Start mic capture/recording as early as possible, but only after panel renderer is ready
  // This prevents lost IPC messages right after app launch when webContents may not have finished loading
  // Pass fromButtonClick so panel shows correct submit hint (Enter vs Release keys)
  whenPanelReady(() => {
    getWindowRendererHandlers("panel")?.startRecording.send({ fromButtonClick })
  })
  showPanelWindow()
}

export async function showPanelWindowAndStartMcpRecording(conversationId?: string, sessionId?: string, fromTile?: boolean, fromButtonClick?: boolean) {
  // Capture focus before showing panel
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }

  // Track button click state for global Enter key handling
  state.isRecordingFromButtonClick = fromButtonClick ?? false
  state.isRecordingMcpMode = true

  // Ensure consistent sizing by setting mode in main before showing
  setPanelMode("normal")

  // Start mic capture/recording as early as possible, but only after panel renderer is ready
  // This prevents lost IPC messages right after app launch when webContents may not have finished loading
  // Pass fromTile and fromButtonClick flags so panel knows how to behave after recording ends
  whenPanelReady(() => {
    getWindowRendererHandlers("panel")?.startMcpRecording.send({ conversationId, sessionId, fromTile, fromButtonClick })
  })
  showPanelWindow()
}

export async function showPanelWindowAndShowTextInput() {
  // Capture focus before showing panel
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }

  // Set text input state first, then show panel (which will use correct positioning)
  state.isTextInputActive = true
  setPanelMode("textInput")
  showPanelWindow() // This will now use textInput mode positioning
  getWindowRendererHandlers("panel")?.showTextInput.send()
}

export function makePanelWindowClosable() {
  const panel = WINDOWS.get("panel")
  if (panel && !panel.isClosable()) {
    panel.setClosable(true)
  }
}

export const getWindowRendererHandlers = (id: WINDOW_ID) => {
  const win = WINDOWS.get(id)
  if (!win) return undefined
  return getRendererHandlers<RendererHandlers>(win.webContents)
}

export const stopRecordingAndHidePanelWindow = () => {
  const win = WINDOWS.get("panel")
  if (win) {
    // Reset button click state
    state.isRecordingFromButtonClick = false
    state.isRecordingMcpMode = false

    getRendererHandlers<RendererHandlers>(win.webContents).stopRecording.send()

    if (win.isVisible()) {
      win.hide()
    }
  }
}

export const stopTextInputAndHidePanelWindow = () => {
  const win = WINDOWS.get("panel")
  if (win) {
    state.isTextInputActive = false
    getRendererHandlers<RendererHandlers>(win.webContents).hideTextInput.send()

    if (win.isVisible()) {
      win.hide()
    }
  }
}

export const closeAgentModeAndHidePanelWindow = () => {
  const win = WINDOWS.get("panel")
  if (win) {
    // Update agent state
    state.isAgentModeActive = false
    state.shouldStopAgent = false
    state.agentIterationCount = 0

    // Hide the panel immediately to avoid flash when mode changes
    if (win.isVisible()) {
      win.hide()
    }

    // Clear agent progress after hiding to avoid triggering mode change while visible
    getRendererHandlers<RendererHandlers>(win.webContents).clearAgentProgress.send()
    // Suppress auto-show briefly to avoid immediate reopen from any trailing progress
    suppressPanelAutoShow(1000)
  }
}

export const emergencyStopAgentMode = async () => {
  logApp("Emergency stop triggered for agent mode")

  const win = WINDOWS.get("panel")
  if (win) {
    // Notify renderer ASAP
    getRendererHandlers<RendererHandlers>(win.webContents).emergencyStopAgent?.send()
    // Do NOT clear agent progress here; let the session emit its final 'stopped' update
    // to avoid stale/empty completion panels racing with progress clear.
  }

  try {
    const { before, after } = await emergencyStopAll()
    logApp(`Emergency stop completed. Killed ${before} processes. Remaining: ${after}`)
  } catch (error) {
    logApp("Error during emergency stop:", error)
  }

  // Keep panel open after emergency stop so user can:
  // 1. See the stopped state and any error messages
  // 2. Send follow-up messages to continue the conversation
  // 3. Have more granular control to steer the agent when things go wrong
  // The panel will show the "Stopped" state and the follow-up input remains active
  if (win) {
    // Suppress auto-show briefly to avoid immediate reopen from any trailing progress
    suppressPanelAutoShow(1000)
    // Make panel focusable so user can interact with the follow-up input
    setPanelFocusable(true)
  }
}

export function resizePanelForAgentMode() {
  setPanelMode("agent")
}

export function resizePanelForTextInput() {
  setPanelMode("textInput")
}

export function resizePanelToNormal() {
  setPanelMode("normal")
}

/**
 * Set the focusability of the panel window.
 * This is used to enable input interaction in agent mode when the agent has completed.
 * When agent is still running, the panel should be non-focusable to avoid stealing focus.
 * When agent is complete, the panel should be focusable so user can interact with the continue input.
 *
 * @param focusable - Whether the panel should be focusable
 * @param andFocus - If true and focusable is true, also focus the window. This is needed on macOS
 *                   because windows shown with showInactive() need to be explicitly focused to
 *                   receive input events, even after setFocusable(true).
 */
export function setPanelFocusable(focusable: boolean, andFocus: boolean = false) {
  const win = WINDOWS.get("panel")
  if (!win) return
  try {
    win.setFocusable(focusable)
    // On macOS, windows shown with showInactive() need explicit focus to receive input
    if (focusable && andFocus) {
      win.focus()
    }
  } catch (e) {
    logApp("[window.ts] setPanelFocusable failed:", e)
  }
}
