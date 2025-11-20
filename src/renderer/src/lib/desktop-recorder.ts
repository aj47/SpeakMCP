import EventEmitter from "./event-emitter"
import { tipcClient } from "./tipc-client"

const CHUNK_INTERVAL_MS = 60_000 // 60 seconds per chunk for long recordings

export class DesktopRecorder extends EventEmitter<{
  "session-start": []
  "session-end": []
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
  private isRecording = false


  async start() {
    console.log("[DesktopRecorder] start() called (native/main pipeline)")

    if (this.isRecording) {
      // Best-effort stop previous session before starting a new one
      await this.stop()
    }

    try {
      await tipcClient.startDesktopLongRecording()
      this.isRecording = true
      this.emit("session-start")
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit("error", error)
      this.isRecording = false
    }
  }

  async stop() {
    if (!this.isRecording) {
      return
    }

    try {
      await tipcClient.stopDesktopLongRecording()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit("error", error)
    } finally {
      this.isRecording = false
      this.emit("session-end")
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

