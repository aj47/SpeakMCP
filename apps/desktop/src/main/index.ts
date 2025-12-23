import { app, Menu, ipcMain, desktopCapturer } from "electron"
import { electronApp, optimizer } from "@electron-toolkit/utils"
import {
  createMainWindow,
  createPanelWindow,
  createSetupWindow,
  makePanelWindowClosable,
  WINDOWS,
} from "./window"
import { listenToKeyboardEvents } from "./keyboard"
import { registerIpcMain } from "@egoist/tipc/main"
import { router } from "./tipc"
import { registerServeProtocol, registerServeSchema } from "./serve"
import { createAppMenu } from "./menu"
import { initTray } from "./tray"
import { isAccessibilityGranted } from "./utils"
import { mcpService } from "./mcp-service"
import { initDebugFlags, logApp } from "./debug"
import { initializeDeepLinkHandling } from "./oauth-deeplink-handler"
import { diagnosticsService } from "./diagnostics"

import { configStore } from "./config"
import { startRemoteServer } from "./remote-server"

registerServeSchema()

app.whenReady().then(() => {
  initDebugFlags(process.argv)
  logApp("SpeakMCP starting up...")

  initializeDeepLinkHandling()
  logApp("Deep link handling initialized")

  electronApp.setAppUserModelId(process.env.APP_ID)

  const accessibilityGranted = isAccessibilityGranted()
  logApp(`Accessibility granted: ${accessibilityGranted}`)

  Menu.setApplicationMenu(createAppMenu())
  logApp("Application menu created")

  registerIpcMain(router)
  logApp("IPC main registered")

  // Register desktopCapturer handler (available only in main process in Electron 31+)
  ipcMain.handle('getScreenSources', async (_event, options: { types: ('screen' | 'window')[], thumbnailSize?: { width: number, height: number } }) => {
    try {
      // Validate and sanitize options
      const validatedOptions = {
        // Only allow 'screen' type for privacy - filter out 'window'
        types: (options.types || ['screen']).filter(t => t === 'screen') as ('screen' | 'window')[],
        thumbnailSize: {
          // Clamp dimensions to reasonable bounds
          width: Math.min(Math.max(options.thumbnailSize?.width || 1920, 100), 4096),
          height: Math.min(Math.max(options.thumbnailSize?.height || 1080, 100), 4096)
        }
      }

      // Ensure at least 'screen' type is present
      if (validatedOptions.types.length === 0) {
        validatedOptions.types = ['screen']
      }

      logApp('[getScreenSources] Capturing screen sources with validated options:', JSON.stringify(validatedOptions))
      const sources = await desktopCapturer.getSources(validatedOptions)
      logApp(`[getScreenSources] Got ${sources.length} sources`)

      // On macOS, if Screen Recording permission is not granted, desktopCapturer returns an empty array
      // This is a silent failure - no error is thrown
      if (sources.length === 0 && process.platform === 'darwin') {
        throw new Error('No screen sources available. Please grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording, then restart the app.')
      }

      // Serialize the sources - NativeImage thumbnail needs to be converted
      const serialized = sources.map(source => {
        const thumbnailDataUrl = source.thumbnail.toDataURL()
        logApp(`[getScreenSources] Source: ${source.name}, thumbnail size: ${thumbnailDataUrl.length} chars`)
        return {
          id: source.id,
          name: source.name,
          thumbnail: thumbnailDataUrl,
          display_id: source.display_id,
          appIcon: source.appIcon ? source.appIcon.toDataURL() : null
        }
      })
      return serialized
    } catch (error) {
      console.error('Failed to get screen sources:', error)
      throw error
    }
  })

  registerServeProtocol()

	  try {
	    if ((process.env.NODE_ENV === "production" || !process.env.ELECTRON_RENDERER_URL) && process.platform !== "linux") {
	      const cfg = configStore.get()
	      app.setLoginItemSettings({
	        openAtLogin: !!cfg.launchAtLogin,
	        openAsHidden: true,
	      })
	    }
	  } catch (_) {}


  logApp("Serve protocol registered")

  if (accessibilityGranted) {
    createMainWindow()
    logApp("Main window created")
  } else {
    createSetupWindow()
    logApp("Setup window created (accessibility not granted)")
  }

  createPanelWindow()
  logApp("Panel window created")

  listenToKeyboardEvents()
  logApp("Keyboard event listener started")

  initTray()
  logApp("System tray initialized")

  mcpService
    .initialize()
    .then(() => {
      logApp("MCP service initialized successfully")
    })
    .catch((error) => {
      diagnosticsService.logError(
        "mcp-service",
        "Failed to initialize MCP service on startup",
        error
      )
      logApp("Failed to initialize MCP service on startup:", error)
    })

	  try {
	    const cfg = configStore.get()
	    if (cfg.remoteServerEnabled) {
	      startRemoteServer()
	        .then(() => logApp("Remote server started"))
	        .catch((err) =>
	          logApp(
	            `Remote server failed to start: ${err instanceof Error ? err.message : String(err)}`,
	          ),
	        )
	    }
	  } catch (_e) {}



  import("./updater").then((res) => res.init()).catch(console.error)

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on("activate", function () {
    if (accessibilityGranted) {
      if (!WINDOWS.get("main")) {
        createMainWindow()
      }
    } else {
      if (!WINDOWS.get("setup")) {
        createSetupWindow()
      }
    }
  })

  app.on("before-quit", () => {
    makePanelWindowClosable()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
