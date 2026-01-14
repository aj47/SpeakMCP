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

type WINDOW_ID = "main" | "panel" | "setup"

export const WINDOWS = new Map<WINDOW_ID, BrowserWindow>()

// Notify renderer of panel size changes from main process
function notifyPanelSizeChanged(width: number, height: number) {
  const win = WINDOWS.get("panel")
  if (!win) return

  whenPanelReady(() => {
    getRendererHandlers<RendererHandlers>(win.webContents).onPanelSizeChanged.send({ width, height })
  })
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
}: {
  id: WINDOW_ID
  url?: string
  showWhenReady?: boolean
  windowOptions?: BrowserWindowConstructorOptions
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
      logUI(`[WINDOW ${_label}] ready-to-show event fired`)
      win.show()
    })

    // Fallback for Linux/Wayland where ready-to-show may not fire reliably
    if (process.platform === "linux") {
      win.webContents.on("did-finish-load", () => {
        logUI(`[WINDOW ${_label}] did-finish-load event fired (Linux fallback)`)
        if (!win.isVisible()) {
          logUI(`[WINDOW ${_label}] Window not visible, forcing show`)
          win.show()
        }
      })
    }
  }

  win.on("close", () => {
    logUI(`[WINDOW ${_label}] close`)
    WINDOWS.delete(id)
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  const baseUrl = import.meta.env.PROD
    ? "assets://app"
    : process.env["ELECTRON_RENDERER_URL"]

  const fullUrl = `${baseUrl}${url || ""}`
  win.loadURL(fullUrl)

  return win
}

// Track whether panel was hidden due to main window focus (for restore on blur)
let panelHiddenByMainFocus = false

// Track whether panel was intentionally opened alongside main window
// When this is true, we don't hide panel when main window gains focus
let panelOpenedWithMain = false

// Exported for use in panel show event to reset stale flag
export function clearPanelHiddenByMainFocus() {
  panelHiddenByMainFocus = false
}

// Clear the "opened with main" flag when panel is explicitly hidden
export function clearPanelOpenedWithMain() {
  panelOpenedWithMain = false
}

// Set the "opened with main" flag when panel is shown while main is visible
function setPanelOpenedWithMain() {
  const main = WINDOWS.get("main")
  if (main && main.isVisible()) {
    panelOpenedWithMain = true
  }
}

export function createMainWindow({ url }: { url?: string } = {}) {
  logApp("Creating main window...")
  const win = createBaseWindow({
    id: "main",
    url,
    showWhenReady: true,
    windowOptions: {
      // titleBarStyle: "hiddenInset" is macOS-only, causes issues on Linux/Wayland
      ...(process.platform === "darwin" && { titleBarStyle: "hiddenInset" as const }),
    },
  })

  // Hide floating panel when main window is focused (if setting is enabled)
  // But skip hiding if panel was intentionally opened alongside main window
  win.on("focus", () => {
    const config = configStore.get()
    if (config.hidePanelWhenMainFocused !== false) {
      const panel = WINDOWS.get("panel")
      if (panel && panel.isVisible()) {
        // Don't hide panel if it was intentionally opened while main window is visible
        // This prevents the panel from closing during drag/button interactions
        if (panelOpenedWithMain) {
          logApp("[createMainWindow] Main window focused - skipping panel hide (panel opened with main)")
          return
        }
        logApp("[createMainWindow] Main window focused - hiding floating panel")
        panelHiddenByMainFocus = true
        panel.hide()
      }
    }
  })

  // Restore floating panel when main window loses focus (if it was hidden by focus)
  win.on("blur", () => {
    const config = configStore.get()
    if (config.hidePanelWhenMainFocused !== false && panelHiddenByMainFocus) {
      const panel = WINDOWS.get("panel")
      if (panel && !panel.isVisible()) {
        logApp("[createMainWindow] Main window blurred - restoring floating panel")
        panelHiddenByMainFocus = false
        // Use showInactive() directly to avoid stealing focus from other apps.
        // showPanelWindow() would call win.focus() on Windows which is undesirable
        // when the user is switching away from the main app.
        panel.showInactive()
        ensurePanelZOrder(panel)
      }
    }
  })

  // Clear "opened with main" flag when main window is hidden/closed
  // since the context of "panel opened alongside main" no longer applies
  win.on("hide", () => {
    clearPanelOpenedWithMain()
  })

  if (process.env.IS_MAC) {
    win.on("close", () => {
      clearPanelOpenedWithMain()
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
    showWhenReady: true,
    windowOptions: {
      // titleBarStyle: "hiddenInset" is macOS-only, causes issues on Linux/Wayland
      ...(process.platform === "darwin" && { titleBarStyle: "hiddenInset" as const }),
      width: 800,
      height: 600,
      resizable: false,
    },
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

export const MIN_WAVEFORM_WIDTH = calculateMinWaveformWidth() // ~312px

// Minimum height for waveform panel:
// - Drag bar: 24px
// - Waveform: 24px
// - Submit button + hint: 36px
// - Padding: ~26px
// Total: ~110px
export const WAVEFORM_MIN_HEIGHT = 110

// Minimum height for text input panel:
// - Hint text row: ~20px
// - Textarea: ~80px minimum for usability
// - Bottom bar (char count + buttons): ~28px
// - Padding (p-3 = 12px top + 12px bottom + gap-3 = 12px between)
// Total: ~160px minimum
export const TEXT_INPUT_MIN_HEIGHT = 160

// Minimum height for progress/agent view:
// - Header: ~40px
// - Progress content: ~100px
// - Follow-up input: ~40px
// - Padding: ~20px
// Total: ~200px
export const PROGRESS_MIN_HEIGHT = 200

const panelWindowSize = {
  width: Math.max(260, MIN_WAVEFORM_WIDTH),
  height: WAVEFORM_MIN_HEIGHT,
}

const agentPanelWindowSize = {
  width: 600,
  height: 400,
}

const textInputPanelWindowSize = {
  width: 380,
  height: 180,
}

// Get the saved panel size (mode-aware)
const getSavedPanelSize = (mode?: "waveform" | "progress") => {
  const config = configStore.get()

  logApp(`[window.ts] getSavedPanelSize - checking config for mode: ${mode || 'default'}...`)

  const validateSize = (savedSize: { width: number; height: number }, minHeight: number) => {
    const maxWidth = 3000
    const maxHeight = 2000
    const minWidth = 200

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

  // For progress mode, check panelProgressSize first
  if (mode === "progress" && config.panelProgressSize) {
    logApp(`[window.ts] Found saved progress size:`, config.panelProgressSize)
    return validateSize(config.panelProgressSize, PROGRESS_MIN_HEIGHT)
  }

  // Fall back to panelCustomSize for all modes
  if (config.panelCustomSize) {
    logApp(`[window.ts] Found saved panel size:`, config.panelCustomSize)
    return validateSize(config.panelCustomSize, WAVEFORM_MIN_HEIGHT)
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
  // Mode switching primarily affects focus behavior and z-order
  // Note: setPanelMode() may conditionally resize the panel when switching to
  // agent mode if the panel is too small (see below). This ensures the progress
  // pane has enough space after transitioning from waveform recording.
  const now = Date.now()

  // Ensure minimum size is enforced (prevents OS-level resize below waveform requirements)
  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  try {
    win.setMinimumSize(minWidth, WAVEFORM_MIN_HEIGHT)
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

  // When switching to agent mode, ensure panel is resized appropriately
  // This fixes the issue where panel stays at waveform size (110px) when
  // transitioning from voice input to progress pane (needs 200px+)
  // See: https://github.com/aj47/SpeakMCP/issues/913
  if (mode === "agent") {
    const win = WINDOWS.get("panel")
    if (win) {
      try {
        const [currentWidth, currentHeight] = win.getSize()
        // Only resize if panel is too small for agent mode
        if (currentHeight < PROGRESS_MIN_HEIGHT) {
          const savedSize = getSavedPanelSize("progress")
          const targetHeight = Math.max(savedSize.height, PROGRESS_MIN_HEIGHT)
          const targetWidth = Math.max(savedSize.width, currentWidth, MIN_WAVEFORM_WIDTH)
          logApp(`[setPanelMode] Panel too small for agent mode (${currentWidth}x${currentHeight}), resizing to ${targetWidth}x${targetHeight}`)
          win.setSize(targetWidth, targetHeight)
          notifyPanelSizeChanged(targetWidth, targetHeight)
          // Reposition to maintain the panel's anchor point
          const position = calculatePanelPosition({ width: targetWidth, height: targetHeight }, "agent")
          win.setPosition(position.x, position.y)
        }
      } catch (e) {
        logApp("[setPanelMode] Failed to resize panel for agent mode:", e)
      }
    }
  }
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
      // macOS-only options
      ...(process.platform === "darwin" && {
        hiddenInMissionControl: true,
        visualEffectState: "active" as const,
        vibrancy: "under-window" as const,
      }),
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
      minHeight: WAVEFORM_MIN_HEIGHT, // Allow compact waveform panel with reduced negative space
      resizable: true, // Enable resizing
      focusable: process.platform === "linux" ? true : false, // Linux needs focusable for window to display

      alwaysOnTop: true,
      x: position.x,
      y: position.y,
    },
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

  // Reassert z-order on lifecycle changes and reset stale focus-hide flag
  win.on("show", () => {
    ensurePanelZOrder(win)
    // Clear the flag when panel becomes visible through any means.
    // This prevents stale state if user manually shows panel while main is focused.
    clearPanelHiddenByMainFocus()
  })
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

    // Track that panel is being opened alongside main window (if main is visible)
    // This prevents panel from being hidden when main window regains focus during interactions
    setPanelOpenedWithMain()

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

  // Ensure consistent sizing by setting mode in main before showing
  // This prevents inheriting textInput mode's focus/show behavior from prior sessions
  setPanelMode("normal")

  // Resize panel to compact waveform size before showing
  // This fixes the issue where panel had too much negative space (#817)
  resizePanelForWaveform()

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

  // Resize panel to compact waveform size before showing
  // This fixes the issue where panel had too much negative space (#817)
  resizePanelForWaveform()

  // Start mic capture/recording as early as possible, but only after panel renderer is ready
  // This prevents lost IPC messages right after app launch when webContents may not have finished loading
  // Pass fromTile and fromButtonClick flags so panel knows how to behave after recording ends
  whenPanelReady(() => {
    getWindowRendererHandlers("panel")?.startMcpRecording.send({ conversationId, sessionId, fromTile, fromButtonClick })
  })
  showPanelWindow()
}

export async function showPanelWindowAndShowTextInput(initialText?: string) {
  // Capture focus before showing panel
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }

  // Set text input state first
  state.isTextInputActive = true

  // Resize panel for text input mode before showing
  // This fixes the issue where panel was too small after waveform recording (#840)
  resizePanelForTextInput()

  showPanelWindow() // This will now use textInput mode positioning
  getWindowRendererHandlers("panel")?.showTextInput.send({ initialText })
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
      // Clear the "opened with main" flag since panel is being hidden
      clearPanelOpenedWithMain()
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
      // Clear the "opened with main" flag since panel is being hidden
      clearPanelOpenedWithMain()
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

  // Resize panel back to saved size for agent mode
  // This is needed after resizePanelForWaveform() shrinks it to 80px
  const win = WINDOWS.get("panel")
  if (!win) return

  try {
    const savedSize = getSavedPanelSize("progress")
    const [currentWidth, currentHeight] = win.getSize()

    // Always restore to at least saved size or PROGRESS_MIN_HEIGHT
    const targetHeight = Math.max(savedSize.height, PROGRESS_MIN_HEIGHT)
    const targetWidth = Math.max(savedSize.width, MIN_WAVEFORM_WIDTH)

    // Only resize if dimensions actually differ (avoid unnecessary reposition)
    if (currentHeight !== targetHeight || currentWidth !== targetWidth) {
      logApp(`[resizePanelForAgentMode] Resizing panel from ${currentWidth}x${currentHeight} to ${targetWidth}x${targetHeight}`)
      win.setSize(targetWidth, targetHeight)
      // Notify renderer of the size change
      notifyPanelSizeChanged(targetWidth, targetHeight)

      // Reposition to maintain the panel's anchor point
      const position = calculatePanelPosition({ width: targetWidth, height: targetHeight }, "agent")
      win.setPosition(position.x, position.y)
    }
  } catch (e) {
    logApp("[resizePanelForAgentMode] Failed to resize panel:", e)
  }
}

/**
 * Resize the panel for text input mode.
 * This ensures the panel is at least TEXT_INPUT_MIN_HEIGHT tall for usability.
 * This fixes the issue where the panel was too small for text input after
 * being shrunk for waveform recording.
 * See: https://github.com/aj47/SpeakMCP/issues/840
 */
export function resizePanelForTextInput() {
  const win = WINDOWS.get("panel")
  if (!win) {
    setPanelMode("textInput")
    return
  }

  try {
    const [currentWidth, currentHeight] = win.getSize()
    const targetHeight = Math.max(currentHeight, TEXT_INPUT_MIN_HEIGHT)
    const targetWidth = Math.max(currentWidth, textInputPanelWindowSize.width)

    logApp(`[resizePanelForTextInput] Current size: ${currentWidth}x${currentHeight}, target: ${targetWidth}x${targetHeight}`)

    // Only resize if needed
    if (currentHeight < TEXT_INPUT_MIN_HEIGHT || currentWidth < textInputPanelWindowSize.width) {
      win.setSize(targetWidth, targetHeight)
      // Notify renderer of the size change
      notifyPanelSizeChanged(targetWidth, targetHeight)

      // Reposition to maintain the panel's anchor point
      const position = calculatePanelPosition({ width: targetWidth, height: targetHeight }, "textInput")
      win.setPosition(position.x, position.y)
    }

    setPanelMode("textInput")
  } catch (e) {
    logApp("[resizePanelForTextInput] Failed to resize panel:", e)
    setPanelMode("textInput")
  }
}

export function resizePanelToNormal() {
  setPanelMode("normal")
}

/**
 * Resize the panel to compact waveform size for recording.
 * This shrinks the panel height to WAVEFORM_MIN_HEIGHT while keeping the current width.
 * This fixes the issue where the panel had too much negative space when showing
 * the waveform after being sized for agent mode.
 * See: https://github.com/aj47/SpeakMCP/issues/817
 */
export function resizePanelForWaveform() {
  const win = WINDOWS.get("panel")
  if (!win) return

  try {
    const [currentWidth] = win.getSize()
    const targetHeight = WAVEFORM_MIN_HEIGHT

    // Keep the current width but shrink to waveform height
    const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
    const newWidth = Math.max(currentWidth, minWidth)

    logApp(`[resizePanelForWaveform] Resizing panel from current size to ${newWidth}x${targetHeight}`)

    win.setSize(newWidth, targetHeight)
    // Notify renderer of the size change
    notifyPanelSizeChanged(newWidth, targetHeight)

    // Reposition to maintain the panel's anchor point (e.g., bottom-right of screen)
    const position = calculatePanelPosition({ width: newWidth, height: targetHeight }, "normal")
    win.setPosition(position.x, position.y)
  } catch (e) {
    logApp("[resizePanelForWaveform] Failed to resize panel:", e)
  }
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
