/**
 * Global TTS Manager
 * Manages all TTS audio playback and provides emergency stop functionality
 */

class TTSManager {
  private audioElements: Set<HTMLAudioElement> = new Set()
  private stopCallbacks: Set<(() => void)> = new Set()
  private playingStateListeners: Set<((isPlaying: boolean) => void)> = new Set()

  /**
   * Register an audio element for tracking
   */
  registerAudio(audio: HTMLAudioElement): () => void {
    this.audioElements.add(audio)

    // Add event listeners to track playing state
    const handlePlay = () => this.notifyPlayingStateChange()
    const handlePause = () => this.notifyPlayingStateChange()
    const handleEnded = () => this.notifyPlayingStateChange()

    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    // Return cleanup function
    return () => {
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      this.audioElements.delete(audio)
      this.notifyPlayingStateChange()
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

    // Notify listeners that playing state changed
    this.notifyPlayingStateChange()
  }

  /**
   * Check if any audio is currently playing
   */
  isAnyPlaying(): boolean {
    for (const audio of this.audioElements) {
      if (!audio.paused && !audio.ended) {
        return true
      }
    }
    return false
  }

  /**
   * Subscribe to playing state changes
   */
  onPlayingStateChange(listener: (isPlaying: boolean) => void): () => void {
    this.playingStateListeners.add(listener)

    // Immediately notify with current state
    listener(this.isAnyPlaying())

    // Return cleanup function
    return () => {
      this.playingStateListeners.delete(listener)
    }
  }

  /**
   * Notify all listeners of playing state change
   */
  private notifyPlayingStateChange(): void {
    const isPlaying = this.isAnyPlaying()
    this.playingStateListeners.forEach((listener) => {
      try {
        listener(isPlaying)
      } catch (error) {
        console.error('[TTS Manager] Error notifying listener:', error)
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

