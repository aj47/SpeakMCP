export interface ParsedKeyCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string
}

export function parseKeyCombo(combo: string): ParsedKeyCombo {
  if (!combo) {
    return { ctrl: false, shift: false, alt: false, meta: false, key: "" }
  }

  const parts = combo.toLowerCase().split("-")
  const result: ParsedKeyCombo = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: "",
  }

  for (const part of parts) {
    switch (part) {
      case "ctrl":
        result.ctrl = true
        break
      case "shift":
        result.shift = true
        break
      case "alt":
        result.alt = true
        break
      case "meta":
      case "cmd":
        result.meta = true
        break
      default:
        result.key = part
        break
    }
  }

  return result
}

export function matchesKeyCombo(
  event: { key: string },
  modifiers: { ctrl: boolean; shift: boolean; alt: boolean; meta?: boolean },
  combo: string,
): boolean {
  if (!combo) return false

  const parsed = parseKeyCombo(combo)

  if (parsed.ctrl !== modifiers.ctrl) return false
  if (parsed.shift !== modifiers.shift) return false
  if (parsed.alt !== modifiers.alt) return false
  if (parsed.meta !== (modifiers.meta || false)) return false

  if (!parsed.key) return false

  let eventKey = event.key.toLowerCase()

  if (eventKey.startsWith("key")) {
    eventKey = eventKey.substring(3).toLowerCase()
  }

  const keyMappings: Record<string, string> = {
    slash: "/",
    comma: ",",
    space: " ",
    escape: "escape",
    enter: "enter",
    tab: "tab",
    backspace: "backspace",
    delete: "delete",
    arrowup: "up",
    arrowdown: "down",
    arrowleft: "left",
    arrowright: "right",
    home: "home",
    end: "end",
    pageup: "pageup",
    pagedown: "pagedown",
    insert: "insert",
    f1: "f1",
    f2: "f2",
    f3: "f3",
    f4: "f4",
    f5: "f5",
    f6: "f6",
    f7: "f7",
    f8: "f8",
    f9: "f9",
    f10: "f10",
    f11: "f11",
    f12: "f12",
    fn: "fn",
    function: "fn",
  }

  const normalizedEventKey = keyMappings[eventKey] || eventKey
  const normalizedComboKey = keyMappings[parsed.key] || parsed.key

  return normalizedEventKey === normalizedComboKey
}

export function formatKeyComboForDisplay(combo: string): string {
  if (!combo) return ""

  const parsed = parseKeyCombo(combo)
  const parts: string[] = []

  if (parsed.ctrl) parts.push("Ctrl")
  if (parsed.shift) parts.push("Shift")
  if (parsed.alt) parts.push("Alt")
  if (parsed.meta) parts.push(process.platform === "darwin" ? "Cmd" : "Meta")

  if (parsed.key) {
    let displayKey = parsed.key

    const displayMappings: Record<string, string> = {
      " ": "Space",
      "/": "/",
      escape: "Esc",
      enter: "Enter",
      tab: "Tab",
      backspace: "Backspace",
      delete: "Delete",
      up: "↑",
      down: "↓",
      left: "←",
      right: "→",
      home: "Home",
      end: "End",
      pageup: "Page Up",
      pagedown: "Page Down",
      insert: "Insert",
      fn: "Fn",
      f1: "F1",
      f2: "F2",
      f3: "F3",
      f4: "F4",
      f5: "F5",
      f6: "F6",
      f7: "F7",
      f8: "F8",
      f9: "F9",
      f10: "F10",
      f11: "F11",
      f12: "F12",
    }

    displayKey = displayMappings[parsed.key] || parsed.key.toUpperCase()
    parts.push(displayKey)
  }

  return parts.join(" + ")
}

export function validateKeyCombo(combo: string): {
  valid: boolean
  error?: string
} {
  if (!combo) {
    return { valid: false, error: "Key combination cannot be empty" }
  }

  const parsed = parseKeyCombo(combo)

  const hasModifier = parsed.ctrl || parsed.shift || parsed.alt || parsed.meta
  const isFunctionKey = parsed.key && (parsed.key.match(/^f\d+$/) || parsed.key === "fn")

  if (!hasModifier && !isFunctionKey) {
    return {
      valid: false,
      error:
        "Key combination must include at least one modifier key (Ctrl, Shift, Alt, Meta) or be a function key",
    }
  }

  if (!parsed.key) {
    return { valid: false, error: "Key combination must include a main key" }
  }

  const dangerousCombos = [
    "ctrl-alt-delete", // System shortcut
    "ctrl-shift-escape", // Task manager (but we allow this for kill switch)
    "alt-f4", // Close window
    "ctrl-w", // Close tab
    "ctrl-q", // Quit application
  ]

  if (dangerousCombos.includes(combo.toLowerCase())) {
    return {
      valid: false,
      error: "This key combination is reserved by the system",
    }
  }

  return { valid: true }
}

export function getEffectiveShortcut(
  shortcutType: string | undefined,
  customShortcut: string | undefined,
): string | undefined {
  if (shortcutType === "custom") {
    return customShortcut
  }
  return shortcutType
}
