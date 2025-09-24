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
type AGENT_WINDOW_ID = `agent-${string}` // For agent windows with conversation IDs

export const WINDOWS = new Map<WINDOW_ID, BrowserWindow>()
export const AGENT_WINDOWS = new Map<AGENT_WINDOW_ID, BrowserWindow>()


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

export function createAgentWindow(conversationId: string) {
  logApp(`Creating agent window for conversation ${conversationId}...`)
  const agentWindowId: AGENT_WINDOW_ID = `agent-${conversationId}`

  // Calculate position with slight offset for multiple windows
  const existingAgentWindows = Array.from(AGENT_WINDOWS.keys())
  const offset = existingAgentWindows.length * 30 // 30px offset for each new window

  const win = new BrowserWindow({
    width: agentWindowSize.width,
    height: agentWindowSize.height,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    x: 100 + offset,
    y: 100 + offset,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      sandbox: false,
    },
  })

  AGENT_WINDOWS.set(agentWindowId, win)

  win.on("ready-to-show", () => {
    win.show()
  })

  win.on("close", () => {
    AGENT_WINDOWS.delete(agentWindowId)
    // Clean up any agent state for this conversation
    if (state.isAgentModeActive) {
      // Only clean up global state if this was the last agent window
      if (AGENT_WINDOWS.size === 0) {
        state.isAgentModeActive = false
        state.shouldStopAgent = false
        state.agentIterationCount = 0
      }
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  const baseUrl = import.meta.env.PROD
    ? "assets://app"
    : process.env["ELECTRON_RENDERER_URL"]

  const fullUrl = `${baseUrl}/agent?conversationId=${conversationId}`
  win.loadURL(fullUrl)

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

const panelWindowSize = {
  width: 260,
  height: 50,
}

const agentPanelWindowSize = {
  width: 600,
  height: 400,
}

const agentWindowSize = {
  width: 800,
  height: 600,
}

const textInputPanelWindowSize = {
  width: 380,
  height: 180,
}

const getPanelWindowPosition = (
  mode: "normal" | "agent" | "textInput" = "normal",
) => {
  let size = panelWindowSize
  if (mode === "agent") {
    size = agentPanelWindowSize
  } else if (mode === "textInput") {
    size = textInputPanelWindowSize
  }

  return calculatePanelPosition(size, mode)
}

export function createPanelWindow() {
  logApp("Creating panel window...")
  const position = getPanelWindowPosition()

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
      width: panelWindowSize.width,
      height: panelWindowSize.height,
      minWidth: 200, // Allow resizing down to minimum
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

export function showAgentWindow(conversationId: string) {
  const agentWindowId: AGENT_WINDOW_ID = `agent-${conversationId}`
  const existingWin = AGENT_WINDOWS.get(agentWindowId)

  if (existingWin) {
    existingWin.show()
    existingWin.focus()
    return existingWin
  } else {
    return createAgentWindow(conversationId)
  }
}

export function closeAgentWindow(conversationId: string) {
  const agentWindowId: AGENT_WINDOW_ID = `agent-${conversationId}`
  const win = AGENT_WINDOWS.get(agentWindowId)

  if (win) {
    win.close()
  }
}

export function closeAllAgentWindows() {
  const agentWindows = Array.from(AGENT_WINDOWS.values())
  agentWindows.forEach(win => win.close())
}

export function getAgentWindow(conversationId: string): BrowserWindow | undefined {
  const agentWindowId: AGENT_WINDOW_ID = `agent-${conversationId}`
  return AGENT_WINDOWS.get(agentWindowId)
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

  const position = getPanelWindowPosition("agent")

  // Update size constraints for agent mode (allow resizing)
  win.setMinimumSize(200, 100) // Keep minimum constraints
  // Don't set maximum size to allow user resizing

  // Set size and position
  win.setSize(agentPanelWindowSize.width, agentPanelWindowSize.height, true) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true
}

export function resizePanelForTextInput() {
  const win = WINDOWS.get("panel")
  if (!win) {
    return
  }

  const position = getPanelWindowPosition("textInput")

  // Update size constraints for text input mode (allow resizing)
  win.setMinimumSize(200, 100) // Keep minimum constraints
  // Don't set maximum size to allow user resizing

  // Set size and position
  win.setSize(
    textInputPanelWindowSize.width,
    textInputPanelWindowSize.height,
    true,
  ) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true
}

export function resizePanelToNormal() {
  const win = WINDOWS.get("panel")
  if (!win) {
    return
  }

  const position = getPanelWindowPosition("normal")

  // Update size constraints back to normal (allow resizing)
  win.setMinimumSize(200, 100) // Keep minimum constraints
  // Don't set maximum size to allow user resizing

  // Set size and position
  win.setSize(panelWindowSize.width, panelWindowSize.height, true) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true
}
