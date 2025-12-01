import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  shell,
  screen,
  app,
} from "electron"
import path from "path"
import { getRendererHandlers } from "@egoist/tipc/main"
// Removed dependency on @egoist/electron-panel-window
import { RendererHandlers } from "./renderer-handlers"
import { logApp, logUI } from "./debug"
import { configStore } from "./config"
import { getFocusedAppInfo } from "./keyboard"
import { state, agentProcessManager, suppressPanelAutoShow } from "./state"
import { calculatePanelPosition } from "./panel-position"
import { setupConsoleLogger } from "./console-logger"

type WINDOW_ID = "main" | "panel" | "setup"

export const WINDOWS = new Map<WINDOW_ID, BrowserWindow>()


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
  // Create the browser window.
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
      preload: path.join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      ...windowOptions?.webPreferences,
    },
  })

  WINDOWS.set(id, win)

  // Setup console logger to capture renderer console messages
  setupConsoleLogger(win, id)

  // Lightweight window lifecycle logging to diagnose unexpected hides/closes
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

// Waveform visualization constants (from panel.tsx)
const VISUALIZER_BUFFER_LENGTH = 70
const WAVEFORM_BAR_WIDTH = 2 // 0.5 (w-0.5) = 2px in Tailwind
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

// Get the saved size for a specific mode, or default size
const getSavedSizeForMode = (mode: "normal" | "agent" | "textInput") => {
  const config = configStore.get()

  logApp(`[window.ts] getSavedSizeForMode(${mode}) - checking config...`)

  // Helper to validate and cap saved sizes to reasonable maximums
  const validateSize = (savedSize: { width: number; height: number }, defaultSize: { width: number; height: number }) => {
    const maxWidth = 3000 // Maximum reasonable width
    const maxHeight = 2000 // Maximum reasonable height

    // For textInput mode, enforce stricter limits to prevent huge panels
    const maxTextInputWidth = 1200
    const maxTextInputHeight = 800

    if (mode === "textInput") {
      if (savedSize.width > maxTextInputWidth || savedSize.height > maxTextInputHeight) {
        logApp(`[window.ts] Saved textInput size too large (${savedSize.width}x${savedSize.height}), using default:`, defaultSize)
        return defaultSize
      }
    } else {
      if (savedSize.width > maxWidth || savedSize.height > maxHeight) {
        logApp(`[window.ts] Saved ${mode} size too large (${savedSize.width}x${savedSize.height}), using default:`, defaultSize)
        return defaultSize
      }
    }

    return savedSize
  }

  if (mode === "normal" && config.panelNormalModeSize) {
    logApp(`[window.ts] Found saved normal mode size:`, config.panelNormalModeSize)
    return validateSize(config.panelNormalModeSize, panelWindowSize)
  } else if (mode === "agent" && config.panelAgentModeSize) {
    logApp(`[window.ts] Found saved agent mode size:`, config.panelAgentModeSize)
    return validateSize(config.panelAgentModeSize, agentPanelWindowSize)
  } else if (mode === "textInput" && config.panelTextInputModeSize) {
    logApp(`[window.ts] Found saved textInput mode size:`, config.panelTextInputModeSize)
    return validateSize(config.panelTextInputModeSize, textInputPanelWindowSize)
  }

  // Return default sizes if no saved size
  if (mode === "agent") {
    logApp(`[window.ts] No saved agent mode size, using default:`, agentPanelWindowSize)
    return agentPanelWindowSize
  } else if (mode === "textInput") {
    logApp(`[window.ts] No saved textInput mode size, using default:`, textInputPanelWindowSize)
    return textInputPanelWindowSize
  }
  logApp(`[window.ts] No saved normal mode size, using default:`, panelWindowSize)
  return panelWindowSize
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

  const savedSize = getSavedSizeForMode(mode)
  const position = getPanelWindowPosition(mode)

  // Deduplicate: if same target applied very recently, skip
  const now = Date.now()

  // If user just manually resized, don't fight them; only adjust focusability/z-order
  if (now - _lastManualResizeTs < 1000) {
    try {
      setPanelFocusableForMode(win, mode)
      ensurePanelZOrder(win)
    } catch {}
    return
  }

  const sameTarget =
    _lastApplied.mode === mode &&
    _lastApplied.bounds &&
    _lastApplied.bounds.width === savedSize.width &&
    _lastApplied.bounds.height === savedSize.height &&
    _lastApplied.bounds.x === position.x &&
    _lastApplied.bounds.y === position.y

  if (sameTarget && now - _lastApplied.ts < 300) {
    return
  }

  // If current bounds already match target exactly, also skip
  try {
    const b = win.getBounds()
    if (
      b.width === savedSize.width &&
      b.height === savedSize.height &&
      b.x === position.x &&
      b.y === position.y
    ) {
      // Still ensure focus behavior is correct for mode
      setPanelFocusableForMode(win, mode)
      ensurePanelZOrder(win)
      _lastApplied = { mode, ts: now, bounds: { width: b.width, height: b.height, x: b.x, y: b.y } }
      return
    }
  } catch {}

  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  win.setMinimumSize(minWidth, 100)

  // Set focus behavior for mode before resizing
  setPanelFocusableForMode(win, mode)

  // Apply size and position; animate only if visible to avoid flicker
  const animate = win.isVisible()
  win.setSize(savedSize.width, savedSize.height, animate)
  win.setPosition(position.x, position.y, animate)

  ensurePanelZOrder(win)
  _lastApplied = {
    mode,
    ts: now,
    bounds: { width: savedSize.width, height: savedSize.height, x: position.x, y: position.y },
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
  })

  logApp("[window.ts] createPanelWindow - window created with size:", { width: savedSize.width, height: savedSize.height })

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

export async function showPanelWindowAndStartRecording() {
  // Capture focus before showing panel
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }

  showPanelWindow()
  getWindowRendererHandlers("panel")?.startRecording.send()
}

export async function showPanelWindowAndStartMcpRecording(conversationId?: string) {
  // Capture focus before showing panel
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }

  // Ensure consistent sizing by setting mode in main before showing
  setPanelMode("normal")
  showPanelWindow()
  getWindowRendererHandlers("panel")?.startMcpRecording.send(conversationId)
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
    const { emergencyStopAll } = await import("./emergency-stop")
    const { before, after } = await emergencyStopAll()
    logApp(`Emergency stop completed. Killed ${before} processes. Remaining: ${after}`)
  } catch (error) {
    logApp("Error during emergency stop:", error)
  }

  // Close panel immediately without resizing; next show will apply correct mode
  if (win) {
    // Suppress auto-show for a short cooldown so background progress doesn't re-open the panel
    suppressPanelAutoShow(1000)
    // Hide immediately for emergency stop - no delay to prevent race conditions
    // with any in-flight progress updates
    if (win.isVisible()) {
      win.hide()
    }
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
