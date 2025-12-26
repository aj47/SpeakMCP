export type RdevEvent = {
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

export interface ModifierState {
  isPressedCtrlKey: boolean
  isPressedShiftKey: boolean
  isPressedAltKey: boolean
  isPressedMetaKey: boolean
  isPressedCtrlAltKey: boolean
}

export interface HoldModeState {
  isHoldingCtrlKey: boolean
  isHoldingCtrlAltKey: boolean
  isHoldingCustomRecordingKey: boolean
  isHoldingCustomMcpKey: boolean
  startRecordingTimer: ReturnType<typeof setTimeout> | undefined
  startMcpRecordingTimer: ReturnType<typeof setTimeout> | undefined
  startCustomRecordingTimer: ReturnType<typeof setTimeout> | undefined
  startCustomMcpTimer: ReturnType<typeof setTimeout> | undefined
}

export interface DebugState {
  lastLoggedConfig: string | null
  configChangeCount: number
}
