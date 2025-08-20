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
import { state, agentProcessManager } from "./state"
import { calculatePanelPosition } from "./panel-position"

type WINDOW_ID = "main" | "panel" | "setup"

export const WINDOWS = new Map<WINDOW_ID, BrowserWindow>()

// Helper function to add zoom functionality to any window
function addZoomHandling(win: BrowserWindow) {
  // Alternative zoom implementation using setZoomFactor
  const zoomIn = () => {
    const currentFactor = win.webContents.getZoomFactor();
    const newFactor = Math.min(currentFactor * 1.2, 5.0); // Max 5x zoom
    console.log(`Manual zoom in: ${currentFactor} -> ${newFactor}`);
    win.webContents.setZoomFactor(newFactor);
  };

  const zoomOut = () => {
    const currentFactor = win.webContents.getZoomFactor();
    const newFactor = Math.max(currentFactor / 1.2, 0.25); // Min 0.25x zoom
    console.log(`Manual zoom out: ${currentFactor} -> ${newFactor}`);
    win.webContents.setZoomFactor(newFactor);
  };

  const zoomReset = () => {
    console.log('Manual zoom reset to 1.0');
    win.webContents.setZoomFactor(1.0);
  };

  // Try using globalShortcut approach instead of before-input-event
  const { globalShortcut } = require('electron');

  // Register global shortcuts when window gains focus
  win.on('focus', () => {
    try {
      // Unregister first to avoid conflicts
      globalShortcut.unregister('CommandOrControl+=');
      globalShortcut.unregister('CommandOrControl+-');
      globalShortcut.unregister('CommandOrControl+0');

      // Register zoom shortcuts
      globalShortcut.register('CommandOrControl+=', () => {
        console.log('Global shortcut zoom in triggered');
        if (win.isFocused()) {
          zoomIn();
        }
      });

      globalShortcut.register('CommandOrControl+-', () => {
        console.log('Global shortcut zoom out triggered');
        if (win.isFocused()) {
          zoomOut();
        }
      });

      globalShortcut.register('CommandOrControl+0', () => {
        console.log('Global shortcut zoom reset triggered');
        if (win.isFocused()) {
          zoomReset();
        }
      });
    } catch (error) {
      console.error('Error registering global shortcuts:', error);
    }
  });

  // Unregister shortcuts when window loses focus
  win.on('blur', () => {
    try {
      globalShortcut.unregister('CommandOrControl+=');
      globalShortcut.unregister('CommandOrControl+-');
      globalShortcut.unregister('CommandOrControl+0');
    } catch (error) {
      console.error('Error unregistering global shortcuts:', error);
    }
  });

  // Explicitly handle zoom shortcuts for all windows
  win.webContents.on('before-input-event', (event, input) => {
    const isModifierPressed = input.meta || input.control;

    // Debug logging for zoom events
    if (isModifierPressed && (input.key === '=' || input.key === 'Equal' || input.key === '+' || input.key === '-' || input.key === '0')) {
      console.log('Zoom event received:', {
        key: input.key,
        meta: input.meta,
        control: input.control,
        shift: input.shift,
        windowId: win.id
      });
    }

    // Zoom in: Meta/Ctrl + Plus/Equals (handles Cmd+= for zoom in)
    if (isModifierPressed && (input.key === '=' || input.key === 'Equal')) {
      console.log('Executing zoom in (=)');
      event.preventDefault();

      // Try both built-in method and manual fallback
      try {
        const currentZoom = win.webContents.getZoomLevel();
        const currentFactor = win.webContents.getZoomFactor();
        console.log('Current zoom - level:', currentZoom, 'factor:', currentFactor);

        // Try built-in method first
        win.webContents.zoomIn();

        // Also try manual method as fallback
        zoomIn();

        // Check result after a short delay
        setTimeout(() => {
          const newZoom = win.webContents.getZoomLevel();
          const newFactor = win.webContents.getZoomFactor();
          console.log('New zoom - level:', newZoom, 'factor:', newFactor);
        }, 100);
      } catch (error) {
        console.error('Error during zoom in:', error);
      }

      return;
    }

    // Zoom in: Meta/Ctrl + Plus with Shift (Cmd+Shift+=)
    if (isModifierPressed && input.shift && input.key === '+') {
      console.log('Executing zoom in (+)');
      event.preventDefault();

      try {
        win.webContents.zoomIn();
        zoomIn(); // Also try manual method
      } catch (error) {
        console.error('Error during zoom in (+):', error);
      }

      return;
    }

    // Zoom out: Meta/Ctrl + Minus
    if (isModifierPressed && input.key === '-') {
      console.log('Executing zoom out (-)');
      event.preventDefault();

      try {
        const currentZoom = win.webContents.getZoomLevel();
        const currentFactor = win.webContents.getZoomFactor();
        console.log('Current zoom - level:', currentZoom, 'factor:', currentFactor);

        win.webContents.zoomOut();
        zoomOut(); // Also try manual method

        setTimeout(() => {
          const newZoom = win.webContents.getZoomLevel();
          const newFactor = win.webContents.getZoomFactor();
          console.log('New zoom - level:', newZoom, 'factor:', newFactor);
        }, 100);
      } catch (error) {
        console.error('Error during zoom out:', error);
      }

      return;
    }

    // Zoom reset: Meta/Ctrl + 0
    if (isModifierPressed && input.key === '0') {
      console.log('Executing zoom reset (0)');
      event.preventDefault();

      try {
        win.webContents.setZoomLevel(0);
        zoomReset(); // Also try manual method

        setTimeout(() => {
          const newZoom = win.webContents.getZoomLevel();
          const newFactor = win.webContents.getZoomFactor();
          console.log('Reset zoom - level:', newZoom, 'factor:', newFactor);
        }, 100);
      } catch (error) {
        console.error('Error during zoom reset:', error);
      }

      return;
    }
  })
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

  // Add zoom handling to all windows
  addZoomHandling(win)

  // Add test zoom functionality via DevTools console
  if (import.meta.env.DEV) {
    win.webContents.once('dom-ready', () => {
      win.webContents.executeJavaScript(`
        window.testZoom = {
          zoomIn: () => {
            console.log('Test zoom in triggered from renderer');
            return window.electron.ipcRenderer.invoke('test-zoom-in');
          },
          zoomOut: () => {
            console.log('Test zoom out triggered from renderer');
            return window.electron.ipcRenderer.invoke('test-zoom-out');
          },
          zoomReset: () => {
            console.log('Test zoom reset triggered from renderer');
            return window.electron.ipcRenderer.invoke('test-zoom-reset');
          },
          getZoom: () => {
            return window.electron.ipcRenderer.invoke('get-zoom-info');
          }
        };
        console.log('Test zoom functions available: window.testZoom');
      `);
    });
  }

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
  width: 600,
  height: 400,
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

  // Note: Zoom handling is now handled by addZoomHandling() function above
  // Removed duplicate zoom handler to prevent conflicts

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

export const emergencyStopAgentMode = async () => {
  console.log("Emergency stop triggered for agent mode")

  // Set stop flag immediately
  state.shouldStopAgent = true

  const win = WINDOWS.get("panel")
  if (win) {
    // Send emergency stop signal to renderer
    getRendererHandlers<RendererHandlers>(
      win.webContents,
    ).emergencyStopAgent?.send()

    // Clear agent progress immediately
    getRendererHandlers<RendererHandlers>(
      win.webContents,
    ).clearAgentProgress.send()
  }

  try {
    const processCountBefore = agentProcessManager.getActiveProcessCount()

    // Kill all agent processes immediately (emergency stop)
    agentProcessManager.emergencyStop()

    const processCountAfter = agentProcessManager.getActiveProcessCount()

    // Update state - but keep shouldStopAgent = true so the agent loop can see it
    state.isAgentModeActive = false
    // DON'T reset shouldStopAgent here - let the agent loop handle it
    state.agentIterationCount = 0

    console.log(
      `Emergency stop completed. Killed ${processCountBefore} processes. Remaining: ${processCountAfter}`,
    )
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
    }, 100) // Shorter delay for emergency stop
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
