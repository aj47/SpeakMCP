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
import { configStore } from "./config"
import { getFocusedAppInfo } from "./keyboard"
import { state } from "./state"

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

const panelWindowSize = {
  width: 260,
  height: 50,
}

const agentPanelWindowSize = {
  width: 420,
  height: 240,
}

const textInputPanelWindowSize = {
  width: 380,
  height: 180,
}

const getPanelWindowPosition = (mode: 'normal' | 'agent' | 'textInput' = 'normal') => {
  // position the window top right
  const currentScreen = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  )
  const screenSize = currentScreen.workArea
  let size = panelWindowSize
  if (mode === 'agent') {
    size = agentPanelWindowSize
  } else if (mode === 'textInput') {
    size = textInputPanelWindowSize
  }

  const position = {
    x: Math.floor(
      screenSize.x + (screenSize.width - size.width) - 10,
    ),
    y: screenSize.y + 10,
  }

  return position
}

export function createPanelWindow() {
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
      maxWidth: panelWindowSize.width,
      maxHeight: panelWindowSize.height,
      minWidth: panelWindowSize.width,
      minHeight: panelWindowSize.height,
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
    let mode: 'normal' | 'agent' | 'textInput' = 'normal'
    if (state.isTextInputActive) {
      mode = 'textInput'
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
  if (!win) return
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
    // Clear agent progress and resize back to normal
    getRendererHandlers<RendererHandlers>(win.webContents).clearAgentProgress.send()
    resizePanelToNormal()

    // Hide the panel after a small delay to ensure resize completes
    setTimeout(() => {
      if (win.isVisible()) {
        win.hide()
      }
    }, 200)
  }
}

export function resizePanelForAgentMode() {
  const win = WINDOWS.get("panel")
  if (!win) {
    return
  }

  const position = getPanelWindowPosition('agent')

  // Update size constraints for agent mode
  win.setMinimumSize(agentPanelWindowSize.width, agentPanelWindowSize.height)
  win.setMaximumSize(agentPanelWindowSize.width, agentPanelWindowSize.height)

  // Set size and position
  win.setSize(agentPanelWindowSize.width, agentPanelWindowSize.height, true) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true


}

export function resizePanelForTextInput() {
  const win = WINDOWS.get("panel")
  if (!win) {
    return
  }

  const position = getPanelWindowPosition('textInput')

  // Update size constraints for text input mode
  win.setMinimumSize(textInputPanelWindowSize.width, textInputPanelWindowSize.height)
  win.setMaximumSize(textInputPanelWindowSize.width, textInputPanelWindowSize.height)

  // Set size and position
  win.setSize(textInputPanelWindowSize.width, textInputPanelWindowSize.height, true) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true

}

export function resizePanelToNormal() {
  const win = WINDOWS.get("panel")
  if (!win) {
    return
  }

  const position = getPanelWindowPosition('normal')

  // Update size constraints back to normal
  win.setMinimumSize(panelWindowSize.width, panelWindowSize.height)
  win.setMaximumSize(panelWindowSize.width, panelWindowSize.height)

  // Set size and position
  win.setSize(panelWindowSize.width, panelWindowSize.height, true) // animate = true
  win.setPosition(position.x, position.y, true) // animate = true


}
