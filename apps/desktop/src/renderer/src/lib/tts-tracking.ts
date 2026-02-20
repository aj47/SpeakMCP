/**
 * Module-level TTS tracking to prevent double auto-play.
 * 
 * This is extracted to a separate file to avoid circular dependencies
 * between agent-progress (component) and agent-store (store).
 * 
 * The set tracks sessions that have already auto-played TTS, keyed by
 * `${sessionId}:${ttsContent}` to handle cases where the same session
 * might replay with different content.
 */

const sessionsWithTTSPlayed = new Set<string>()

/**
 * Check if TTS has already been played for a specific session + content combination.
 */
export function hasTTSPlayed(ttsKey: string): boolean {
  return sessionsWithTTSPlayed.has(ttsKey)
}

/**
 * Mark TTS as played for a specific session + content combination.
 */
export function markTTSPlayed(ttsKey: string): void {
  sessionsWithTTSPlayed.add(ttsKey)
}

/**
 * Remove a TTS key from tracking (e.g., on failure or unmount during generation).
 */
export function removeTTSKey(ttsKey: string): void {
  sessionsWithTTSPlayed.delete(ttsKey)
}

/**
 * Clear TTS tracking for a specific session. Call this when a session is dismissed
 * to allow TTS to play again if the session is somehow restored.
 */
export function clearSessionTTSTracking(sessionId: string): void {
  // Remove all entries that start with this sessionId
  for (const key of sessionsWithTTSPlayed) {
    if (key.startsWith(`${sessionId}:`)) {
      sessionsWithTTSPlayed.delete(key)
    }
  }
}

