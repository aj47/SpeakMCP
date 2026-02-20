/**
 * Utility functions for filtering and processing conversation history.
 * Dependency-light module for handling ephemeral messages.
 */

/**
 * Message type with optional ephemeral flag for internal nudges.
 * Ephemeral messages are included in LLM context but excluded from:
 * - Persisted conversation history
 * - Progress UI display
 * - Returned conversation history
 */
export interface ConversationMessage {
  role: "user" | "assistant" | "tool"
  content: string
  toolCalls?: unknown[]
  toolResults?: unknown[]
  timestamp?: number
  ephemeral?: boolean
}

type WithEphemeralFlag = { ephemeral?: boolean }

/**
 * Filter out ephemeral messages from conversation history.
 * Returns a new array without the ephemeral flag exposed.
 */
export function filterEphemeralMessages<T extends WithEphemeralFlag>(
  history: T[],
): Array<Omit<T, "ephemeral">> {
  return history
    .filter((msg) => !msg.ephemeral)
    .map((msg) => {
      const { ephemeral: _ephemeral, ...rest } = msg
      return rest as Omit<T, "ephemeral">
    })
}

/**
 * Check if a message is ephemeral.
 */
export function isEphemeralMessage<T extends WithEphemeralFlag>(
  msg: T,
): msg is T & { ephemeral: true } {
  return msg.ephemeral === true
}
