import { RdevEvent, ModifierState, HoldModeState, DebugState } from "./types"
import { configStore } from "../config"
import { state } from "../state"
import { keysPressed, hasRecentKeyPress } from "./state"
import {
  getWindowRendererHandlers,
  showPanelWindowAndStartRecording,
  showPanelWindowAndStartMcpRecording,
  stopRecordingAndHidePanelWindow,
} from "../window"
import { matchesKeyCombo, getEffectiveShortcut } from "../../shared/key-utils"
import { isDebugKeybinds, logKeybinds } from "../debug"
import {
  handleKillSwitchShortcuts,
  handleEnterKeyDuringRecording,
  handleTextInputShortcuts,
  handleMainWindowShortcuts,
  handleMcpToolsShortcuts,
  handleToggleVoiceDictationShortcuts,
  handleRecordingShortcuts,
} from "./shortcuts"

export function createEventHandler(
  modifiers: ModifierState,
  holdState: HoldModeState,
  debugState: DebugState,
  cancelRecordingTimer: () => void,
  cancelMcpRecordingTimer: () => void,
  cancelCustomRecordingTimer: () => void,
  cancelCustomMcpTimer: () => void,
  tryStartMcpHoldIfEligible: () => void,
) {
  return (e: RdevEvent) => {
    if (e.event_type === "KeyPress") {
      handleKeyPress(
        e,
        modifiers,
        holdState,
        debugState,
        cancelRecordingTimer,
        cancelMcpRecordingTimer,
        cancelCustomRecordingTimer,
        cancelCustomMcpTimer,
        tryStartMcpHoldIfEligible,
      )
    } else if (e.event_type === "KeyRelease") {
      handleKeyRelease(
        e,
        modifiers,
        holdState,
        cancelRecordingTimer,
        cancelMcpRecordingTimer,
        cancelCustomRecordingTimer,
        cancelCustomMcpTimer,
      )
    }
  }
}

function handleKeyPress(
  e: RdevEvent,
  modifiers: ModifierState,
  holdState: HoldModeState,
  debugState: DebugState,
  cancelRecordingTimer: () => void,
  cancelMcpRecordingTimer: () => void,
  cancelCustomRecordingTimer: () => void,
  cancelCustomMcpTimer: () => void,
  tryStartMcpHoldIfEligible: () => void,
) {
  // Update modifier state
  if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
    modifiers.isPressedCtrlKey = true
    tryStartMcpHoldIfEligible()
    if (isDebugKeybinds()) {
      logKeybinds("Ctrl key pressed, isPressedCtrlKey =", modifiers.isPressedCtrlKey)
    }
  }

  if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
    modifiers.isPressedShiftKey = true
    if (isDebugKeybinds()) {
      logKeybinds(
        "Shift key pressed, isPressedShiftKey =",
        modifiers.isPressedShiftKey,
      )
    }
  }

  if (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") {
    modifiers.isPressedAltKey = true
    modifiers.isPressedCtrlAltKey = modifiers.isPressedCtrlKey && modifiers.isPressedAltKey
    tryStartMcpHoldIfEligible()
    if (isDebugKeybinds()) {
      logKeybinds(
        "Alt key pressed, isPressedAltKey =",
        modifiers.isPressedAltKey,
        "isPressedCtrlAltKey =",
        modifiers.isPressedCtrlAltKey,
      )
    }
  }

  if (e.data.key === "MetaLeft" || e.data.key === "MetaRight") {
    modifiers.isPressedMetaKey = true
    if (isDebugKeybinds()) {
      logKeybinds("Meta key pressed, isPressedMetaKey =", modifiers.isPressedMetaKey)
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

    if (debugState.lastLoggedConfig !== configHash) {
      debugState.lastLoggedConfig = configHash
      debugState.configChangeCount++
      logKeybinds(`Config change #${debugState.configChangeCount}:`, {
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

  // Handle kill switch shortcuts (Escape, Ctrl+Alt+Q, Ctrl+Shift+Q, custom)
  if (handleKillSwitchShortcuts(e, modifiers)) {
    return
  }

  // Handle Enter key during button-click recording
  if (handleEnterKeyDuringRecording(e, modifiers)) {
    return
  }

  // Handle text input shortcuts
  if (handleTextInputShortcuts(e, modifiers)) {
    return
  }

  // Handle main window shortcuts
  if (handleMainWindowShortcuts(e, modifiers)) {
    return
  }

  // Handle MCP tool calling shortcuts
  if (handleMcpToolsShortcuts(
    e,
    modifiers,
    holdState,
    cancelCustomMcpTimer,
    cancelRecordingTimer,
    cancelCustomRecordingTimer,
  )) {
    return
  }

  // Handle toggle voice dictation shortcuts
  if (handleToggleVoiceDictationShortcuts(e, modifiers)) {
    return
  }

  // Handle recording shortcuts
  if (handleRecordingShortcuts(
    e,
    modifiers,
    holdState,
    cancelCustomRecordingTimer,
  )) {
    return
  }

  // Handle hold-ctrl mode (default behavior)
  if (config.shortcut !== "ctrl-slash" && config.shortcut !== "custom") {
    if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
      if (hasRecentKeyPress()) {
        return
      }

      if (holdState.startRecordingTimer) {
        return
      }

      holdState.startRecordingTimer = setTimeout(() => {
        // Guard: ensure Ctrl is still held and Alt is not held when timer fires
        if (!modifiers.isPressedCtrlKey || modifiers.isPressedAltKey) {
          return
        }
        holdState.isHoldingCtrlKey = true
        showPanelWindowAndStartRecording()
      }, 800)
    } else if (
      (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") &&
      modifiers.isPressedCtrlKey &&
      config.mcpToolsShortcut === "hold-ctrl-alt"
    ) {
      // Legacy path kept for clarity; unified by tryStartMcpHoldIfEligible()
      tryStartMcpHoldIfEligible()
      if (hasRecentKeyPress()) {
        return
      }

      if (holdState.startMcpRecordingTimer) {
        return
      }

      // Cancel the regular recording timer since we're starting MCP mode
      cancelRecordingTimer()

      holdState.startMcpRecordingTimer = setTimeout(() => {
        // Guard: ensure Ctrl+Alt are still held when timer fires
        if (!modifiers.isPressedCtrlKey || !modifiers.isPressedAltKey) {
          return
        }
        holdState.isHoldingCtrlAltKey = true
        showPanelWindowAndStartMcpRecording()
      }, 800)
    } else {
      keysPressed.set(e.data.key, e.time.secs_since_epoch)
      cancelRecordingTimer()
      cancelMcpRecordingTimer()
      cancelCustomRecordingTimer()
      cancelCustomMcpTimer()

      // when holding ctrl key, pressing any other key will stop recording
      if (holdState.isHoldingCtrlKey) {
        stopRecordingAndHidePanelWindow()
      }

      // when holding ctrl+alt key, pressing any other key will stop MCP recording
      if (holdState.isHoldingCtrlAltKey) {
        stopRecordingAndHidePanelWindow()
      }

      // when holding custom recording key, pressing any other key will stop recording
      if (holdState.isHoldingCustomRecordingKey) {
        stopRecordingAndHidePanelWindow()
      }

      // when holding custom MCP key, pressing any other key will stop recording
      if (holdState.isHoldingCustomMcpKey) {
        stopRecordingAndHidePanelWindow()
      }

      holdState.isHoldingCtrlKey = false
      holdState.isHoldingCtrlAltKey = false
      holdState.isHoldingCustomRecordingKey = false
      holdState.isHoldingCustomMcpKey = false
    }
  }
}

function handleKeyRelease(
  e: RdevEvent,
  modifiers: ModifierState,
  holdState: HoldModeState,
  cancelRecordingTimer: () => void,
  cancelMcpRecordingTimer: () => void,
  cancelCustomRecordingTimer: () => void,
  cancelCustomMcpTimer: () => void,
) {
  keysPressed.delete(e.data.key)

  if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
    modifiers.isPressedCtrlKey = false
    if (isDebugKeybinds()) {
      logKeybinds("Ctrl key released, isPressedCtrlKey =", modifiers.isPressedCtrlKey)
    }
  }

  if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
    modifiers.isPressedShiftKey = false
    if (isDebugKeybinds()) {
      logKeybinds(
        "Shift key released, isPressedShiftKey =",
        modifiers.isPressedShiftKey,
      )
    }
  }

  if (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") {
    modifiers.isPressedAltKey = false
    modifiers.isPressedCtrlAltKey = false
    if (isDebugKeybinds()) {
      logKeybinds(
        "Alt key released, isPressedAltKey =",
        modifiers.isPressedAltKey,
        "isPressedCtrlAltKey =",
        modifiers.isPressedCtrlAltKey,
      )
    }
  }

  if (e.data.key === "MetaLeft" || e.data.key === "MetaRight") {
    modifiers.isPressedMetaKey = false
    if (isDebugKeybinds()) {
      logKeybinds("Meta key released, isPressedMetaKey =", modifiers.isPressedMetaKey)
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
    if (holdState.isHoldingCustomRecordingKey) {
      const effectiveRecordingShortcut = getEffectiveShortcut(
        currentConfig.shortcut,
        currentConfig.customShortcut,
      )
      if (effectiveRecordingShortcut) {
        // Check if the released key is part of the custom shortcut
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
        if (!stillMatches) {
          // Key combo no longer matches, finish recording
          getWindowRendererHandlers("panel")?.finishRecording.send()
          holdState.isHoldingCustomRecordingKey = false
        }
      }
    }
    cancelCustomRecordingTimer()
  }

  // Handle custom MCP shortcut key releases for hold mode
  if (currentConfig.mcpToolsShortcut === "custom") {
    const customMode = currentConfig.customMcpToolsShortcutMode || "hold"
    if (customMode === "hold" && holdState.isHoldingCustomMcpKey) {
      const effectiveMcpToolsShortcut = getEffectiveShortcut(
        currentConfig.mcpToolsShortcut,
        currentConfig.customMcpToolsShortcut,
      )
      if (effectiveMcpToolsShortcut) {
        // Check if the released key is part of the custom shortcut
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
        if (!stillMatches) {
          // Key combo no longer matches, finish recording
          getWindowRendererHandlers("panel")?.finishMcpRecording.send()
          holdState.isHoldingCustomMcpKey = false
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
    if (holdState.isHoldingCtrlAltKey) {
      const panelHandlers = getWindowRendererHandlers("panel")
      panelHandlers?.finishMcpRecording.send()
      holdState.isHoldingCtrlAltKey = false
    } else {
      if (holdState.isHoldingCtrlKey) {
        getWindowRendererHandlers("panel")?.finishRecording.send()
      } else if (!state.isTextInputActive) {
        // Only close panel if we're not in text input mode
        stopRecordingAndHidePanelWindow()
      }

      holdState.isHoldingCtrlKey = false
    }
  }

  if (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") {
    if (holdState.isHoldingCtrlAltKey) {
      const panelHandlers = getWindowRendererHandlers("panel")
      panelHandlers?.finishMcpRecording.send()
      holdState.isHoldingCtrlAltKey = false
    } else if (!state.isTextInputActive) {
      // Only close panel if we're not in text input mode
      stopRecordingAndHidePanelWindow()
    }
  }
}
