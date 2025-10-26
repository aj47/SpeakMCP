import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  shell,
  screen,
  app,
} from "electron"
import path from "path"
import { getRendererHandlers } from "@egoist/tipc/main"
import {
  makeKeyWindow,
  makePanel,
  makeWindow,
} from "@egoist/electron-panel-window"
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

  if (mode === "normal" && config.panelNormalModeSize) {
    return config.panelNormalModeSize
  } else if (mode === "agent" && config.panelAgentModeSize) {
    return config.panelAgentModeSize
  } else if (mode === "textInput" && config.panelTextInputModeSize) {
    return config.panelTextInputModeSize
  }

  // Return default sizes if no saved size
  if (mode === "agent") {
    return agentPanelWindowSize
  } else if (mode === "textInput") {
    return textInputPanelWindowSize
  }
  return panelWindowSize
}

const getPanelWindowPosition = (
  mode: "normal" | "agent" | "textInput" = "normal",
) => {
  const size = getSavedSizeForMode(mode)
  return calculatePanelPosition(size, mode)
}

export function createPanelWindow() {
  logApp("Creating panel window...")
  const position = getPanelWindowPosition()
  const savedSize = getSavedSizeForMode("normal")

  const win = createBaseWindow({
    id: "panel",
    url: "/panel",
    showWhenReady: false,
    windowOptions: {
      hiddenInMissionControl: true,
      skipTaskbar: true,
      closable: false,
      maximizable: false,
      frame: false,
      // transparent: true,
      paintWhenInitiallyHidden: true,
      // hasShadow: false,
      width: savedSize.width,
      height: savedSize.height,
      minWidth: Math.max(200, MIN_WAVEFORM_WIDTH), // Ensure minimum waveform width
      minHeight: 100, // Allow resizing down to minimum
      resizable: true, // Enable resizing
      visualEffectState: "active",
      vibrancy: "under-window",
      alwaysOnTop: true,
      x: position.x,
      y: position.y,
    },
  })

  win.on("hide", () => {
    getRendererHandlers<RendererHandlers>(win.webContents).stopRecording.send()
  })


  makePanel(win)

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
    win.showInactive()
    makeKeyWindow(win)

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
    makeWindow(panel)
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
    return
  }

  const savedSize = getSavedSizeForMode("agent")
  const position = getPanelWindowPosition("agent")

  // Update size constraints for agent mode (allow resizing)
  win.setMinimumSize(Math.max(200, MIN_WAVEFORM_WIDTH), 100) // Ensure minimum waveform width
  // Don't set maximum size to allow user resizing

  // Set size and position (use saved size if available)
  win.setSize(savedSize.width, savedSize.height, true) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true
}

export function resizePanelForTextInput() {
  const win = WINDOWS.get("panel")
  if (!win) {
    return
  }

  const savedSize = getSavedSizeForMode("textInput")
  const position = getPanelWindowPosition("textInput")

  // Update size constraints for text input mode (allow resizing)
  win.setMinimumSize(Math.max(200, MIN_WAVEFORM_WIDTH), 100) // Ensure minimum waveform width
  // Don't set maximum size to allow user resizing

  // Set size and position (use saved size if available)
  win.setSize(savedSize.width, savedSize.height, true) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true
}

export function resizePanelToNormal() {
  const win = WINDOWS.get("panel")
  if (!win) {
    return
  }

  const savedSize = getSavedSizeForMode("normal")
  const position = getPanelWindowPosition("normal")

  // Update size constraints back to normal (allow resizing)
  win.setMinimumSize(Math.max(200, MIN_WAVEFORM_WIDTH), 100) // Ensure minimum waveform width
  // Don't set maximum size to allow user resizing

  // Set size and position (use saved size if available)
  win.setSize(savedSize.width, savedSize.height, true) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true
}
