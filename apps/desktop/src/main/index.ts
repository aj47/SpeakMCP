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
import { initDebugFlags, logApp } from "./debug"
import { initializeDeepLinkHandling } from "./oauth-deeplink-handler"
import { diagnosticsService } from "./diagnostics"

import { configStore } from "./config"
import { startRemoteServer } from "./remote-server"
import { initializeBundledSkills, skillsService } from "./skills-service"

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

  // Initialize bundled skills (copy from app resources to App Data if needed)
  // Then scan the skills folder to import any new skills into the registry
  try {
    const skillsResult = initializeBundledSkills()
    logApp(`Bundled skills: ${skillsResult.copied.length} copied, ${skillsResult.skipped.length} skipped`)

    // Scan the skills folder to import any new skills (including just-copied bundled skills)
    const importedSkills = skillsService.scanSkillsFolder()
    if (importedSkills.length > 0) {
      logApp(`Imported ${importedSkills.length} skills from skills folder`)
    }
  } catch (error) {
    logApp("Failed to initialize bundled skills:", error)
  }

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

  // Track if we're already cleaning up to prevent re-entry
  let isCleaningUp = false
  const CLEANUP_TIMEOUT_MS = 5000 // 5 second timeout for graceful cleanup

  app.on("before-quit", async (event) => {
    makePanelWindowClosable()

    // Prevent re-entry during cleanup
    if (isCleaningUp) {
      return
    }

    // Prevent the quit from happening immediately so we can wait for cleanup
    event.preventDefault()
    isCleaningUp = true

    // Clean up MCP server processes to prevent orphaned node processes
    // This terminates all child processes spawned by StdioClientTransport
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        mcpService.cleanup(),
        new Promise<void>((_, reject) => {
          const id = setTimeout(
            () => reject(new Error("MCP cleanup timeout")),
            CLEANUP_TIMEOUT_MS
          )
          timeoutId = id
          // unref() ensures this timer won't keep the event loop alive
          // if cleanup finishes quickly (only available in Node.js)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (id && typeof (id as any).unref === "function") {
            (id as any).unref()
          }
        }),
      ])
    } catch (error) {
      logApp("Error during MCP service cleanup on quit:", error)
    } finally {
      // Clear the timeout to avoid any lingering references
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }

    // Now actually quit the app
    app.quit()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
