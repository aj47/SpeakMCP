import {
  getWindowRendererHandlers,
  showPanelWindowAndStartRecording,
  showPanelWindowAndStartMcpRecording,
  showPanelWindowAndShowTextInput,
  stopRecordingAndHidePanelWindow,
  stopTextInputAndHidePanelWindow,
  closeAgentModeAndHidePanelWindow,
  emergencyStopAgentMode,
  showMainWindow,
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
    `../../resources/bin/speakmcp-rs${process.platform === "win32" ? ".exe" : ""}`,
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
      | "AltLeft"
      | "AltRight"
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

const parseEvents = (data: any): RdevEvent[] => {
  try {
    const eventStr = String(data).trim()
    if (!eventStr) return []

    // Handle multiple JSON objects in a single buffer by splitting on newlines
    const lines = eventStr.split('\n').filter(line => line.trim())
    const events: RdevEvent[] = []

    for (const line of lines) {
      try {
        const e = JSON.parse(line.trim())
        e.data = JSON.parse(e.data)
        events.push(e as RdevEvent)
      } catch (lineError) {
        if (isDebugKeybinds()) {
          logKeybinds("Failed to parse line:", line, "Error:", lineError)
        }
        // Continue processing other lines
      }
    }

    return events
  } catch (error) {
    if (isDebugKeybinds()) {
      logKeybinds("Failed to parse events:", data, "Error:", error)
    }
    return []
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
  let isPressedMetaKey = false

  // MCP tool calling state
  let isHoldingCtrlAltKey = false
  let startMcpRecordingTimer: NodeJS.Timeout | undefined
  let isPressedCtrlAltKey = false

  // Custom hold mode state
  let isHoldingCustomRecordingKey = false
  let startCustomRecordingTimer: NodeJS.Timeout | undefined
  let isHoldingCustomMcpKey = false
  let startCustomMcpTimer: NodeJS.Timeout | undefined

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

  const cancelCustomRecordingTimer = () => {
    if (startCustomRecordingTimer) {
      clearTimeout(startCustomRecordingTimer)
      startCustomRecordingTimer = undefined
    }
  }

  const cancelCustomMcpTimer = () => {
    if (startCustomMcpTimer) {
      clearTimeout(startCustomMcpTimer)
      startCustomMcpTimer = undefined
    }
  }

  const tryStartMcpHoldIfEligible = () => {
    const config = configStore.get()
    if (
      !config.mcpToolsEnabled ||
      config.mcpToolsShortcut !== "hold-ctrl-alt"
    ) {
      return
    }

    // Both modifiers must be down
    if (!isPressedCtrlKey || !isPressedAltKey) return

    // Guard against recent non-modifier presses
    if (hasRecentKeyPress()) return

    // Prevent duplicate timers
    if (startMcpRecordingTimer) return

    // Cancel regular recording timer since MCP is prioritized when both held
    cancelRecordingTimer()

    startMcpRecordingTimer = setTimeout(() => {
      // Re-check modifiers before firing
      if (!isPressedCtrlKey || !isPressedAltKey) return
      isHoldingCtrlAltKey = true
      showPanelWindowAndStartMcpRecording()
    }, 800)
  }


  const handleEvent = (e: RdevEvent) => {
    if (e.event_type === "KeyPress") {
      if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
        isPressedCtrlKey = true
        tryStartMcpHoldIfEligible()
        if (isDebugKeybinds()) {
          logKeybinds("Ctrl key pressed, isPressedCtrlKey =", isPressedCtrlKey)
        }
      }

      if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
        isPressedShiftKey = true
        if (isDebugKeybinds()) {
          logKeybinds(
            "Shift key pressed, isPressedShiftKey =",
            isPressedShiftKey,
          )
        }
      }

      if (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") {
        isPressedAltKey = true
        isPressedCtrlAltKey = isPressedCtrlKey && isPressedAltKey
        tryStartMcpHoldIfEligible()
        if (isDebugKeybinds()) {
          logKeybinds(
            "Alt key pressed, isPressedAltKey =",
            isPressedAltKey,
            "isPressedCtrlAltKey =",
            isPressedCtrlAltKey,
          )
        }
      }

      if (e.data.key === "MetaLeft" || e.data.key === "MetaRight") {
        isPressedMetaKey = true
        if (isDebugKeybinds()) {
          logKeybinds("Meta key pressed, isPressedMetaKey =", isPressedMetaKey)
        }
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
        // Robust behavior: Always allow Ctrl+Shift+Escape as a hard emergency stop,
        // even if the configured hotkey is different. This provides a universal safety combo.
        if (
          config.agentKillSwitchEnabled &&
          isPressedCtrlKey &&
          isPressedShiftKey
        ) {
          if (isDebugKeybinds()) {
            const reason =
              config.agentKillSwitchHotkey === "ctrl-shift-escape"
                ? "Ctrl+Shift+Escape"
                : "Ctrl+Shift+Escape (fallback hard kill)"
            logKeybinds(`Kill switch triggered: ${reason}`)
          }
          // Emergency stop agent mode - always trigger to handle stuck states
          // even if isAgentModeActive flag is not set correctly
          emergencyStopAgentMode()
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
      // Always check killswitch hotkeys to handle stuck states, even if isAgentModeActive is not set
      if (config.agentKillSwitchEnabled) {
        const effectiveKillSwitchHotkey = getEffectiveShortcut(
          config.agentKillSwitchHotkey,
          config.customAgentKillSwitchHotkey,
        )

        if (
          config.agentKillSwitchHotkey === "ctrl-alt-q" &&
          e.data.key === "KeyQ" &&
          isPressedCtrlKey &&
          isPressedAltKey
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
          isPressedCtrlKey &&
          isPressedShiftKey
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
              ctrl: isPressedCtrlKey,
              shift: isPressedShiftKey,
              alt: isPressedAltKey,
              meta: isPressedMetaKey,
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

      // Handle Enter key to submit recording when triggered from UI button click
      // The panel window is shown with showInactive() so it doesn't receive keyboard focus,
      // which means we need to use the global keyboard hook to detect Enter key
      if (e.data.key === "Return" || e.data.key === "Enter" || e.data.key === "NumpadEnter") {
        if (state.isRecording && state.isRecordingFromButtonClick && !isPressedShiftKey) {
          if (isDebugKeybinds()) {
            logKeybinds("Enter key pressed during button-click recording, submitting")
          }
          const panelHandlers = getWindowRendererHandlers("panel")
          if (state.isRecordingMcpMode) {
            panelHandlers?.finishMcpRecording.send()
          } else {
            panelHandlers?.finishRecording.send()
          }
          // Reset the button click state
          state.isRecordingFromButtonClick = false
          return
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
          isPressedCtrlKey &&
          !isPressedShiftKey &&
          !isPressedAltKey
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
          isPressedCtrlKey &&
          isPressedShiftKey &&
          !isPressedAltKey
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
          !isPressedCtrlKey &&
          !isPressedShiftKey &&
          isPressedAltKey
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
              ctrl: isPressedCtrlKey,
              shift: isPressedShiftKey,
              alt: isPressedAltKey,
              meta: isPressedMetaKey,
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

      // Handle main window hotkey (opens/focuses UI without navigating)
      // Allow UI access during most states, but prevent during recording to avoid interruption
      if (config.settingsHotkeyEnabled && !state.isRecording) {
        const effectiveSettingsHotkey = getEffectiveShortcut(
          config.settingsHotkey,
          config.customSettingsHotkey,
        )

        if (
          config.settingsHotkey === "ctrl-shift-s" &&
          e.data.key === "KeyS" &&
          isPressedCtrlKey &&
          isPressedShiftKey &&
          !isPressedAltKey
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Main window triggered: Ctrl+Shift+S")
          }
          showMainWindow()
          return
        }
        if (
          config.settingsHotkey === "ctrl-comma" &&
          e.data.key === "Comma" &&
          isPressedCtrlKey &&
          !isPressedShiftKey &&
          !isPressedAltKey
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Main window triggered: Ctrl+,")
          }
          showMainWindow()
          return
        }
        if (
          config.settingsHotkey === "ctrl-shift-comma" &&
          e.data.key === "Comma" &&
          isPressedCtrlKey &&
          isPressedShiftKey &&
          !isPressedAltKey
        ) {
          if (isDebugKeybinds()) {
            logKeybinds("Main window triggered: Ctrl+Shift+,")
          }
          showMainWindow()
          return
        }

        // Handle custom main window hotkey
        if (
          config.settingsHotkey === "custom" &&
          effectiveSettingsHotkey
        ) {
          const matches = matchesKeyCombo(
            e.data,
            {
              ctrl: isPressedCtrlKey,
              shift: isPressedShiftKey,
              alt: isPressedAltKey,
              meta: isPressedMetaKey,
            },
            effectiveSettingsHotkey,
          )
          if (isDebugKeybinds() && matches) {
            logKeybinds(
              "Main window triggered: Custom hotkey",
              effectiveSettingsHotkey,
            )
          }
          if (matches) {
            showMainWindow()
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
          if (e.data.key === "Slash" && isPressedCtrlKey && isPressedAltKey) {
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
              ctrl: isPressedCtrlKey,
              shift: isPressedShiftKey,
              alt: isPressedAltKey,
              meta: isPressedMetaKey,
            },
            effectiveMcpToolsShortcut,
          )
          if (matches) {
            const customMode = config.customMcpToolsShortcutMode || "hold"

            if (customMode === "toggle") {
              // Toggle mode: press once to start, press again to stop
              if (isDebugKeybinds()) {
                logKeybinds(
                  "MCP tools triggered: Custom hotkey (toggle mode)",
                  effectiveMcpToolsShortcut,
                )
              }
              getWindowRendererHandlers("panel")?.startOrFinishMcpRecording.send()
              return
            } else {
              // Hold mode: start timer on key press, start recording after 800ms
              if (isDebugKeybinds()) {
                logKeybinds(
                  "MCP tools triggered: Custom hotkey (hold mode)",
                  effectiveMcpToolsShortcut,
                )
              }

              if (hasRecentKeyPress()) {
                return
              }

              if (startCustomMcpTimer) {
                return
              }

              // Cancel regular recording timer since MCP is prioritized
              cancelRecordingTimer()
              cancelCustomRecordingTimer()

              startCustomMcpTimer = setTimeout(() => {
                // Re-check if keys are still pressed
                const stillMatches = matchesKeyCombo(
                  e.data,
                  {
                    ctrl: isPressedCtrlKey,
                    shift: isPressedShiftKey,
                    alt: isPressedAltKey,
                    meta: isPressedMetaKey,
                  },
                  effectiveMcpToolsShortcut,
                )
                if (!stillMatches) return

                isHoldingCustomMcpKey = true
                showPanelWindowAndStartMcpRecording()
              }, 800)
              return
            }
          }
        }
      }

      // Handle toggle voice dictation shortcuts
      if (config.toggleVoiceDictationEnabled) {
        const effectiveToggleShortcut = getEffectiveShortcut(
          config.toggleVoiceDictationHotkey,
          config.customToggleVoiceDictationHotkey,
        )

        const toggleHotkey = config.toggleVoiceDictationHotkey

        if (toggleHotkey === "fn") {
          if (e.data.key === "Function" || e.data.key === "Fn") {
            if (isDebugKeybinds()) {
              logKeybinds("Toggle voice dictation triggered: Fn")
            }
            if (state.isToggleRecordingActive) {
              // Stop toggle recording
              state.isToggleRecordingActive = false
              getWindowRendererHandlers("panel")?.finishRecording.send()
            } else {
              // Start toggle recording
              state.isToggleRecordingActive = true
              showPanelWindowAndStartRecording()
            }
            return
          }
        } else if (toggleHotkey && toggleHotkey !== "custom" && toggleHotkey.startsWith("f")) {
          // Handle F1-F12 keys
          const fKeyMap: Record<string, string> = {
            f1: "F1", f2: "F2", f3: "F3", f4: "F4", f5: "F5", f6: "F6",
            f7: "F7", f8: "F8", f9: "F9", f10: "F10", f11: "F11", f12: "F12"
          }
          const expectedKey = fKeyMap[toggleHotkey]
          if (e.data.key === expectedKey) {
            if (isDebugKeybinds()) {
              logKeybinds(`Toggle voice dictation triggered: ${expectedKey}`)
            }
            if (state.isToggleRecordingActive) {
              // Stop toggle recording
              state.isToggleRecordingActive = false
              getWindowRendererHandlers("panel")?.finishRecording.send()
            } else {
              // Start toggle recording
              state.isToggleRecordingActive = true
              showPanelWindowAndStartRecording()
            }
            return
          }
        } else if (toggleHotkey === "custom" && effectiveToggleShortcut) {
          // Handle custom toggle shortcut
          const matches = matchesKeyCombo(
            e.data,
            {
              ctrl: isPressedCtrlKey,
              shift: isPressedShiftKey,
              alt: isPressedAltKey,
              meta: isPressedMetaKey,
            },
            effectiveToggleShortcut,
          )
          if (isDebugKeybinds() && matches) {
            logKeybinds(
              "Toggle voice dictation triggered: Custom hotkey",
              effectiveToggleShortcut,
            )
          }
          if (matches) {
            if (state.isToggleRecordingActive) {
              // Stop toggle recording
              state.isToggleRecordingActive = false
              getWindowRendererHandlers("panel")?.finishRecording.send()
            } else {
              // Start toggle recording
              state.isToggleRecordingActive = true
              showPanelWindowAndStartRecording()
            }
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
        if (e.data.key === "Slash" && isPressedCtrlKey) {
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
            meta: isPressedMetaKey,
          },
          effectiveRecordingShortcut,
        )
        if (matches) {
          const customMode = config.customShortcutMode || "hold"

          if (customMode === "toggle") {
            // Toggle mode: press once to start, press again to stop
            if (isDebugKeybinds()) {
              logKeybinds(
                "Recording triggered: Custom hotkey (toggle mode)",
                effectiveRecordingShortcut,
              )
            }
            getWindowRendererHandlers("panel")?.startOrFinishRecording.send()
            return
          } else {
            // Hold mode: start timer on key press, start recording after 800ms
            if (isDebugKeybinds()) {
              logKeybinds(
                "Recording triggered: Custom hotkey (hold mode)",
                effectiveRecordingShortcut,
              )
            }

            if (hasRecentKeyPress()) {
              return
            }

            if (startCustomRecordingTimer) {
              return
            }

            startCustomRecordingTimer = setTimeout(() => {
              // Re-check if keys are still pressed
              const stillMatches = matchesKeyCombo(
                e.data,
                {
                  ctrl: isPressedCtrlKey,
                  shift: isPressedShiftKey,
                  alt: isPressedAltKey,
                  meta: isPressedMetaKey,
                },
                effectiveRecordingShortcut,
              )
              if (!stillMatches) return

              isHoldingCustomRecordingKey = true
              showPanelWindowAndStartRecording()
            }, 800)
            return
          }
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
            // Guard: ensure Ctrl is still held and Alt is not held when timer fires
            if (!isPressedCtrlKey || isPressedAltKey) {
              return
            }
            isHoldingCtrlKey = true
            showPanelWindowAndStartRecording()
          }, 800)
        } else if (
          (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") &&
          isPressedCtrlKey &&
          config.mcpToolsEnabled &&
          config.mcpToolsShortcut === "hold-ctrl-alt"
        ) {
          // Legacy path kept for clarity; unified by tryStartMcpHoldIfEligible()
          tryStartMcpHoldIfEligible()
          if (hasRecentKeyPress()) {
            return
          }

          if (startMcpRecordingTimer) {
            return
          }

          // Cancel the regular recording timer since we're starting MCP mode
          cancelRecordingTimer()

          startMcpRecordingTimer = setTimeout(() => {
            // Guard: ensure Ctrl+Alt are still held when timer fires
            if (!isPressedCtrlKey || !isPressedAltKey) {
              return
            }
            isHoldingCtrlAltKey = true
            showPanelWindowAndStartMcpRecording()
          }, 800)
        } else {
          keysPressed.set(e.data.key, e.time.secs_since_epoch)
          cancelRecordingTimer()
          cancelMcpRecordingTimer()
          cancelCustomRecordingTimer()
          cancelCustomMcpTimer()

          // when holding ctrl key, pressing any other key will stop recording
          if (isHoldingCtrlKey) {
            stopRecordingAndHidePanelWindow()
          }

          // when holding ctrl+alt key, pressing any other key will stop MCP recording
          if (isHoldingCtrlAltKey) {
            stopRecordingAndHidePanelWindow()
          }

          // when holding custom recording key, pressing any other key will stop recording
          if (isHoldingCustomRecordingKey) {
            stopRecordingAndHidePanelWindow()
          }

          // when holding custom MCP key, pressing any other key will stop recording
          if (isHoldingCustomMcpKey) {
            stopRecordingAndHidePanelWindow()
          }

          isHoldingCtrlKey = false
          isHoldingCtrlAltKey = false
          isHoldingCustomRecordingKey = false
          isHoldingCustomMcpKey = false
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

      if (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") {
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

      if (e.data.key === "MetaLeft" || e.data.key === "MetaRight") {
        isPressedMetaKey = false
        if (isDebugKeybinds()) {
          logKeybinds("Meta key released, isPressedMetaKey =", isPressedMetaKey)
        }
      }

      const currentConfig = configStore.get()

      // Handle custom shortcut key releases for hold mode
      if (currentConfig.shortcut === "custom") {
        const customMode = currentConfig.customShortcutMode || "hold"
        if (customMode === "toggle") {
          // Toggle mode doesn't need key release handling
          return
        }
        // Hold mode: check if we should finish recording
        if (isHoldingCustomRecordingKey) {
          const effectiveRecordingShortcut = getEffectiveShortcut(
            currentConfig.shortcut,
            currentConfig.customShortcut,
          )
          if (effectiveRecordingShortcut) {
            // Check if the released key is part of the custom shortcut
            const stillMatches = matchesKeyCombo(
              e.data,
              {
                ctrl: isPressedCtrlKey,
                shift: isPressedShiftKey,
                alt: isPressedAltKey,
                meta: isPressedMetaKey,
              },
              effectiveRecordingShortcut,
            )
            if (!stillMatches) {
              // Key combo no longer matches, finish recording
              getWindowRendererHandlers("panel")?.finishRecording.send()
              isHoldingCustomRecordingKey = false
            }
          }
        }
        cancelCustomRecordingTimer()
      }

      // Handle custom MCP shortcut key releases for hold mode
      if (currentConfig.mcpToolsShortcut === "custom") {
        const customMode = currentConfig.customMcpToolsShortcutMode || "hold"
        if (customMode === "hold" && isHoldingCustomMcpKey) {
          const effectiveMcpToolsShortcut = getEffectiveShortcut(
            currentConfig.mcpToolsShortcut,
            currentConfig.customMcpToolsShortcut,
          )
          if (effectiveMcpToolsShortcut) {
            // Check if the released key is part of the custom shortcut
            const stillMatches = matchesKeyCombo(
              e.data,
              {
                ctrl: isPressedCtrlKey,
                shift: isPressedShiftKey,
                alt: isPressedAltKey,
                meta: isPressedMetaKey,
              },
              effectiveMcpToolsShortcut,
            )
            if (!stillMatches) {
              // Key combo no longer matches, finish recording
              getWindowRendererHandlers("panel")?.finishMcpRecording.send()
              isHoldingCustomMcpKey = false
            }
          }
        }
        cancelCustomMcpTimer()
      }

      // Skip built-in hold mode handling for toggle mode shortcuts
      if (
        (currentConfig.shortcut === "ctrl-slash") ||
        (currentConfig.shortcut === "custom" && currentConfig.customShortcutMode === "toggle")
      )
        return

      cancelRecordingTimer()
      cancelMcpRecordingTimer()

      // Finish MCP hold on either modifier release
      if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
        if (isHoldingCtrlAltKey) {
          const panelHandlers = getWindowRendererHandlers("panel")
          panelHandlers?.finishMcpRecording.send()
          isHoldingCtrlAltKey = false
        } else {
          if (isHoldingCtrlKey) {
            getWindowRendererHandlers("panel")?.finishRecording.send()
          } else if (!state.isTextInputActive) {
            // Only close panel if we're not in text input mode
            stopRecordingAndHidePanelWindow()
          }

          isHoldingCtrlKey = false
        }
      }

      if (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") {
        if (isHoldingCtrlAltKey) {
          const panelHandlers = getWindowRendererHandlers("panel")
          panelHandlers?.finishMcpRecording.send()
          isHoldingCtrlAltKey = false
        } else if (!state.isTextInputActive) {
          // Only close panel if we're not in text input mode
          stopRecordingAndHidePanelWindow()
        }
      }
    }
  }

  const child = spawn(rdevPath, ["listen"], {})

  if (isDebugKeybinds()) {
    logKeybinds("Starting keyboard event listener with rdev path:", rdevPath)
  }

  child.stdout.on("data", (data) => {
    const events = parseEvents(data)
    for (const event of events) {
      handleEvent(event)
    }
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
