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

// macOS: track whether the app is quitting so we allow the main window to actually close.
// Without this, the main window hides on close (standard macOS behavior) to stay in Cmd+Tab.
let isAppQuitting = false

/**
 * Call from `before-quit` to allow windows to actually close during app quit.
 */
export function setAppQuitting() {
  isAppQuitting = true
}

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

  // Clear the flag on close for all platforms (not just macOS)
  // This ensures the flag doesn't stay true if main window is closed via tray on Windows/Linux
  win.on("close", () => {
    clearPanelOpenedWithMain()
  })

  if (process.env.IS_MAC) {
    // macOS: hide the main window instead of destroying it when the user closes it.
    // This keeps the app in the Cmd+Tab switcher and dock. The window is re-shown
    // via dock click (app "activate" event) or hotkey. Only allow actual close
    // during app quit (isAppQuitting).
    win.on("close", (e) => {
      if (!isAppQuitting) {
        e.preventDefault()
        win.hide()
        if (configStore.get().hideDockIcon) {
          app.setActivationPolicy("accessory")
          app.dock.hide()
        }
        return
      }
      // App is quitting — allow the close to proceed
      if (configStore.get().hideDockIcon) {
        app.setActivationPolicy("accessory")
        app.dock.hide()
      }
    })

    win.on("show", () => {
      // Always ensure dock icon and Cmd+Tab presence when main window is shown.
      // This fixes the icon going missing in the Cmd+Tab app switcher.
      // Even when hideDockIcon is enabled, we temporarily show the dock icon
      // while the window is visible so the user can Cmd+Tab to it.
      if (!app.dock.isVisible()) {
        app.dock.show()
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
// - Waveform: 64px (h-16)
// - Submit button + hint: 36px
// - Padding: ~26px
// Total: ~150px
export const WAVEFORM_MIN_HEIGHT = 150

// Minimum height for waveform panel with transcription preview:
// - Drag bar: 24px
// - Waveform (shrunk): 40px (h-10)
// - Preview text: ~32px (2 lines)
// - Submit button + hint: 36px
// - Padding/margins: ~28px
// Total: ~160px
export const WAVEFORM_WITH_PREVIEW_HEIGHT = 160

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

  const validateSize = (
    savedSize: { width: number; height: number },
    minHeight: number,
    fallbackSize: { width: number; height: number } = panelWindowSize,
    minWidth: number = Math.max(200, MIN_WAVEFORM_WIDTH),
  ) => {
    const maxWidth = 3000
    const maxHeight = 2000

    if (savedSize.width > maxWidth || savedSize.height > maxHeight) {
      logApp(`[window.ts] Saved size too large (${savedSize.width}x${savedSize.height}), using default:`, fallbackSize)
      return fallbackSize
    }

    if (savedSize.width < minWidth || savedSize.height < minHeight) {
      logApp(`[window.ts] Saved size too small (${savedSize.width}x${savedSize.height}), using default:`, fallbackSize)
      return fallbackSize
    }

    return savedSize
  }

  if (mode === "progress") {
    if (config.panelProgressSize) {
      logApp(`[window.ts] Found saved progress size:`, config.panelProgressSize)
      return validateSize(config.panelProgressSize, PROGRESS_MIN_HEIGHT, agentPanelWindowSize)
    }

    if (config.panelCustomSize) {
      // Migration fallback for users that had a single shared panel size before
      // progress-mode persistence existed.
      const migratedProgressSize = {
        width: config.panelCustomSize.width,
        height: Math.max(config.panelCustomSize.height, PROGRESS_MIN_HEIGHT),
      }
      logApp(`[window.ts] No saved progress size; using migrated panel size:`, migratedProgressSize)
      return validateSize(migratedProgressSize, PROGRESS_MIN_HEIGHT, agentPanelWindowSize)
    }

    logApp(`[window.ts] No saved progress size, using agent default:`, agentPanelWindowSize)
    return agentPanelWindowSize
  }

  // Waveform/text-input mode uses panelCustomSize
  if (config.panelCustomSize) {
    logApp(`[window.ts] Found saved panel size:`, config.panelCustomSize)
    return validateSize(config.panelCustomSize, WAVEFORM_MIN_HEIGHT, panelWindowSize)
  }

  logApp(`[window.ts] No saved panel size, using default:`, panelWindowSize)
  return panelWindowSize
}

const getSavedSizeForMode = (mode: "normal" | "agent" | "textInput") => {
  if (mode === "agent") {
    return getSavedPanelSize("progress")
  }
  return getSavedPanelSize("waveform")
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

  const now = Date.now()

  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  const minHeight =
    mode === "agent"
      ? PROGRESS_MIN_HEIGHT
      : mode === "textInput"
        ? TEXT_INPUT_MIN_HEIGHT
        : WAVEFORM_MIN_HEIGHT
  try {
    win.setMinimumSize(minWidth, minHeight)
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
  const previousMode = _currentPanelMode
  _currentPanelMode = mode
  applyPanelMode(mode)

  // When entering agent mode, restore progress-mode dimensions so waveform
  // resizes cannot leak into the progress layout.
  if (mode === "agent" && previousMode !== "agent") {
    const win = WINDOWS.get("panel")
    if (win) {
      try {
        const [currentWidth, currentHeight] = win.getSize()
        const savedSize = getSavedPanelSize("progress")
        const targetHeight = Math.max(savedSize.height, PROGRESS_MIN_HEIGHT)
        const targetWidth = Math.max(savedSize.width, MIN_WAVEFORM_WIDTH)
        if (currentHeight !== targetHeight || currentWidth !== targetWidth) {
          logApp(`[setPanelMode] Restoring progress size from ${currentWidth}x${currentHeight} to ${targetWidth}x${targetHeight}`)
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

export async function showPanelWindowAndStartMcpRecording(conversationId?: string, sessionId?: string, fromTile?: boolean, fromButtonClick?: boolean, conversationTitle?: string, isStillHeld?: () => boolean) {
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
    if (isStillHeld && !isStillHeld()) return
    getWindowRendererHandlers("panel")?.startMcpRecording.send({ conversationId, conversationTitle, sessionId, fromTile, fromButtonClick })
  })
  showPanelWindow()
}

export async function showPanelWindowAndShowTextInput(initialText?: string, conversationId?: string, conversationTitle?: string) {
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
  // Guard against early IPC loss right after app launch (mirrors recording start paths)
  whenPanelReady(() => {
    getWindowRendererHandlers("panel")?.showTextInput.send({ initialText, conversationId, conversationTitle })
  })
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
      // Clear the "opened with main" flag since panel is being hidden
      clearPanelOpenedWithMain()
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
  // This is needed after resizePanelForWaveform() shrinks it for recording mode.
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
 * Resize the panel to accommodate transcription preview text during recording.
 * Grows the panel from WAVEFORM_MIN_HEIGHT to WAVEFORM_WITH_PREVIEW_HEIGHT.
 * When showPreview is false, shrinks back to WAVEFORM_MIN_HEIGHT.
 */
export function resizePanelForWaveformPreview(showPreview: boolean) {
  const win = WINDOWS.get("panel")
  if (!win) return

  // Waveform preview resizing is only valid while recording in normal mode.
  // Ignore stale calls so progress/text-input layouts remain unaffected.
  if (_currentPanelMode !== "normal") {
    return
  }

  try {
    const [currentWidth, currentHeight] = win.getSize()
    const targetHeight = showPreview ? WAVEFORM_WITH_PREVIEW_HEIGHT : WAVEFORM_MIN_HEIGHT

    // Skip if already at target height
    if (currentHeight === targetHeight) return

    const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
    const newWidth = Math.max(currentWidth, minWidth)

    logApp(`[resizePanelForWaveformPreview] Resizing panel from ${currentWidth}x${currentHeight} to ${newWidth}x${targetHeight} (preview=${showPreview})`)

    win.setSize(newWidth, targetHeight)
    notifyPanelSizeChanged(newWidth, targetHeight)

    // Reposition to maintain the panel's anchor point
    const position = calculatePanelPosition({ width: newWidth, height: targetHeight }, "normal")
    win.setPosition(position.x, position.y)
  } catch (e) {
    logApp("[resizePanelForWaveformPreview] Failed to resize panel:", e)
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
