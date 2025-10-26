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
import { logApp } from "./debug"
import { configStore } from "./config"
import { getFocusedAppInfo } from "./keyboard"
import { state, agentProcessManager } from "./state"
import { calculatePanelPosition } from "./panel-position"

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


  if (showWhenReady) {
    win.on("ready-to-show", () => {
      win.show()
    })
  }

  win.on("close", () => {
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

  console.log(`[window.ts] getSavedSizeForMode(${mode}) - checking config...`)

  if (mode === "normal" && config.panelNormalModeSize) {
    console.log(`[window.ts] Found saved normal mode size:`, config.panelNormalModeSize)
    return config.panelNormalModeSize
  } else if (mode === "agent" && config.panelAgentModeSize) {
    console.log(`[window.ts] Found saved agent mode size:`, config.panelAgentModeSize)
    return config.panelAgentModeSize
  } else if (mode === "textInput" && config.panelTextInputModeSize) {
    console.log(`[window.ts] Found saved textInput mode size:`, config.panelTextInputModeSize)
    return config.panelTextInputModeSize
  }

  // Return default sizes if no saved size
  if (mode === "agent") {
    console.log(`[window.ts] No saved agent mode size, using default:`, agentPanelWindowSize)
    return agentPanelWindowSize
  } else if (mode === "textInput") {
    console.log(`[window.ts] No saved textInput mode size, using default:`, textInputPanelWindowSize)
    return textInputPanelWindowSize
  }
  console.log(`[window.ts] No saved normal mode size, using default:`, panelWindowSize)
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
        console.warn("[window.ts] setVisibleOnAllWorkspaces not supported:", e)
      }
      try {
        // Prefer NSModalPanel-like level for WM compatibility (Aerospace)
        // @ts-ignore - level arg is macOS-specific
        win.setAlwaysOnTop(true, "modal-panel", 1)
      } catch (e) {
        console.warn("[window.ts] setAlwaysOnTop('modal-panel') failed, trying 'screen-saver':", e)
        try {
          // @ts-ignore - level arg is macOS-specific
          win.setAlwaysOnTop(true, "screen-saver")
        } catch (e2) {
          console.warn("[window.ts] setAlwaysOnTop('screen-saver') failed, falling back to default:", e2)
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
    console.error("[window.ts] ensurePanelZOrder error:", error)
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
    console.warn("[window.ts] setPanelFocusableForMode failed:", e)
  }
}


export function createPanelWindow() {
  logApp("Creating panel window...")
  console.log("[window.ts] createPanelWindow - MIN_WAVEFORM_WIDTH:", MIN_WAVEFORM_WIDTH)

  const position = getPanelWindowPosition()
  console.log("[window.ts] createPanelWindow - position:", position)

  const savedSize = getSavedSizeForMode("normal")
  console.log("[window.ts] createPanelWindow - savedSize:", savedSize)

  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  console.log("[window.ts] createPanelWindow - minWidth:", minWidth)


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

  console.log("[window.ts] createPanelWindow - window created with size:", { width: savedSize.width, height: savedSize.height })

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
    // Determine the correct mode based on current state
    let mode: "normal" | "agent" | "textInput" = "normal"
    if (state.isTextInputActive) {
      mode = "textInput"
    }
    // Note: Agent mode positioning is handled separately in resizePanelForAgentMode

    const position = getPanelWindowPosition(mode)

    win.setPosition(position.x, position.y)

    // Set focusability appropriate for the current mode before showing
    setPanelFocusableForMode(win, mode)

    win.showInactive()
    // Keep it floating above everything
    ensurePanelZOrder(win)

    // On Windows, we need to explicitly focus the window
    if (process.platform === "win32") {
      win.focus()
    }
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

export async function showPanelWindowAndStartMcpRecording() {
  // Capture focus before showing panel
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }

  showPanelWindow()
  getWindowRendererHandlers("panel")?.startMcpRecording.send()
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
  resizePanelForTextInput()
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
    resizePanelToNormal()

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

    // Clear agent progress and resize back to normal
    getRendererHandlers<RendererHandlers>(
      win.webContents,
    ).clearAgentProgress.send()
    resizePanelToNormal()

    // Hide the panel after a small delay to ensure resize completes
    setTimeout(() => {
      if (win.isVisible()) {
        win.hide()
      }
    }, 200)
  }
}

export const emergencyStopAgentMode = async () => {
  console.log("Emergency stop triggered for agent mode")

  const win = WINDOWS.get("panel")
  if (win) {
    // Notify renderer ASAP
    getRendererHandlers<RendererHandlers>(win.webContents).emergencyStopAgent?.send()
    getRendererHandlers<RendererHandlers>(win.webContents).clearAgentProgress.send()
  }

  try {
    const { emergencyStopAll } = await import("./emergency-stop")
    const { before, after } = await emergencyStopAll()
    console.log(`Emergency stop completed. Killed ${before} processes. Remaining: ${after}`)
  } catch (error) {
    console.error("Error during emergency stop:", error)
  }

  // Close panel and resize
  if (win) {
    resizePanelToNormal()
    setTimeout(() => {
      if (win.isVisible()) {
        win.hide()
      }
    }, 100)
  }
}

export function resizePanelForAgentMode() {
  const win = WINDOWS.get("panel")
  if (!win) {
    console.log("[window.ts] resizePanelForAgentMode - panel window not found")
    return
  }

  console.log("[window.ts] resizePanelForAgentMode - starting...")
  const savedSize = getSavedSizeForMode("agent")
  console.log("[window.ts] resizePanelForAgentMode - savedSize:", savedSize)

  const position = getPanelWindowPosition("agent")
  console.log("[window.ts] resizePanelForAgentMode - position:", position)

  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  console.log("[window.ts] resizePanelForAgentMode - setting minWidth:", minWidth)

  // Update size constraints for agent mode (allow resizing)
  win.setMinimumSize(minWidth, 100) // Ensure minimum waveform width
  // Don't set maximum size to allow user resizing

  // Set size and position (use saved size if available)
  console.log("[window.ts] resizePanelForAgentMode - setting size to:", savedSize)
  win.setSize(savedSize.width, savedSize.height, true) // animate = true

  console.log("[window.ts] resizePanelForAgentMode - setting position to:", position)
  win.setPosition(position.x, position.y, true) // animate = true

  // Maintain floating behavior after resize
  ensurePanelZOrder(win)

  // Set focus behavior for agent mode
  setPanelFocusableForMode(win, "agent")

}

export function resizePanelForTextInput() {
  const win = WINDOWS.get("panel")
  if (!win) {
    console.log("[window.ts] resizePanelForTextInput - panel window not found")
    return
  }

  console.log("[window.ts] resizePanelForTextInput - starting...")
  const savedSize = getSavedSizeForMode("textInput")
  console.log("[window.ts] resizePanelForTextInput - savedSize:", savedSize)

  const position = getPanelWindowPosition("textInput")
  console.log("[window.ts] resizePanelForTextInput - position:", position)

  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  console.log("[window.ts] resizePanelForTextInput - setting minWidth:", minWidth)

  // Update size constraints for text input mode (allow resizing)
  win.setMinimumSize(minWidth, 100) // Ensure minimum waveform width
  // Don't set maximum size to allow user resizing

  // Set size and position (use saved size if available)
  console.log("[window.ts] resizePanelForTextInput - setting size to:", savedSize)
  win.setSize(savedSize.width, savedSize.height, true) // animate = true

  console.log("[window.ts] resizePanelForTextInput - setting position to:", position)
  win.setPosition(position.x, position.y, true) // animate = true

  // Focus and allow keyboard input for text input mode
  setPanelFocusableForMode(win, "textInput")
  try { win.focus() } catch {}

  // Maintain floating behavior after resize
  ensurePanelZOrder(win)

}

export function resizePanelToNormal() {
  const win = WINDOWS.get("panel")
  if (!win) {
    console.log("[window.ts] resizePanelToNormal - panel window not found")
    return
  }

  console.log("[window.ts] resizePanelToNormal - starting...")
  const savedSize = getSavedSizeForMode("normal")
  console.log("[window.ts] resizePanelToNormal - savedSize:", savedSize)

  const position = getPanelWindowPosition("normal")
  console.log("[window.ts] resizePanelToNormal - position:", position)

  const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
  console.log("[window.ts] resizePanelToNormal - setting minWidth:", minWidth)

  // Update size constraints back to normal (allow resizing)
  win.setMinimumSize(minWidth, 100) // Ensure minimum waveform width
  // Don't set maximum size to allow user resizing

  // Set size and position (use saved size if available)
  console.log("[window.ts] resizePanelToNormal - setting size to:", savedSize)
  // Set focus behavior for normal mode
  setPanelFocusableForMode(win, "normal")

  win.setSize(savedSize.width, savedSize.height, true) // animate = true

  console.log("[window.ts] resizePanelToNormal - setting position to:", position)
  win.setPosition(position.x, position.y, true) // animate = true

  // Maintain floating behavior after resize
  ensurePanelZOrder(win)

}
