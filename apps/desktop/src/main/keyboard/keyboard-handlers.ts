import { RdevEvent, ModifierState } from "./keyboard-types"
import { configStore } from "../config"
import { state } from "../state"
import { isDebugKeybinds, logKeybinds } from "../debug"
import { keysPressed, hasRecentKeyPress, HOLD_TO_RECORD_DELAY_MS } from "./keyboard-state"
import { matchesKeyCombo, getEffectiveShortcut } from "../../shared/key-utils"
import {
  getWindowRendererHandlers,
  showPanelWindowAndStartRecording,
  showPanelWindowAndStartMcpRecording,
  stopRecordingAndHidePanelWindow,
} from "../window"
import {
  ShortcutTimers,
  ShortcutHoldState,
  cancelRecordingTimer,
  cancelMcpRecordingTimer,
  cancelCustomRecordingTimer,
  cancelCustomMcpTimer,
  tryStartMcpHoldIfEligible,
  handleKillSwitchShortcut,
  handleEnterKeyShortcut,
  handleTextInputShortcut,
  handleMainWindowShortcut,
  handleMcpToolsShortcut,
  handleToggleVoiceDictationShortcut,
  handleRecordingShortcut,
} from "./keyboard-shortcuts"

export type EventHandlerContext = {
  modifiers: ModifierState
  timers: ShortcutTimers
  holdState: ShortcutHoldState
  debugState: {
    lastLoggedConfig: string | null
    configChangeCount: number
  }
}

const logConfigChangeIfNeeded = (debugState: EventHandlerContext['debugState']) => {
  if (!isDebugKeybinds()) return

  const config = configStore.get()
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

const handleKeyPress = (e: RdevEvent, context: EventHandlerContext) => {
  const { modifiers, timers, holdState, debugState } = context

  if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
    modifiers.ctrl = true
    tryStartMcpHoldIfEligible(modifiers, timers)
    if (isDebugKeybinds()) {
      logKeybinds("Ctrl key pressed, isPressedCtrlKey =", modifiers.ctrl)
    }
  }

  if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
    modifiers.shift = true
    if (isDebugKeybinds()) {
      logKeybinds("Shift key pressed, isPressedShiftKey =", modifiers.shift)
    }
  }

  if (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") {
    modifiers.alt = true
    tryStartMcpHoldIfEligible(modifiers, timers)
    if (isDebugKeybinds()) {
      logKeybinds("Alt key pressed, isPressedAltKey =", modifiers.alt)
    }
  }

  if (e.data.key === "MetaLeft" || e.data.key === "MetaRight") {
    modifiers.meta = true
    if (isDebugKeybinds()) {
      logKeybinds("Meta key pressed, isPressedMetaKey =", modifiers.meta)
    }
  }

  // Log config changes
  logConfigChangeIfNeeded(debugState)

  // Handle shortcuts in priority order
  if (handleKillSwitchShortcut(e, modifiers)) return
  if (handleEnterKeyShortcut(e, modifiers)) return
  if (handleTextInputShortcut(e, modifiers)) return
  if (handleMainWindowShortcut(e, modifiers)) return
  if (handleMcpToolsShortcut(e, modifiers, timers, holdState)) return
  if (handleToggleVoiceDictationShortcut(e, modifiers)) return
  if (handleRecordingShortcut(e, modifiers, timers, holdState)) return

  // Handle hold-ctrl mode (default behavior)
  const config = configStore.get()
  if (config.shortcut !== "ctrl-slash" && config.shortcut !== "custom") {
    if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
      if (hasRecentKeyPress()) {
        return
      }

      if (timers.startRecordingTimer) {
        return
      }

      timers.startRecordingTimer = setTimeout(() => {
        // Guard: ensure Ctrl is still held and Alt is not held when timer fires
        if (!modifiers.ctrl || modifiers.alt) {
          return
        }
        holdState.isHoldingCtrlKey = true
        showPanelWindowAndStartRecording()
      }, HOLD_TO_RECORD_DELAY_MS)
    } else if (
      (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") &&
      modifiers.ctrl &&
      config.mcpToolsShortcut === "hold-ctrl-alt"
    ) {
      // Legacy path kept for clarity; unified by tryStartMcpHoldIfEligible()
      tryStartMcpHoldIfEligible(modifiers, timers)
      if (hasRecentKeyPress()) {
        return
      }

      if (timers.startMcpRecordingTimer) {
        return
      }

      // Cancel the regular recording timer since we're starting MCP mode
      cancelRecordingTimer(timers)

      timers.startMcpRecordingTimer = setTimeout(() => {
        // Guard: ensure Ctrl+Alt are still held when timer fires
        if (!modifiers.ctrl || !modifiers.alt) {
          return
        }
        holdState.isHoldingCtrlAltKey = true
        showPanelWindowAndStartMcpRecording()
      }, HOLD_TO_RECORD_DELAY_MS)
    } else {
      keysPressed.set(e.data.key, e.time.secs_since_epoch)
      cancelRecordingTimer(timers)
      cancelMcpRecordingTimer(timers)
      cancelCustomRecordingTimer(timers)
      cancelCustomMcpTimer(timers)

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

const handleKeyRelease = (e: RdevEvent, context: EventHandlerContext) => {
  const { modifiers, timers, holdState } = context

  keysPressed.delete(e.data.key)

  if (e.data.key === "ControlLeft" || e.data.key === "ControlRight") {
    modifiers.ctrl = false
    if (isDebugKeybinds()) {
      logKeybinds("Ctrl key released, isPressedCtrlKey =", modifiers.ctrl)
    }
  }

  if (e.data.key === "ShiftLeft" || e.data.key === "ShiftRight") {
    modifiers.shift = false
    if (isDebugKeybinds()) {
      logKeybinds("Shift key released, isPressedShiftKey =", modifiers.shift)
    }
  }

  if (e.data.key === "Alt" || e.data.key === "AltLeft" || e.data.key === "AltRight") {
    modifiers.alt = false
    if (isDebugKeybinds()) {
      logKeybinds("Alt key released, isPressedAltKey =", modifiers.alt)
    }
  }

  if (e.data.key === "MetaLeft" || e.data.key === "MetaRight") {
    modifiers.meta = false
    if (isDebugKeybinds()) {
      logKeybinds("Meta key released, isPressedMetaKey =", modifiers.meta)
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
          modifiers,
          effectiveRecordingShortcut,
        )
        if (!stillMatches) {
          // Key combo no longer matches, finish recording
          getWindowRendererHandlers("panel")?.finishRecording.send()
          holdState.isHoldingCustomRecordingKey = false
        }
      }
    }
    cancelCustomRecordingTimer(timers)
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
          modifiers,
          effectiveMcpToolsShortcut,
        )
        if (!stillMatches) {
          // Key combo no longer matches, finish recording
          getWindowRendererHandlers("panel")?.finishMcpRecording.send()
          holdState.isHoldingCustomMcpKey = false
        }
      }
    }
    cancelCustomMcpTimer(timers)
  }

  // Skip built-in hold mode handling for toggle mode shortcuts
  if (
    (currentConfig.shortcut === "ctrl-slash") ||
    (currentConfig.shortcut === "custom" && currentConfig.customShortcutMode === "toggle")
  )
    return

  cancelRecordingTimer(timers)
  cancelMcpRecordingTimer(timers)

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

export const createEventHandler = (context: EventHandlerContext) => {
  return (e: RdevEvent) => {
    if (e.event_type === "KeyPress") {
      handleKeyPress(e, context)
    } else if (e.event_type === "KeyRelease") {
      handleKeyRelease(e, context)
    }
  }
}
