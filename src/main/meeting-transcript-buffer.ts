/**
 * Meeting Transcript Buffer
 *
 * Maintains a rolling buffer of recent transcript chunks during desktop recording.
 * Used by Meeting Mode to provide context to the AI agent when the hotkey is pressed.
 */

import { configStore } from "./config"

interface TranscriptChunk {
  text: string
  timestamp: number // Unix timestamp in milliseconds
}

class MeetingTranscriptBuffer {
  private chunks: TranscriptChunk[] = []
  private isRecording: boolean = false

  /**
   * Start a new meeting recording session.
   * Clears any existing transcript data.
   */
  startSession(): void {
    this.chunks = []
    this.isRecording = true
  }

  /**
   * End the current meeting recording session.
   */
  endSession(): void {
    this.isRecording = false
    // Keep chunks for a short time after session ends in case user wants to query
    // They will be cleared on next startSession()
  }

  /**
   * Check if a meeting recording session is active.
   */
  isSessionActive(): boolean {
    return this.isRecording
  }

  /**
   * Add a new transcript chunk to the buffer.
   * @param text The transcribed text
   */
  addChunk(text: string): void {
    if (!text.trim()) return

    this.chunks.push({
      text: text.trim(),
      timestamp: Date.now(),
    })

    // Clean up old chunks beyond the max context duration
    this.pruneOldChunks()
  }

  /**
   * Get the recent transcript within the configured context duration.
   * @returns The combined transcript text from recent chunks
   */
  getRecentTranscript(): string {
    const config = configStore.get()
    const contextDurationMs = (config.meetingModeContextDuration || 120) * 1000
    const cutoffTime = Date.now() - contextDurationMs

    const recentChunks = this.chunks.filter(
      (chunk) => chunk.timestamp >= cutoffTime
    )

    if (recentChunks.length === 0) {
      return ""
    }

    return recentChunks.map((chunk) => chunk.text).join(" ")
  }

  /**
   * Get the recent transcript with timestamps for debugging/display.
   * @returns Array of chunks with relative timestamps
   */
  getRecentChunksWithTimestamps(): Array<{ text: string; secondsAgo: number }> {
    const config = configStore.get()
    const contextDurationMs = (config.meetingModeContextDuration || 120) * 1000
    const cutoffTime = Date.now() - contextDurationMs
    const now = Date.now()

    return this.chunks
      .filter((chunk) => chunk.timestamp >= cutoffTime)
      .map((chunk) => ({
        text: chunk.text,
        secondsAgo: Math.round((now - chunk.timestamp) / 1000),
      }))
  }

  /**
   * Check if there is any recent transcript available.
   */
  hasRecentTranscript(): boolean {
    return this.getRecentTranscript().length > 0
  }

  /**
   * Clear all transcript data.
   */
  clear(): void {
    this.chunks = []
  }

  /**
   * Remove chunks that are older than the max context duration.
   */
  private pruneOldChunks(): void {
    const config = configStore.get()
    // Keep chunks for 2x the context duration to allow for some buffer
    const maxDurationMs = (config.meetingModeContextDuration || 120) * 1000 * 2
    const cutoffTime = Date.now() - maxDurationMs

    this.chunks = this.chunks.filter((chunk) => chunk.timestamp >= cutoffTime)
  }
}

// Export singleton instance
export const meetingTranscriptBuffer = new MeetingTranscriptBuffer()

