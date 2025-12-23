class TTSManager {
  private audioElements: Set<HTMLAudioElement> = new Set()
  private stopCallbacks: Set<(() => void)> = new Set()

  registerAudio(audio: HTMLAudioElement): () => void {
    this.audioElements.add(audio)
    return () => {
      this.audioElements.delete(audio)
    }
  }

  registerStopCallback(callback: () => void): () => void {
    this.stopCallbacks.add(callback)
    return () => {
      this.stopCallbacks.delete(callback)
    }
  }

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

  getAudioCount(): number {
    return this.audioElements.size
  }
}

export const ttsManager = new TTSManager()

