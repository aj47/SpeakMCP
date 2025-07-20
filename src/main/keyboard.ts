import {
  getWindowRendererHandlers,
  showPanelWindowAndStartRecording,
  showPanelWindowAndStartMcpRecording,
  stopRecordingAndHidePanelWindow,
  WINDOWS,
} from "./window"
import { systemPreferences } from "electron"
import { configStore } from "./config"
import { state } from "./state"
import { spawn, ChildProcess } from "child_process"
import path from "path"

const rdevPath = path
  .join(
    __dirname,
    `../../resources/bin/speakmcp-rs${process.env.IS_MAC ? "" : ".exe"}`,
  )
  .replace("app.asar", "app.asar.unpacked")

type RdevEvent = {
  event_type: "KeyPress" | "KeyRelease"
  data: {
    key: "ControlLeft" | "BackSlash" | string
  }
  time: {
    secs_since_epoch: number
  }
}

export const writeText = (text: string) => {
  return new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(rdevPath, ["write", text])

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

  // MCP tool calling state
  let isHoldingCtrlAltKey = false
  let startMcpRecordingTimer: NodeJS.Timeout | undefined
  let isPressedCtrlAltKey = false

  // Agent chaining state
  let isHoldingCtrlShiftKey = false
  let startAgentRecordingTimer: NodeJS.Timeout | undefined
  let isPressedShiftKey = false

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

  const cancelAgentRecordingTimer = () => {
    if (startAgentRecordingTimer) {
      clearTimeout(startAgentRecordingTimer)
      startAgentRecordingTimer = undefined
    }
  }

  const showPanelWindowAndStartAgentRecording = () => {
    const panel = WINDOWS.get("panel")
    if (panel) {
      panel.show()
      getWindowRendererHandlers("panel")?.startAgentRecording.send()
    }
  }

  const handleEvent = (e: RdevEvent) => {
    if (e.event_type === "KeyPress") {
      if (e.data.key === "ControlLeft") {
        isPressedCtrlKey = true
      }

      if (e.data.key === "Alt") {
        isPressedCtrlAltKey = isPressedCtrlKey && true
      }

      if (e.data.key === "ShiftLeft") {
        isPressedShiftKey = isPressedCtrlKey && true
      }

      if (e.data.key === "Escape" && state.isRecording) {
        const win = WINDOWS.get("panel")
        if (win) {
          stopRecordingAndHidePanelWindow()
        }

        return
      }

      // Handle MCP tool calling shortcuts
      const config = configStore.get()

      if (config.mcpToolsEnabled && config.mcpToolsShortcut === "ctrl-alt-slash") {
        if (e.data.key === "Slash" && isPressedCtrlKey && isPressedCtrlAltKey) {
          getWindowRendererHandlers("panel")?.startOrFinishMcpRecording.send()
          return
        }
      }

      // Handle Agent chaining shortcuts
      if (config.agentChainingEnabled && config.agentChainingShortcut === "ctrl-shift-slash") {
        if (e.data.key === "Slash" && isPressedCtrlKey && isPressedShiftKey) {
          getWindowRendererHandlers("panel")?.startOrFinishAgentRecording.send()
          return
        }
      }

      if (config.shortcut === "ctrl-slash") {
        if (e.data.key === "Slash" && isPressedCtrlKey) {
          getWindowRendererHandlers("panel")?.startOrFinishRecording.send()
        }
      } else {
        if (e.data.key === "ControlLeft") {
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
        } else if (e.data.key === "ShiftLeft" && isPressedCtrlKey && config.agentChainingEnabled && config.agentChainingShortcut === "hold-ctrl-shift") {
          if (hasRecentKeyPress()) {
            return
          }

          if (startAgentRecordingTimer) {
            return
          }

          // Cancel other recording timers since we're starting Agent mode
          cancelRecordingTimer()
          cancelMcpRecordingTimer()

          startAgentRecordingTimer = setTimeout(() => {
            isHoldingCtrlShiftKey = true
            showPanelWindowAndStartAgentRecording()
          }, 800)
        } else {
          keysPressed.set(e.data.key, e.time.secs_since_epoch)
          cancelRecordingTimer()
          cancelMcpRecordingTimer()
          cancelAgentRecordingTimer()

          // when holding ctrl key, pressing any other key will stop recording
          if (isHoldingCtrlKey) {
            stopRecordingAndHidePanelWindow()
          }

          // when holding ctrl+alt key, pressing any other key will stop MCP recording
          if (isHoldingCtrlAltKey) {
            stopRecordingAndHidePanelWindow()
          }

          // when holding ctrl+shift key, pressing any other key will stop Agent recording
          if (isHoldingCtrlShiftKey) {
            stopRecordingAndHidePanelWindow()
          }

          isHoldingCtrlKey = false
          isHoldingCtrlAltKey = false
          isHoldingCtrlShiftKey = false
        }
      }
    } else if (e.event_type === "KeyRelease") {
      keysPressed.delete(e.data.key)

      if (e.data.key === "ControlLeft") {
        isPressedCtrlKey = false
      }

      if (e.data.key === "Alt") {
        isPressedCtrlAltKey = false
      }

      if (e.data.key === "ShiftLeft") {
        isPressedShiftKey = false
      }

      if (configStore.get().shortcut === "ctrl-slash") return

      cancelRecordingTimer()
      cancelMcpRecordingTimer()
      cancelAgentRecordingTimer()

      if (e.data.key === "ControlLeft") {
        if (isHoldingCtrlKey) {
          getWindowRendererHandlers("panel")?.finishRecording.send()
        } else {
          stopRecordingAndHidePanelWindow()
        }

        isHoldingCtrlKey = false
      }

      if (e.data.key === "Alt") {
        if (isHoldingCtrlAltKey) {
          const panelHandlers = getWindowRendererHandlers("panel")
          panelHandlers?.finishMcpRecording.send()
        } else {
          stopRecordingAndHidePanelWindow()
        }

        isHoldingCtrlAltKey = false
      }

      if (e.data.key === "ShiftLeft") {
        if (isHoldingCtrlShiftKey) {
          const panelHandlers = getWindowRendererHandlers("panel")
          panelHandlers?.finishAgentRecording.send()
        } else {
          stopRecordingAndHidePanelWindow()
        }

        isHoldingCtrlShiftKey = false
      }
    }
  }

  const child = spawn(rdevPath, ["listen"], {})

  child.stdout.on("data", (data) => {
    if (import.meta.env.DEV) {
      console.log(String(data))
    }

    const event = parseEvent(data)
    if (!event) return

    handleEvent(event)
  })
}
