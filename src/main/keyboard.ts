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

const rdevPath = path
  .join(
    __dirname,
    `../../resources/bin/speakmcp-rs${process.env.IS_MAC ? "" : ".exe"}`,
  )
  .replace("app.asar", "app.asar.unpacked")

type RdevEvent = {
  event_type: "KeyPress" | "KeyRelease"
  data: {
    key: "ControlLeft" | "ControlRight" | "ShiftLeft" | "ShiftRight" | "Alt" | "BackSlash" | string
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
      await new Promise(resolve => setTimeout(resolve, 100))

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
  } catch {
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

  // MCP tool calling state
  let isHoldingCtrlAltKey = false
  let startMcpRecordingTimer: NodeJS.Timeout | undefined
  let isPressedCtrlAltKey = false

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

  const handleEvent = (e: RdevEvent) => {
    if (e.event_type === "KeyPress") {
      if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
        isPressedCtrlKey = true
      }

      if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
        isPressedShiftKey = true
      }

      if (e.data.key === "Alt") {
        isPressedAltKey = true
        isPressedCtrlAltKey = isPressedCtrlKey && true
      }

      // Get config once at the beginning of the function
      const config = configStore.get()

      if (e.data.key === "Escape") {
        // Handle kill switch hotkey: Ctrl+Shift+Escape
        if (config.agentKillSwitchEnabled &&
            config.agentKillSwitchHotkey === "ctrl-shift-escape" &&
            isPressedCtrlKey && isPressedShiftKey) {
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
        const effectiveKillSwitchHotkey = getEffectiveShortcut(config.agentKillSwitchHotkey, config.customAgentKillSwitchHotkey)

        if (config.agentKillSwitchHotkey === "ctrl-alt-q" &&
            e.data.key === "KeyQ" && isPressedCtrlKey && isPressedAltKey) {
          emergencyStopAgentMode()
          return
        }

        if (config.agentKillSwitchHotkey === "ctrl-shift-q" &&
            e.data.key === "KeyQ" && isPressedCtrlKey && isPressedShiftKey) {
          emergencyStopAgentMode()
          return
        }

        // Handle custom kill switch hotkey
        if (config.agentKillSwitchHotkey === "custom" && effectiveKillSwitchHotkey) {
          if (matchesKeyCombo(e.data, { ctrl: isPressedCtrlKey, shift: isPressedShiftKey, alt: isPressedAltKey }, effectiveKillSwitchHotkey)) {
            emergencyStopAgentMode()
            return
          }
        }
      }

      // Handle text input shortcuts

      if (config.textInputEnabled) {
        const effectiveTextInputShortcut = getEffectiveShortcut(config.textInputShortcut, config.customTextInputShortcut)

        if (config.textInputShortcut === "ctrl-t" && e.data.key === "KeyT" && isPressedCtrlKey && !isPressedShiftKey && !isPressedAltKey) {
          showPanelWindowAndShowTextInput()
          return
        }
        if (config.textInputShortcut === "ctrl-shift-t" && e.data.key === "KeyT" && isPressedCtrlKey && isPressedShiftKey && !isPressedAltKey) {
          showPanelWindowAndShowTextInput()
          return
        }
        if (config.textInputShortcut === "alt-t" && e.data.key === "KeyT" && !isPressedCtrlKey && !isPressedShiftKey && isPressedAltKey) {
          showPanelWindowAndShowTextInput()
          return
        }

        // Handle custom text input shortcut
        if (config.textInputShortcut === "custom" && effectiveTextInputShortcut) {
          if (matchesKeyCombo(e.data, { ctrl: isPressedCtrlKey, shift: isPressedShiftKey, alt: isPressedAltKey }, effectiveTextInputShortcut)) {
            showPanelWindowAndShowTextInput()
            return
          }
        }
      }

      // Handle MCP tool calling shortcuts
      if (config.mcpToolsEnabled) {
        const effectiveMcpToolsShortcut = getEffectiveShortcut(config.mcpToolsShortcut, config.customMcpToolsShortcut)

        if (config.mcpToolsShortcut === "ctrl-alt-slash") {
          if (e.data.key === "Slash" && isPressedCtrlKey && isPressedCtrlAltKey) {
            getWindowRendererHandlers("panel")?.startOrFinishMcpRecording.send()
            return
          }
        }

        // Handle custom MCP tools shortcut
        if (config.mcpToolsShortcut === "custom" && effectiveMcpToolsShortcut) {
          if (matchesKeyCombo(e.data, { ctrl: isPressedCtrlKey, shift: isPressedShiftKey, alt: isPressedAltKey }, effectiveMcpToolsShortcut)) {
            getWindowRendererHandlers("panel")?.startOrFinishMcpRecording.send()
            return
          }
        }
      }

      // Handle recording shortcuts
      const effectiveRecordingShortcut = getEffectiveShortcut(config.shortcut, config.customShortcut)

      if (config.shortcut === "ctrl-slash") {
        if (e.data.key === "Slash" && isPressedCtrlKey) {
          getWindowRendererHandlers("panel")?.startOrFinishRecording.send()
        }
      } else if (config.shortcut === "custom" && effectiveRecordingShortcut) {
        // Handle custom recording shortcut
        if (matchesKeyCombo(e.data, { ctrl: isPressedCtrlKey, shift: isPressedShiftKey, alt: isPressedAltKey }, effectiveRecordingShortcut)) {
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
        } else if (e.data.key === "Alt" && isPressedCtrlKey && config.mcpToolsEnabled && config.mcpToolsShortcut === "hold-ctrl-alt") {
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
      }

      if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
        isPressedShiftKey = false
      }

      if (e.data.key === "Alt") {
        isPressedAltKey = false
        isPressedCtrlAltKey = false
      }

      const currentConfig = configStore.get()
      if (currentConfig.shortcut === "ctrl-slash" || currentConfig.shortcut === "custom") return

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

  child.stdout.on("data", (data) => {

    const event = parseEvent(data)
    if (!event) return

    handleEvent(event)
  })
}
