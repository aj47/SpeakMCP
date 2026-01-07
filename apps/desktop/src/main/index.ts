import { app, Menu, Notification, dialog } from "electron"
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

// Enable CDP remote debugging port if REMOTE_DEBUGGING_PORT env variable is set
// This must be called before app.whenReady()
// Usage: REMOTE_DEBUGGING_PORT=9222 pnpm dev
if (process.env.REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.REMOTE_DEBUGGING_PORT)
}

// Linux/Wayland GPU compatibility fixes
// These must be set before app.whenReady()
if (process.platform === 'linux') {
  // Enable Ozone platform for native Wayland support
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,WaylandWindowDecorations')
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  // Disable GPU acceleration to avoid GBM/EGL issues on some Wayland compositors
  app.commandLine.appendSwitch('disable-gpu')
  // Use software rendering
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

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
	        logApp("Dock icon hidden on startup per user preference")
	      } else {
	        // Ensure dock is visible when hideDockIcon is false
	        // This handles the case where dock state persisted from a previous session
	        app.dock.show()
	        app.setActivationPolicy("regular")
	        logApp("Dock icon shown on startup per user preference")
	      }
	    } catch (e) {
	      logApp("Failed to apply hideDockIcon on startup:", e)
	    }
	  }


  logApp("Serve protocol registered")

  if (accessibilityGranted) {
    // Check if onboarding has been completed
    const cfg = configStore.get()
    const needsOnboarding = !cfg.onboardingCompleted

    if (needsOnboarding) {
      createMainWindow({ url: "/onboarding" })
      logApp("Main window created (showing onboarding)")
    } else {
      createMainWindow()
      logApp("Main window created")
    }
  } else {
    createSetupWindow()
    logApp("Setup window created (accessibility not granted)")
  }

  createPanelWindow()
  logApp("Panel window created")

  listenToKeyboardEvents()
  logApp("Keyboard event listener started")

  // Check Linux input group on startup and show notification if not in group
  if (process.platform === "linux") {
    checkLinuxInputGroup()
  }

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

/**
 * Check if the current user is in the 'input' group on Linux.
 * Shows a notification if not, as this is required for global hotkeys.
 */
function checkLinuxInputGroup(): void {
  try {
    const { execSync } = require("child_process")
    const username = process.env.USER || process.env.USERNAME || ""

    // Check if user is in input group using 'groups' command
    const groupsOutput = execSync("groups", { encoding: "utf-8" }).trim()
    const groups = groupsOutput.split(/\s+/)
    const inInputGroup = groups.includes("input")

    if (!inInputGroup) {
      logApp(`User '${username}' is not in 'input' group - global hotkeys may not work`)

      // Show notification after a short delay to let the app fully start
      setTimeout(() => {
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: "SpeakMCP: Setup Required for Hotkeys",
            body: "Global keyboard shortcuts require additional permissions on Linux. Click for details.",
            urgency: "normal",
          })
          notification.on("click", () => {
            dialog.showMessageBox({
              type: "info",
              title: "Global Hotkeys Setup Required",
              message: "To use global keyboard shortcuts on Linux, you need to add your user to the 'input' group.",
              detail: `Run this command in a terminal:\n\nsudo usermod -aG input ${username || "$USER"}\n\nThen log out and log back in for the change to take effect.\n\nThis is required because SpeakMCP needs to read keyboard events from /dev/input/ devices to detect hotkeys (works on both X11 and Wayland).`,
              buttons: ["OK"],
            })
          })
          notification.show()
        }
      }, 3000) // 3 second delay
    } else {
      logApp(`User '${username}' is in 'input' group - global hotkeys should work`)
    }
  } catch (error) {
    logApp("Failed to check input group membership:", error)
  }
}
