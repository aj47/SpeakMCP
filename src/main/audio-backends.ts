import type { AudioBackend } from "./audio-backend"
import { audioService } from "./audio-service"
import { MacDesktopAndMicBackend } from "./audio-backend-mac"

let backend: AudioBackend | null = null

export function getAudioBackend(): AudioBackend {
  if (backend) return backend

	  if (process.platform === "darwin") {
		    backend = new MacDesktopAndMicBackend()
	  } else {
	    backend = audioService
	  }

  return backend
}

