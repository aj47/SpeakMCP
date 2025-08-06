/**
 * Utility functions for handling keyboard shortcuts and key combinations
 */

export interface ParsedKeyCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string
}

/**
 * Parse a key combination string into its components
 * @param combo - Key combination string like "ctrl-shift-t" or "alt-space"
 */
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
    key: ""
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

/**
 * Check if a key event matches a key combination
 * @param event - Keyboard event data from the Rust binary
 * @param combo - Key combination string to match against
 */
export function matchesKeyCombo(event: { key: string }, modifiers: { ctrl: boolean, shift: boolean, alt: boolean, meta?: boolean }, combo: string): boolean {
  if (!combo) return false

  const parsed = parseKeyCombo(combo)

  // Check modifiers
  if (parsed.ctrl !== modifiers.ctrl) return false
  if (parsed.shift !== modifiers.shift) return false
  if (parsed.alt !== modifiers.alt) return false
  if (parsed.meta !== (modifiers.meta || false)) return false

  // Check the main key
  if (!parsed.key) return false

  // Convert event key to our internal format
  let eventKey = event.key.toLowerCase()

  // Handle special key mappings from Rust rdev format
  if (eventKey.startsWith("key")) {
    // Convert "KeyT" to "t", "KeyA" to "a", etc.
    eventKey = eventKey.substring(3).toLowerCase()
  }

  // Handle special keys
  const keyMappings: Record<string, string> = {
    "slash": "/",
    "space": " ",
    "escape": "escape",
    "enter": "enter",
    "tab": "tab",
    "backspace": "backspace",
    "delete": "delete",
    "arrowup": "up",
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "home": "home",
    "end": "end",
    "pageup": "pageup",
    "pagedown": "pagedown",
    "insert": "insert",
    "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
    "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
    "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12"
  }

  // Apply key mappings
  const normalizedEventKey = keyMappings[eventKey] || eventKey
  const normalizedComboKey = keyMappings[parsed.key] || parsed.key

  const matches = normalizedEventKey === normalizedComboKey
  return matches
}

/**
 * Convert a key combination to a human-readable display format
 * @param combo - Key combination string like "ctrl-shift-t"
 */
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

    // Format special keys for display
    const displayMappings: Record<string, string> = {
      " ": "Space",
      "/": "/",
      "escape": "Esc",
      "enter": "Enter",
      "tab": "Tab",
      "backspace": "Backspace",
      "delete": "Delete",
      "up": "↑",
      "down": "↓",
      "left": "←",
      "right": "→",
      "home": "Home",
      "end": "End",
      "pageup": "Page Up",
      "pagedown": "Page Down",
      "insert": "Insert"
    }

    displayKey = displayMappings[parsed.key] || parsed.key.toUpperCase()
    parts.push(displayKey)
  }

  return parts.join(" + ")
}

/**
 * Validate if a key combination is valid and safe to use
 * @param combo - Key combination string to validate
 */
export function validateKeyCombo(combo: string): { valid: boolean, error?: string } {
  if (!combo) {
    return { valid: false, error: "Key combination cannot be empty" }
  }

  const parsed = parseKeyCombo(combo)

  // Must have at least one modifier or be a function key
  const hasModifier = parsed.ctrl || parsed.shift || parsed.alt || parsed.meta
  const isFunctionKey = parsed.key && parsed.key.match(/^f\d+$/)

  if (!hasModifier && !isFunctionKey) {
    return { valid: false, error: "Key combination must include at least one modifier key (Ctrl, Shift, Alt, Meta) or be a function key" }
  }

  // Must have a main key
  if (!parsed.key) {
    return { valid: false, error: "Key combination must include a main key" }
  }

  // Check for potentially dangerous combinations
  const dangerousCombos = [
    "ctrl-alt-delete",  // System shortcut
    "ctrl-shift-escape", // Task manager (but we allow this for kill switch)
    "alt-f4",           // Close window
    "ctrl-w",           // Close tab
    "ctrl-q",           // Quit application
  ]

  if (dangerousCombos.includes(combo.toLowerCase())) {
    return { valid: false, error: "This key combination is reserved by the system" }
  }

  return { valid: true }
}

/**
 * Get the effective shortcut value, handling custom shortcuts
 * @param shortcutType - The shortcut type value (e.g., "ctrl-t", "custom")
 * @param customShortcut - The custom shortcut value if type is "custom"
 */
export function getEffectiveShortcut(shortcutType: string | undefined, customShortcut: string | undefined): string | undefined {
  if (shortcutType === "custom") {
    return customShortcut
  }
  return shortcutType
}
