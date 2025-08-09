import {
  getWindowRendererHandlers,
  showPanelWindowAndStartRecording,
  showPanelWindowAndStartMcpRecording,
  showPanelWindowAndShowTextInput,
  stopRecordingAndHidePanelWindow,
  stopTextInputAndHidePanelWindow,
  closeAgentModeAndHidePanelWindow,
  emergencyStopAgentMode,
  WINDOWS,
} from "./window"
import { systemPreferences } from "electron"
import { configStore } from "./config"
import { state, agentProcessManager } from "./state"
import { spawn, ChildProcess } from "child_process"
import path from "path"
import { matchesKeyCombo, getEffectiveShortcut } from "../shared/key-utils"
import { isDebugKeybinds, logKeybinds } from "./debug"

const rdevPath = path
  .join(
    __dirname,
    `../../resources/bin/speakmcp-rs${process.env.IS_MAC ? "" : ".exe"}`,
  )
  .replace("app.asar", "app.asar.unpacked")

type RdevEvent = {
  event_type: "KeyPress" | "KeyRelease"
  data: {
    key:
      | "ControlLeft"
      | "ControlRight"
      | "ShiftLeft"
      | "ShiftRight"
      | "Alt"
      | "BackSlash"
      | string
  }
  time: {
    secs_since_epoch: number
  }
}

export const writeText = (text: string) => {
  return new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(rdevPath, ["write", text])

    // Register process if agent mode is active
    if (state.isAgentModeActive) {
      agentProcessManager.registerProcess(child)
    }

    let stderr = ""

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn process: ${error.message}`))
    })

    child.on("close", (code) => {
      // writeText will trigger KeyPress event of the key A
      // I don't know why
      keysPressed.clear()

      if (code === 0) {
        resolve()
      } else {
        const errorMessage = `child process exited with code ${code}${stderr.trim() ? `. stderr: ${stderr.trim()}` : ""}`
        reject(new Error(errorMessage))
      }
    })
  })
}

export const getFocusedAppInfo = () => {
  return new Promise<string>((resolve, reject) => {
    const child: ChildProcess = spawn(rdevPath, ["get-focus"])

    // Register process if agent mode is active
    if (state.isAgentModeActive) {
      agentProcessManager.registerProcess(child)
    }

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn process: ${error.message}`))
    })

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        const errorMessage = `get-focus command failed with code ${code}${stderr.trim() ? `. stderr: ${stderr.trim()}` : ""}`
        reject(new Error(errorMessage))
      }
    })
  })
}

export const restoreFocusToApp = (appInfo: string) => {
  return new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(rdevPath, ["restore-focus", appInfo])

    // Register process if agent mode is active
    if (state.isAgentModeActive) {
      agentProcessManager.registerProcess(child)
    }

    let stderr = ""

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn process: ${error.message}`))
    })

    child.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        const errorMessage = `restore-focus command failed with code ${code}${stderr.trim() ? `. stderr: ${stderr.trim()}` : ""}`
        reject(new Error(errorMessage))
      }
    })
  })
}

const captureFocusBeforeRecording = async () => {
  try {
    const focusedApp = await getFocusedAppInfo()
    state.focusedAppBeforeRecording = focusedApp
  } catch (error) {
    state.focusedAppBeforeRecording = null
  }
}

export const writeTextWithFocusRestore = async (text: string) => {
  const focusedApp = state.focusedAppBeforeRecording

  if (focusedApp) {
    try {
      await restoreFocusToApp(focusedApp)

      // Small delay to ensure focus is restored before pasting
      await new Promise((resolve) => setTimeout(resolve, 100))

      await writeText(text)
    } catch (error) {
      // Fallback to regular paste without focus restoration
      await writeText(text)
    }
  } else {
    await writeText(text)
  }
}

const parseEvent = (event: any) => {
  try {
    const e = JSON.parse(String(event))
    e.data = JSON.parse(e.data)
    return e as RdevEvent
  } catch (error) {
    if (isDebugKeybinds()) {
      logKeybinds("Failed to parse event:", event, "Error:", error)
    }
    return null
  }
}

// keys that are currently pressed down without releasing
// excluding ctrl
// when other keys are pressed, pressing ctrl will not start recording
const keysPressed = new Map<string, number>()

const hasRecentKeyPress = () => {
  if (keysPressed.size === 0) return false

  const now = Date.now() / 1000
  return [...keysPressed.values()].some((time) => {
    // 10 seconds
    // for some weird reasons sometime KeyRelease event is missing for some keys
    // so they stay in the map
    // therefore we have to check if the key was pressed in the last 10 seconds
    return now - time < 10
  })
}

export function listenToKeyboardEvents() {
  let isHoldingCtrlKey = false
  let startRecordingTimer: NodeJS.Timeout | undefined
  let isPressedCtrlKey = false
  let isPressedShiftKey = false
  let isPressedAltKey = false

  // Track last press times for modifier keys to recover from missed KeyRelease events
  // We sometimes miss KeyRelease (observed via rdev). Use timestamps to auto-clear stale modifier state.
  let lastCtrlPressTime = 0
  let lastShiftPressTime = 0
  let lastAltPressTime = 0

  // MCP tool calling state
  let isHoldingCtrlAltKey = false
  let startMcpRecordingTimer: NodeJS.Timeout | undefined
  let isPressedCtrlAltKey = false

  // Debug state tracking
  let lastLoggedConfig: any = null
  let configChangeCount = 0

  if (process.env.IS_MAC) {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      return
    }
  }

  const cancelRecordingTimer = () => {
    if (startRecordingTimer) {
      clearTimeout(startRecordingTimer)
      startRecordingTimer = undefined
    }
  }

  const cancelMcpRecordingTimer = () => {
    if (startMcpRecordingTimer) {
      clearTimeout(startMcpRecordingTimer)
      startMcpRecordingTimer = undefined
    }
  }

  // Clear stale modifier states if they've been "pressed" for too long without activity.
  // This helps recover when rdev drops a KeyRelease and Ctrl/Shift/Alt get stuck as true.
  const clearStaleModifiers = (nowSec: number) => {
    // Keep threshold conservative to avoid breaking intentional long holds.
    const THRESHOLD_SECONDS = 10

    if (isPressedCtrlKey && lastCtrlPressTime && nowSec - lastCtrlPressTime > THRESHOLD_SECONDS) {
      isPressedCtrlKey = false
      if (isDebugKeybinds()) {
        logKeybinds("Auto-clearing stale Ctrl modifier")
      }
    }
    if (isPressedShiftKey && lastShiftPressTime && nowSec - lastShiftPressTime > THRESHOLD_SECONDS) {
      isPressedShiftKey = false
      if (isDebugKeybinds()) {
        logKeybinds("Auto-clearing stale Shift modifier")
      }
    }
    if (isPressedAltKey && lastAltPressTime && nowSec - lastAltPressTime > THRESHOLD_SECONDS) {
      isPressedAltKey = false
      if (isDebugKeybinds()) {
        logKeybinds("Auto-clearing stale Alt modifier")
      }
    }

    // Keep the combined flag in sync
    isPressedCtrlAltKey = isPressedCtrlKey && isPressedAltKey
  }

  const handleEvent = (e: RdevEvent) => {
    if (e.event_type === "KeyPress") {
      const nowSec = e.time?.secs_since_epoch || Date.now() / 1000

      if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
        isPressedCtrlKey = true
        lastCtrlPressTime = nowSec
        // Keep combined flag in sync regardless of which modifier changed
        isPressedCtrlAltKey = isPressedCtrlKey && isPressedAltKey
        if (isDebugKeybinds()) {
          logKeybinds("Ctrl key pressed, isPressedCtrlKey =", isPressedCtrlKey)
        }
      }

      if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
        isPressedShiftKey = true
        lastShiftPressTime = nowSec
        if (isDebugKeybinds()) {
          logKeybinds(
            "Shift key pressed, isPressedShiftKey =",
            isPressedShiftKey,
          )
        }
      }

      if (e.data.key === "Alt") {
        isPressedAltKey = true
        lastAltPressTime = nowSec
        isPressedCtrlAltKey = isPressedCtrlKey && isPressedAltKey
        if (isDebugKeybinds()) {
          logKeybinds(
            "Alt key pressed, isPressedAltKey =",
            isPressedAltKey,
            "isPressedCtrlAltKey =",
            isPressedCtrlAltKey,
          )
        }
      }

      // Before handling combos, clear any stale modifier states
      clearStaleModifiers(nowSec)

      // Compute effective modifier states for combo matching.
      // Treat a modifier as active only if it was pressed recently.
      const RECENT_MODIFIER_WINDOW = 2
      const isRecent = (t?: number) => !!t && nowSec - t < RECENT_MODIFIER_WINDOW
      const eff = {
        ctrl: isPressedCtrlKey && isRecent(lastCtrlPressTime),
        shift: isPressedShiftKey && isRecent(lastShiftPressTime),
        alt: isPressedAltKey && isRecent(lastAltPressTime),
      }

      // Get config once at the beginning of the function
      const config = configStore.get()

      // Only log config changes, not every key press
      if (isDebugKeybinds()) {
        const configHash = JSON.stringify({
          agentKillSwitchEnabled: config.agentKillSwitchEnabled,
          agentKillSwitchHotkey: config.agentKillSwitchHotkey,
          textInputEnabled: config.textInputEnabled,
          textInputShortcut: config.textInputShortcut,
          mcpToolsEnabled: config.mcpToolsEnabled,
          mcpToolsShortcut: config.mcpToolsShortcut,
          shortcut: config.shortcut,
        })

        if (lastLoggedConfig !== configHash) {
          lastLoggedConfig = configHash
          configChangeCount++
          logKeybinds(`Config change #${configChangeCount}:`, {
            agentKillSwitchEnabled: config.agentKillSwitchEnabled,
            agentKillSwitchHotkey: config.agentKillSwitchHotkey,
            textInputEnabled: config.textInputEnabled,
            textInputShortcut: config.textInputShortcut,
            mcpToolsEnabled: config.mcpToolsEnabled,
            mcpToolsShortcut: config.mcpToolsShortcut,
            shortcut: config.shortcut,
          })
        }
      }

      if (e.data.key === "Escape") {
        if (
          isDebugKeybinds() &&
          (isPressedCtrlKey || isPressedShiftKey || isPressedAltKey)
        ) {
          logKeybinds(
            "Escape key pressed with modifiers, checking kill switch conditions:",
            {
              agentKillSwitchEnabled: config.agentKillSwitchEnabled,
              agentKillSwitchHotkey: config.agentKillSwitchHotkey,
              modifiers: {
                ctrl: isPressedCtrlKey,
                shift: isPressedShiftKey,
                alt: isPressedAltKey,
              },
              isAgentModeActive: state.isAgentModeActive,
            },
          )
        }

        // Handle kill switch hotkey: Ctrl+Shift+Escape
        if (
          config.agentKillSwitchEnabled &&
          config.agentKillSwitchHotkey === "ctrl-shift-escape" &&
          eff.ctrl &&
          eff.shift
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Kill switch triggered: Ctrl+Shift+Escape")
          }
          // Emergency stop agent mode
          if (state.isAgentModeActive) {
            emergencyStopAgentMode()
          }
          return
        }

        const win = WINDOWS.get("panel")
        if (win && win.isVisible()) {
          // Check if we're currently recording
          if (state.isRecording) {
            stopRecordingAndHidePanelWindow()
          } else {
            // Panel is visible but not recording - likely showing agent results
            // Close agent mode and hide panel
            closeAgentModeAndHidePanelWindow()
          }
        }

        return
      }

      // Handle other kill switch hotkeys
      if (config.agentKillSwitchEnabled && state.isAgentModeActive) {
        const effectiveKillSwitchHotkey = getEffectiveShortcut(
          config.agentKillSwitchHotkey,
          config.customAgentKillSwitchHotkey,
        )

        if (
          config.agentKillSwitchHotkey === "ctrl-alt-q" &&
          e.data.key === "KeyQ" &&
          eff.ctrl &&
          eff.alt
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Kill switch triggered: Ctrl+Alt+Q")
          }
          emergencyStopAgentMode()
          return
        }

        if (
          config.agentKillSwitchHotkey === "ctrl-shift-q" &&
          e.data.key === "KeyQ" &&
          eff.ctrl &&
          eff.shift
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Kill switch triggered: Ctrl+Shift+Q")
          }
          emergencyStopAgentMode()
          return
        }

        // Handle custom kill switch hotkey
        if (
          config.agentKillSwitchHotkey === "custom" &&
          effectiveKillSwitchHotkey
        ) {
          const matches = matchesKeyCombo(
            e.data,
            {
              ctrl: eff.ctrl,
              shift: eff.shift,
              alt: eff.alt,
            },
            effectiveKillSwitchHotkey,
          )
          if (isDebugKeybinds() && matches) {
            logKeybinds(
              "Kill switch triggered: Custom hotkey",
              effectiveKillSwitchHotkey,
            )
          }
          if (matches) {
            emergencyStopAgentMode()
            return
          }
        }
      }

      // Handle text input shortcuts
      if (config.textInputEnabled) {
        const effectiveTextInputShortcut = getEffectiveShortcut(
          config.textInputShortcut,
          config.customTextInputShortcut,
        )

        if (
          config.textInputShortcut === "ctrl-t" &&
          e.data.key === "KeyT" &&
          eff.ctrl &&
          !eff.shift &&
          !eff.alt
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Text input triggered: Ctrl+T")
          }
          showPanelWindowAndShowTextInput()
          return
        }
        if (
          config.textInputShortcut === "ctrl-shift-t" &&
          e.data.key === "KeyT" &&
          eff.ctrl &&
          eff.shift &&
          !eff.alt
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Text input triggered: Ctrl+Shift+T")
          }
          showPanelWindowAndShowTextInput()
          return
        }
        if (
          config.textInputShortcut === "alt-t" &&
          e.data.key === "KeyT" &&
          !eff.ctrl &&
          !eff.shift &&
          eff.alt
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Text input triggered: Alt+T")
          }
          showPanelWindowAndShowTextInput()
          return
        }

        // Handle custom text input shortcut
        if (
          config.textInputShortcut === "custom" &&
          effectiveTextInputShortcut
        ) {
          const matches = matchesKeyCombo(
            e.data,
            {
              ctrl: eff.ctrl,
              shift: eff.shift,
              alt: eff.alt,
            },
            effectiveTextInputShortcut,
          )
          if (isDebugKeybinds() && matches) {
            logKeybinds(
              "Text input triggered: Custom hotkey",
              effectiveTextInputShortcut,
            )
          }
          if (matches) {
            showPanelWindowAndShowTextInput()
            return
          }
        }
      }

      // Handle MCP tool calling shortcuts
      if (config.mcpToolsEnabled) {
        const effectiveMcpToolsShortcut = getEffectiveShortcut(
          config.mcpToolsShortcut,
          config.customMcpToolsShortcut,
        )

        if (config.mcpToolsShortcut === "ctrl-alt-slash") {
          if (e.data.key === "Slash" && eff.ctrl && eff.alt) {
            if (isDebugKeybinds()) {
              logKeybinds("MCP tools triggered: Ctrl+Alt+/")
            }
            getWindowRendererHandlers("panel")?.startOrFinishMcpRecording.send()
            return
          }
        }

        // Handle custom MCP tools shortcut
        if (config.mcpToolsShortcut === "custom" && effectiveMcpToolsShortcut) {
          const matches = matchesKeyCombo(
            e.data,
            {
              ctrl: eff.ctrl,
              shift: eff.shift,
              alt: eff.alt,
            },
            effectiveMcpToolsShortcut,
          )
          if (isDebugKeybinds() && matches) {
            logKeybinds(
              "MCP tools triggered: Custom hotkey",
              effectiveMcpToolsShortcut,
            )
          }
          if (matches) {
            getWindowRendererHandlers("panel")?.startOrFinishMcpRecording.send()
            return
          }
        }
      }

      // Handle recording shortcuts
      const effectiveRecordingShortcut = getEffectiveShortcut(
        config.shortcut,
        config.customShortcut,
      )

      if (config.shortcut === "ctrl-slash") {
        if (e.data.key === "Slash" && eff.ctrl) {
          if (isDebugKeybinds()) {
            logKeybinds("Recording triggered: Ctrl+/")
          }
          getWindowRendererHandlers("panel")?.startOrFinishRecording.send()
        }
      } else if (config.shortcut === "custom" && effectiveRecordingShortcut) {
        // Handle custom recording shortcut
        const matches = matchesKeyCombo(
          e.data,
          {
            ctrl: isPressedCtrlKey,
            shift: isPressedShiftKey,
            alt: isPressedAltKey,
          },
          effectiveRecordingShortcut,
        )
        if (isDebugKeybinds() && matches) {
          logKeybinds(
            "Recording triggered: Custom hotkey",
            effectiveRecordingShortcut,
          )
        }
        if (matches) {
          getWindowRendererHandlers("panel")?.startOrFinishRecording.send()
          return
        }
      }

      // Handle hold-ctrl mode (default behavior)
      if (config.shortcut !== "ctrl-slash" && config.shortcut !== "custom") {
        if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
          if (hasRecentKeyPress()) {
            return
          }

          if (startRecordingTimer) {
            return
          }

          startRecordingTimer = setTimeout(() => {
            isHoldingCtrlKey = true
            showPanelWindowAndStartRecording()
          }, 800)
        } else if (
          e.data.key === "Alt" &&
          isPressedCtrlKey &&
          config.mcpToolsEnabled &&
          config.mcpToolsShortcut === "hold-ctrl-alt"
        ) {
          if (hasRecentKeyPress()) {
            return
          }

          if (startMcpRecordingTimer) {
            return
          }

          // Cancel the regular recording timer since we're starting MCP mode
          cancelRecordingTimer()

          startMcpRecordingTimer = setTimeout(() => {
            isHoldingCtrlAltKey = true
            showPanelWindowAndStartMcpRecording()
          }, 800)
        } else {
          keysPressed.set(e.data.key, e.time.secs_since_epoch)
          cancelRecordingTimer()
          cancelMcpRecordingTimer()

          // when holding ctrl key, pressing any other key will stop recording
          if (isHoldingCtrlKey) {
            stopRecordingAndHidePanelWindow()
          }

          // when holding ctrl+alt key, pressing any other key will stop MCP recording
          if (isHoldingCtrlAltKey) {
            stopRecordingAndHidePanelWindow()
          }

          isHoldingCtrlKey = false
          isHoldingCtrlAltKey = false
        }
      }
    } else if (e.event_type === "KeyRelease") {
      keysPressed.delete(e.data.key)

      if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
        isPressedCtrlKey = false
        if (isDebugKeybinds()) {
          logKeybinds("Ctrl key released, isPressedCtrlKey =", isPressedCtrlKey)
        }
      }

      if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
        isPressedShiftKey = false
        if (isDebugKeybinds()) {
          logKeybinds(
            "Shift key released, isPressedShiftKey =",
            isPressedShiftKey,
          )
        }
      }

      if (e.data.key === "Alt") {
        isPressedAltKey = false
        isPressedCtrlAltKey = false
        if (isDebugKeybinds()) {
          logKeybinds(
            "Alt key released, isPressedAltKey =",
            isPressedAltKey,
            "isPressedCtrlAltKey =",
            isPressedCtrlAltKey,
          )
        }
      }

      const currentConfig = configStore.get()
      if (
        currentConfig.shortcut === "ctrl-slash" ||
        currentConfig.shortcut === "custom"
      )
        return

      cancelRecordingTimer()
      cancelMcpRecordingTimer()

      if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
        if (isHoldingCtrlKey) {
          getWindowRendererHandlers("panel")?.finishRecording.send()
        } else if (!state.isTextInputActive) {
          // Only close panel if we're not in text input mode
          stopRecordingAndHidePanelWindow()
        }

        isHoldingCtrlKey = false
      }

      if (e.data.key === "Alt") {
        if (isHoldingCtrlAltKey) {
          const panelHandlers = getWindowRendererHandlers("panel")
          panelHandlers?.finishMcpRecording.send()
        } else if (!state.isTextInputActive) {
          // Only close panel if we're not in text input mode
          stopRecordingAndHidePanelWindow()
        }

        isHoldingCtrlAltKey = false
      }
    }
  }

  const child = spawn(rdevPath, ["listen"], {})

  if (isDebugKeybinds()) {
    logKeybinds("Starting keyboard event listener with rdev path:", rdevPath)
  }

  child.stdout.on("data", (data) => {
    const event = parseEvent(data)
    if (!event) return

    handleEvent(event)
  })

  child.stderr?.on("data", (data) => {
    if (isDebugKeybinds()) {
      logKeybinds("Keyboard listener stderr:", data.toString())
    }
  })

  child.on("error", (error) => {
    if (isDebugKeybinds()) {
      logKeybinds("Keyboard listener process error:", error)
    }
  })

  child.on("exit", (code, signal) => {
    if (isDebugKeybinds()) {
      logKeybinds("Keyboard listener process exited:", { code, signal })
    }
  })
}
