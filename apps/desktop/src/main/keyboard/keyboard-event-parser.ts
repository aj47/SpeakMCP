import { RdevEvent } from "./keyboard-types"
import { isDebugKeybinds, logKeybinds } from "../debug"

export const parseEvents = (data: Buffer | string): RdevEvent[] => {
  try {
    const eventStr = String(data).trim()
    if (!eventStr) return []

    // Handle multiple JSON objects in a single buffer by splitting on newlines
    const lines = eventStr.split('\n').filter(line => line.trim())
    const events: RdevEvent[] = []

    for (const line of lines) {
      try {
        const e = JSON.parse(line.trim())
        e.data = JSON.parse(e.data)
        events.push(e as RdevEvent)
      } catch (lineError) {
        if (isDebugKeybinds()) {
          logKeybinds("Failed to parse line:", line, "Error:", lineError)
        }
        // Continue processing other lines
      }
    }

    return events
  } catch (error) {
    if (isDebugKeybinds()) {
      logKeybinds("Failed to parse events:", data, "Error:", error)
    }
    return []
  }
}
