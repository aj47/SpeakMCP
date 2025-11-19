import EventEmitter from "./event-emitter"

const CHUNK_INTERVAL_MS = 60_000 // 60 seconds per chunk for long recordings

export class DesktopRecorder extends EventEmitter<{
  "session-start": []
  "chunk": [Blob, number]
  "session-end": [Blob, number]
  error: [Error]
}> {
  private desktopStream: MediaStream | null = null
  private micStream: MediaStream | null = null
  private mixedStream: MediaStream | null = null
  private mediaRecorder: MediaRecorder | null = null

  private audioContext: AudioContext | null = null
  private desktopSource: MediaStreamAudioSourceNode | null = null
  private micSource: MediaStreamAudioSourceNode | null = null

  private chunks: Blob[] = []
  private startTime = 0
  private lastChunkTime = 0

  async start() {
    // Ensure any previous recording is cleaned up
    this.stop()
    console.log("[DesktopRecorder] start() called")



    try {
      const mediaDevices: MediaDevices & {
        getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream>
      } = navigator.mediaDevices as any

      if (!mediaDevices.getDisplayMedia) {
        throw new Error("Screen capture is not supported in this environment")
      }

      // Capture desktop (screen/window) with audio
      this.desktopStream = await mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })

      // Capture microphone audio
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })

      this.audioContext = new AudioContext()
      const destination = this.audioContext.createMediaStreamDestination()

      if (this.desktopStream.getAudioTracks().length > 0) {
        this.desktopSource = this.audioContext.createMediaStreamSource(this.desktopStream)
        this.desktopSource.connect(destination)
      }

      if (this.micStream.getAudioTracks().length > 0) {
        this.micSource = this.audioContext.createMediaStreamSource(this.micStream)
        this.micSource.connect(destination)
      }

      this.mixedStream = destination.stream

      this.mediaRecorder = new MediaRecorder(this.mixedStream, {
        audioBitsPerSecond: 128e3,
      })

      this.chunks = []
      this.startTime = performance.now()
      this.lastChunkTime = this.startTime

      this.mediaRecorder.onstart = () => {
        this.emit("session-start")
      }

      this.mediaRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return

        const now = performance.now()
        const chunkDuration = now - this.lastChunkTime
        this.lastChunkTime = now

        this.chunks.push(event.data)
        this.emit("chunk", event.data, chunkDuration)
      }

      this.mediaRecorder.onstop = () => {
        const endTime = performance.now()
        const totalDuration = endTime - this.startTime

        const finalBlob = new Blob(this.chunks, {
          type: this.mediaRecorder?.mimeType || "audio/webm",
        })

        this.emit("session-end", finalBlob, totalDuration)
        this.cleanup()
      }

      this.mediaRecorder.onerror = (event: any) => {
        const error = event?.error || new Error("Unknown MediaRecorder error")
        this.emit("error", error)
        this.cleanup()
      }

      // Start recording with a large timeslice so we get periodic chunks
      this.mediaRecorder.start(CHUNK_INTERVAL_MS)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit("error", error)
      this.cleanup()
    }
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop()
    } else {
      this.cleanup()
    }
  }

  private cleanup() {
    this.mediaRecorder = null

    if (this.desktopSource) {
      this.desktopSource.disconnect()
      this.desktopSource = null
    }

    if (this.micSource) {
      this.micSource.disconnect()
      this.micSource = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    if (this.desktopStream) {
      this.desktopStream.getTracks().forEach((track) => track.stop())
      this.desktopStream = null
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop())
      this.micStream = null
    }

    if (this.mixedStream) {
      this.mixedStream.getTracks().forEach((track) => track.stop())
      this.mixedStream = null
    }

    this.chunks = []
    this.startTime = 0
    this.lastChunkTime = 0
  }
}

