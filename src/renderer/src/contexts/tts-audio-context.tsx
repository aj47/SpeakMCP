import React, { createContext, useContext, useRef, useCallback } from "react"

interface TTSAudioContextType {
  registerAudioElement: (id: string, audioElement: HTMLAudioElement) => void
  unregisterAudioElement: (id: string) => void
  stopAllAudio: () => void
}

const TTSAudioContext = createContext<TTSAudioContextType | undefined>(undefined)

export function TTSAudioProvider({ children }: { children: React.ReactNode }) {
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  const registerAudioElement = useCallback((id: string, audioElement: HTMLAudioElement) => {
    audioElementsRef.current.set(id, audioElement)
  }, [])

  const unregisterAudioElement = useCallback((id: string) => {
    audioElementsRef.current.delete(id)
  }, [])

  const stopAllAudio = useCallback(() => {
    console.log("[TTS Audio Manager] Stopping all audio playback")
    audioElementsRef.current.forEach((audioElement, id) => {
      try {
        if (!audioElement.paused) {
          audioElement.pause()
          audioElement.currentTime = 0
          console.log(`[TTS Audio Manager] Stopped audio: ${id}`)
        }
      } catch (error) {
        console.error(`[TTS Audio Manager] Error stopping audio ${id}:`, error)
      }
    })
  }, [])

  return (
    <TTSAudioContext.Provider
      value={{
        registerAudioElement,
        unregisterAudioElement,
        stopAllAudio,
      }}
    >
      {children}
    </TTSAudioContext.Provider>
  )
}

export function useTTSAudio() {
  const context = useContext(TTSAudioContext)
  if (!context) {
    throw new Error("useTTSAudio must be used within a TTSAudioProvider")
  }
  return context
}

