import { RdevEvent, ModifierState, HoldModeState } from "./types"
import { configStore } from "../config"
import { state } from "../state"
import {
  getWindowRendererHandlers,
  showPanelWindowAndStartRecording,
  showPanelWindowAndStartMcpRecording,
  showPanelWindowAndShowTextInput,
  stopRecordingAndHidePanelWindow,
  emergencyStopAgentMode,
  showMainWindow,
  closeAgentModeAndHidePanelWindow,
  WINDOWS,
} from "../window"
import { matchesKeyCombo, getEffectiveShortcut } from "../../shared/key-utils"
import { isDebugKeybinds, logKeybinds } from "../debug"
import { hasRecentKeyPress } from "./state"

export const handleKillSwitchShortcuts = (
  e: RdevEvent,
  modifiers: ModifierState,
): boolean => {
  const config = configStore.get()

  if (e.data.key === "Escape") {
    if (
      isDebugKeybinds() &&
      (modifiers.isPressedCtrlKey || modifiers.isPressedShiftKey || modifiers.isPressedAltKey)
    ) {
      logKeybinds(
        "Escape key pressed with modifiers, checking kill switch conditions:",
        {
          agentKillSwitchEnabled: config.agentKillSwitchEnabled,
          agentKillSwitchHotkey: config.agentKillSwitchHotkey,
          modifiers: {
            ctrl: modifiers.isPressedCtrlKey,
            shift: modifiers.isPressedShiftKey,
            alt: modifiers.isPressedAltKey,
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
      modifiers.isPressedCtrlKey &&
      modifiers.isPressedShiftKey
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
      return true
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

    return true
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
      modifiers.isPressedCtrlKey &&
      modifiers.isPressedAltKey
    ) {
      if (isDebugKeybinds()) {
        logKeybinds("Kill switch triggered: Ctrl+Alt+Q")
      }
      emergencyStopAgentMode()
      return true
    }

    if (
      config.agentKillSwitchHotkey === "ctrl-shift-q" &&
      e.data.key === "KeyQ" &&
      modifiers.isPressedCtrlKey &&
      modifiers.isPressedShiftKey
    ) {
      if (isDebugKeybinds()) {
        logKeybinds("Kill switch triggered: Ctrl+Shift+Q")
      }
      emergencyStopAgentMode()
      return true
    }

    // Handle custom kill switch hotkey
    if (
      config.agentKillSwitchHotkey === "custom" &&
      effectiveKillSwitchHotkey
    ) {
      const matches = matchesKeyCombo(
        e.data,
        {
          ctrl: modifiers.isPressedCtrlKey,
          shift: modifiers.isPressedShiftKey,
          alt: modifiers.isPressedAltKey,
          meta: modifiers.isPressedMetaKey,
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
        return true
      }
    }
  }

  return false
}

export const handleTextInputShortcuts = (
  e: RdevEvent,
  modifiers: ModifierState,
): boolean => {
  const config = configStore.get()

  if (!config.textInputEnabled) {
    return false
  }

  const effectiveTextInputShortcut = getEffectiveShortcut(
    config.textInputShortcut,
    config.customTextInputShortcut,
  )

  if (
    config.textInputShortcut === "ctrl-t" &&
    e.data.key === "KeyT" &&
    modifiers.isPressedCtrlKey &&
    !modifiers.isPressedShiftKey &&
    !modifiers.isPressedAltKey
  ) {
    if (isDebugKeybinds()) {
      logKeybinds("Text input triggered: Ctrl+T")
    }
    showPanelWindowAndShowTextInput()
    return true
  }
  if (
    config.textInputShortcut === "ctrl-shift-t" &&
    e.data.key === "KeyT" &&
    modifiers.isPressedCtrlKey &&
    modifiers.isPressedShiftKey &&
    !modifiers.isPressedAltKey
  ) {
    if (isDebugKeybinds()) {
      logKeybinds("Text input triggered: Ctrl+Shift+T")
    }
    showPanelWindowAndShowTextInput()
    return true
  }
  if (
    config.textInputShortcut === "alt-t" &&
    e.data.key === "KeyT" &&
    !modifiers.isPressedCtrlKey &&
    !modifiers.isPressedShiftKey &&
    modifiers.isPressedAltKey
  ) {
    if (isDebugKeybinds()) {
      logKeybinds("Text input triggered: Alt+T")
    }
    showPanelWindowAndShowTextInput()
    return true
  }

  // Handle custom text input shortcut
  if (
    config.textInputShortcut === "custom" &&
    effectiveTextInputShortcut
  ) {
    const matches = matchesKeyCombo(
      e.data,
      {
        ctrl: modifiers.isPressedCtrlKey,
        shift: modifiers.isPressedShiftKey,
        alt: modifiers.isPressedAltKey,
        meta: modifiers.isPressedMetaKey,
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
      return true
    }
  }

  return false
}

export const handleMainWindowShortcuts = (
  e: RdevEvent,
  modifiers: ModifierState,
): boolean => {
  const config = configStore.get()

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
      modifiers.isPressedCtrlKey &&
      modifiers.isPressedShiftKey &&
      !modifiers.isPressedAltKey
    ) {
      if (isDebugKeybinds()) {
        logKeybinds("Main window triggered: Ctrl+Shift+S")
      }
      showMainWindow()
      return true
    }
    if (
      config.settingsHotkey === "ctrl-comma" &&
      e.data.key === "Comma" &&
      modifiers.isPressedCtrlKey &&
      !modifiers.isPressedShiftKey &&
      !modifiers.isPressedAltKey
    ) {
      if (isDebugKeybinds()) {
        logKeybinds("Main window triggered: Ctrl+,")
      }
      showMainWindow()
      return true
    }
    if (
      config.settingsHotkey === "ctrl-shift-comma" &&
      e.data.key === "Comma" &&
      modifiers.isPressedCtrlKey &&
      modifiers.isPressedShiftKey &&
      !modifiers.isPressedAltKey
    ) {
      if (isDebugKeybinds()) {
        logKeybinds("Main window triggered: Ctrl+Shift+,")
      }
      showMainWindow()
      return true
    }

    // Handle custom main window hotkey
    if (
      config.settingsHotkey === "custom" &&
      effectiveSettingsHotkey
    ) {
      const matches = matchesKeyCombo(
        e.data,
        {
          ctrl: modifiers.isPressedCtrlKey,
          shift: modifiers.isPressedShiftKey,
          alt: modifiers.isPressedAltKey,
          meta: modifiers.isPressedMetaKey,
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
        return true
      }
    }
  }

  return false
}

export const handleMcpToolsShortcuts = (
  e: RdevEvent,
  modifiers: ModifierState,
  holdState: HoldModeState,
  cancelCustomMcpTimer: () => void,
  cancelRecordingTimer: () => void,
  cancelCustomRecordingTimer: () => void,
): boolean => {
  const config = configStore.get()

  const effectiveMcpToolsShortcut = getEffectiveShortcut(
    config.mcpToolsShortcut,
    config.customMcpToolsShortcut,
  )

  if (config.mcpToolsShortcut === "ctrl-alt-slash") {
    if (e.data.key === "Slash" && modifiers.isPressedCtrlKey && modifiers.isPressedAltKey) {
      if (isDebugKeybinds()) {
        logKeybinds("MCP tools triggered: Ctrl+Alt+/")
      }
      getWindowRendererHandlers("panel")?.startOrFinishMcpRecording.send()
      return true
    }
  }

  // Handle custom MCP tools shortcut
  if (config.mcpToolsShortcut === "custom" && effectiveMcpToolsShortcut) {
    const matches = matchesKeyCombo(
      e.data,
      {
        ctrl: modifiers.isPressedCtrlKey,
        shift: modifiers.isPressedShiftKey,
        alt: modifiers.isPressedAltKey,
        meta: modifiers.isPressedMetaKey,
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
        return true
      } else {
        // Hold mode: start timer on key press, start recording after 800ms
        if (isDebugKeybinds()) {
          logKeybinds(
            "MCP tools triggered: Custom hotkey (hold mode)",
            effectiveMcpToolsShortcut,
          )
        }

        if (hasRecentKeyPress()) {
          return true
        }

        if (holdState.startCustomMcpTimer) {
          return true
        }

        // Cancel regular recording timer since MCP is prioritized
        cancelRecordingTimer()
        cancelCustomRecordingTimer()

        holdState.startCustomMcpTimer = setTimeout(() => {
          // Re-check if keys are still pressed
          const stillMatches = matchesKeyCombo(
            e.data,
            {
              ctrl: modifiers.isPressedCtrlKey,
              shift: modifiers.isPressedShiftKey,
              alt: modifiers.isPressedAltKey,
              meta: modifiers.isPressedMetaKey,
            },
            effectiveMcpToolsShortcut,
          )
          if (!stillMatches) return

          holdState.isHoldingCustomMcpKey = true
          showPanelWindowAndStartMcpRecording()
        }, 800)
        return true
      }
    }
  }

  return false
}

export const handleToggleVoiceDictationShortcuts = (
  e: RdevEvent,
  modifiers: ModifierState,
): boolean => {
  const config = configStore.get()

  if (!config.toggleVoiceDictationEnabled) {
    return false
  }

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
      return true
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
      return true
    }
  } else if (toggleHotkey === "custom" && effectiveToggleShortcut) {
    // Handle custom toggle shortcut
    const matches = matchesKeyCombo(
      e.data,
      {
        ctrl: modifiers.isPressedCtrlKey,
        shift: modifiers.isPressedShiftKey,
        alt: modifiers.isPressedAltKey,
        meta: modifiers.isPressedMetaKey,
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
      return true
    }
  }

  return false
}

export const handleRecordingShortcuts = (
  e: RdevEvent,
  modifiers: ModifierState,
  holdState: HoldModeState,
  cancelCustomRecordingTimer: () => void,
): boolean => {
  const config = configStore.get()

  const effectiveRecordingShortcut = getEffectiveShortcut(
    config.shortcut,
    config.customShortcut,
  )

  if (config.shortcut === "ctrl-slash") {
    if (e.data.key === "Slash" && modifiers.isPressedCtrlKey) {
      if (isDebugKeybinds()) {
        logKeybinds("Recording triggered: Ctrl+/")
      }
      getWindowRendererHandlers("panel")?.startOrFinishRecording.send()
      return true
    }
  } else if (config.shortcut === "custom" && effectiveRecordingShortcut) {
    // Handle custom recording shortcut
    const matches = matchesKeyCombo(
      e.data,
      {
        ctrl: modifiers.isPressedCtrlKey,
        shift: modifiers.isPressedShiftKey,
        alt: modifiers.isPressedAltKey,
        meta: modifiers.isPressedMetaKey,
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
        return true
      } else {
        // Hold mode: start timer on key press, start recording after 800ms
        if (isDebugKeybinds()) {
          logKeybinds(
            "Recording triggered: Custom hotkey (hold mode)",
            effectiveRecordingShortcut,
          )
        }

        if (hasRecentKeyPress()) {
          return true
        }

        if (holdState.startCustomRecordingTimer) {
          return true
        }

        holdState.startCustomRecordingTimer = setTimeout(() => {
          // Re-check if keys are still pressed
          const stillMatches = matchesKeyCombo(
            e.data,
            {
              ctrl: modifiers.isPressedCtrlKey,
              shift: modifiers.isPressedShiftKey,
              alt: modifiers.isPressedAltKey,
              meta: modifiers.isPressedMetaKey,
            },
            effectiveRecordingShortcut,
          )
          if (!stillMatches) return

          holdState.isHoldingCustomRecordingKey = true
          showPanelWindowAndStartRecording()
        }, 800)
        return true
      }
    }
  }

  return false
}

export const handleEnterKeyDuringRecording = (
  e: RdevEvent,
  modifiers: ModifierState,
): boolean => {
  // Handle Enter key to submit recording when triggered from UI button click
  // The panel window is shown with showInactive() so it doesn't receive keyboard focus,
  // which means we need to use the global keyboard hook to detect Enter key
  if (e.data.key === "Return" || e.data.key === "Enter" || e.data.key === "NumpadEnter") {
    if (state.isRecording && state.isRecordingFromButtonClick && !modifiers.isPressedShiftKey) {
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
      return true
    }
  }

  return false
}
