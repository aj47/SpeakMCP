import { systemPreferences } from "electron"
import { spawn } from "child_process"
import { ModifierState, HoldModeState, DebugState } from "./types"
import { configStore } from "../config"
import { hasRecentKeyPress } from "./state"
import { showPanelWindowAndStartMcpRecording } from "../window"
import { rdevPath } from "./process"
import { parseEvents } from "./event-parser"
import { createEventHandler } from "./handlers"
import { isDebugKeybinds, logKeybinds } from "../debug"

export function listenToKeyboardEvents() {
  const modifiers: ModifierState = {
    isPressedCtrlKey: false,
    isPressedShiftKey: false,
    isPressedAltKey: false,
    isPressedMetaKey: false,
    isPressedCtrlAltKey: false,
  }

  const holdState: HoldModeState = {
    isHoldingCtrlKey: false,
    isHoldingCtrlAltKey: false,
    isHoldingCustomRecordingKey: false,
    isHoldingCustomMcpKey: false,
    startRecordingTimer: undefined,
    startMcpRecordingTimer: undefined,
    startCustomRecordingTimer: undefined,
    startCustomMcpTimer: undefined,
  }

  const debugState: DebugState = {
    lastLoggedConfig: null,
    configChangeCount: 0,
  }

  if (process.env.IS_MAC) {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      return
    }
  }

  const cancelRecordingTimer = () => {
    if (holdState.startRecordingTimer) {
      clearTimeout(holdState.startRecordingTimer)
      holdState.startRecordingTimer = undefined
    }
  }

  const cancelMcpRecordingTimer = () => {
    if (holdState.startMcpRecordingTimer) {
      clearTimeout(holdState.startMcpRecordingTimer)
      holdState.startMcpRecordingTimer = undefined
    }
  }

  const cancelCustomRecordingTimer = () => {
    if (holdState.startCustomRecordingTimer) {
      clearTimeout(holdState.startCustomRecordingTimer)
      holdState.startCustomRecordingTimer = undefined
    }
  }

  const cancelCustomMcpTimer = () => {
    if (holdState.startCustomMcpTimer) {
      clearTimeout(holdState.startCustomMcpTimer)
      holdState.startCustomMcpTimer = undefined
    }
  }

  const tryStartMcpHoldIfEligible = () => {
    const config = configStore.get()
    if (config.mcpToolsShortcut !== "hold-ctrl-alt") {
      return
    }

    // Both modifiers must be down
    if (!modifiers.isPressedCtrlKey || !modifiers.isPressedAltKey) return

    // Guard against recent non-modifier presses
    if (hasRecentKeyPress()) return

    // Prevent duplicate timers
    if (holdState.startMcpRecordingTimer) return

    // Cancel regular recording timer since MCP is prioritized when both held
    cancelRecordingTimer()

    holdState.startMcpRecordingTimer = setTimeout(() => {
      // Re-check modifiers before firing
      if (!modifiers.isPressedCtrlKey || !modifiers.isPressedAltKey) return
      holdState.isHoldingCtrlAltKey = true
      showPanelWindowAndStartMcpRecording()
    }, 800)
  }

  const handleEvent = createEventHandler(
    modifiers,
    holdState,
    debugState,
    cancelRecordingTimer,
    cancelMcpRecordingTimer,
    cancelCustomRecordingTimer,
    cancelCustomMcpTimer,
    tryStartMcpHoldIfEligible,
  )

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
