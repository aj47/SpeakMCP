import { app, Menu } from "electron"
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
import { initDebugFlags } from "./debug"
import { appLogger } from "./logger"
import { initializeDeepLinkHandling } from "./oauth-deeplink-handler"
import { diagnosticsService } from "./diagnostics"

import { configStore } from "./config"
import { startRemoteServer } from "./remote-server"

const log = appLogger

// Enable CDP remote debugging port if REMOTE_DEBUGGING_PORT env variable is set
// This must be called before app.whenReady()
// Usage: REMOTE_DEBUGGING_PORT=9222 pnpm dev
if (process.env.REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.REMOTE_DEBUGGING_PORT)
}

registerServeSchema()

app.whenReady().then(() => {
  initDebugFlags(process.argv)
  log.info({ version: process.env.APP_VERSION }, "SpeakMCP starting up")

  initializeDeepLinkHandling()
  log.info("Deep link handling initialized")

  electronApp.setAppUserModelId(process.env.APP_ID)

  const accessibilityGranted = isAccessibilityGranted()
  log.info({ accessibilityGranted }, "Accessibility check completed")

  Menu.setApplicationMenu(createAppMenu())
  log.info("Application menu created")

  registerIpcMain(router)
  log.info("IPC main registered")

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

	  // Apply hideDockIcon setting on startup (macOS only)
	  if (process.platform === "darwin") {
	    try {
	      const cfg = configStore.get()
	      if (cfg.hideDockIcon) {
	        app.setActivationPolicy("accessory")
	        app.dock.hide()
	        log.info({ hideDockIcon: true }, "Dock icon hidden on startup per user preference")
	      } else {
	        // Ensure dock is visible when hideDockIcon is false
	        // This handles the case where dock state persisted from a previous session
	        app.dock.show()
	        app.setActivationPolicy("regular")
	        log.info({ hideDockIcon: false }, "Dock icon shown on startup per user preference")
	      }
	    } catch (e) {
	      log.error({ error: e }, "Failed to apply hideDockIcon on startup")
	    }
	  }


  log.info("Serve protocol registered")

  if (accessibilityGranted) {
    // Check if onboarding has been completed
    const cfg = configStore.get()
    const needsOnboarding = !cfg.onboardingCompleted

    if (needsOnboarding) {
      createMainWindow({ url: "/onboarding" })
      log.info({ showOnboarding: true }, "Main window created")
    } else {
      createMainWindow()
      log.info("Main window created")
    }
  } else {
    createSetupWindow()
    log.info("Setup window created (accessibility not granted)")
  }

  createPanelWindow()
  log.info("Panel window created")

  listenToKeyboardEvents()
  log.info("Keyboard event listener started")

  initTray()
  log.info("System tray initialized")

  mcpService
    .initialize()
    .then(() => {
      log.info("MCP service initialized successfully")
    })
    .catch((error) => {
      diagnosticsService.logError(
        "mcp-service",
        "Failed to initialize MCP service on startup",
        error
      )
      log.error({ error }, "Failed to initialize MCP service on startup")
    })

	  try {
	    const cfg = configStore.get()
	    if (cfg.remoteServerEnabled) {
	      startRemoteServer()
	        .then(() => log.info("Remote server started"))
	        .catch((err) =>
	          log.error({ error: err }, "Remote server failed to start")
	        )
	    }
	  } catch (_e) {}



  import("./updater").then((res) => res.init()).catch((err) => log.error({ error: err }, "Failed to initialize updater"))

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on("activate", function () {
    if (accessibilityGranted) {
      if (!WINDOWS.get("main")) {
        // Check if onboarding has been completed
        const cfg = configStore.get()
        const needsOnboarding = !cfg.onboardingCompleted

        if (needsOnboarding) {
          createMainWindow({ url: "/onboarding" })
        } else {
          createMainWindow()
        }
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
