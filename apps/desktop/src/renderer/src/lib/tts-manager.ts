/**
 * Global TTS Manager
 * Manages all TTS audio playback and provides emergency stop functionality
 */

class TTSManager {
  private audioElements: Set<HTMLAudioElement> = new Set()
  private stopCallbacks: Set<(() => void)> = new Set()

  /**
   * Register an audio element for tracking
   */
  registerAudio(audio: HTMLAudioElement): () => void {
    this.audioElements.add(audio)

    // Return cleanup function
    return () => {
      this.audioElements.delete(audio)
    }
  }

  /**
   * Register a callback to be called when emergency stop is triggered
   */
  registerStopCallback(callback: () => void): () => void {
    this.stopCallbacks.add(callback)

    // Return cleanup function
    return () => {
      this.stopCallbacks.delete(callback)
    }
  }

  /**
   * Stop all currently playing TTS audio
   */
  stopAll(): void {
    console.log('[TTS Manager] Stopping all TTS audio')

    // Stop all registered audio elements
    this.audioElements.forEach((audio) => {
      try {
        audio.pause()
        audio.currentTime = 0
      } catch (error) {
        console.error('[TTS Manager] Error stopping audio:', error)
      }
    })

    // Call all registered stop callbacks
    this.stopCallbacks.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.error('[TTS Manager] Error calling stop callback:', error)
      }
    })
  }

  /**
   * Get count of registered audio elements
   */
  getAudioCount(): number {
    return this.audioElements.size
  }
}

// Export singleton instance
export const ttsManager = new TTSManager()

