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

export type ModifierState = {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export type ShortcutMode = "hold" | "toggle"
