import { spawn } from "child_process"
import { systemPreferences } from "electron"
import { rdevPath } from "./keyboard-process"
import { parseEvents } from "./keyboard-event-parser"
import { createEventHandler, EventHandlerContext } from "./keyboard-handlers"
import { isDebugKeybinds, logKeybinds } from "../debug"

export function listenToKeyboardEvents() {
  // Initialize event handler context
  const context: EventHandlerContext = {
    modifiers: {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    },
    timers: {
      startRecordingTimer: undefined,
      startMcpRecordingTimer: undefined,
      startCustomRecordingTimer: undefined,
      startCustomMcpTimer: undefined,
    },
    holdState: {
      isHoldingCtrlKey: false,
      isHoldingCtrlAltKey: false,
      isHoldingCustomRecordingKey: false,
      isHoldingCustomMcpKey: false,
    },
    debugState: {
      lastLoggedConfig: null,
      configChangeCount: 0,
    },
  }

  if (process.env.IS_MAC) {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      return
    }
  }

  const handleEvent = createEventHandler(context)

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
