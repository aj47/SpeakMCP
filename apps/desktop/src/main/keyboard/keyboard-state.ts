// keys that are currently pressed down without releasing
// excluding ctrl
// when other keys are pressed, pressing ctrl will not start recording
export const keysPressed = new Map<string, number>()

// Delay before starting hold-to-record (kept small to reduce perceived latency, while still
// allowing common modifier combos like Ctrl+C to cancel before recording begins).
export const HOLD_TO_RECORD_DELAY_MS = 250

export const hasRecentKeyPress = () => {
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
