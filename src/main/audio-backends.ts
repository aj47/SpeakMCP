import type { AudioBackend } from "./audio-backend"
import { audioService } from "./audio-service"
import { MacDesktopAndMicBackend } from "./audio-backend-mac"
import { configStore } from "./config"

let backend: AudioBackend | null = null

export function getAudioBackend(): AudioBackend {
  if (backend) return backend

  const config = configStore.get()

  if (process.platform === "darwin" && config.useSystemAudioTap) {
    backend = new MacDesktopAndMicBackend()
  } else {
    backend = audioService
  }

  return backend
}
