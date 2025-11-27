import type { AudioBackend } from "./audio-backend"
import { logApp } from "./debug"
import { audioService } from "./audio-service"
import { mixTracksToPcmS16le } from "./audio-mixing"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import fs from "fs"

/**
 * Get the path to the screencapture-audio binary.
 * In development: macos-audio-tap/ScreenCaptureAudio/.build/release/screencapture-audio
 * In production: resources/bin/screencapture-audio (via process.resourcesPath)
 */
function getScreenCaptureAudioPath(): string {
  // Production path (packaged app)
  // electron-builder copies extraResources to process.resourcesPath
  const prodPath = path
    .join(process.resourcesPath, "bin/screencapture-audio")
    .replace("app.asar", "app.asar.unpacked")

  if (fs.existsSync(prodPath)) {
    return prodPath
  }

  // Development path
  const devPath = path.join(
    __dirname,
    "../../macos-audio-tap/ScreenCaptureAudio/.build/release/screencapture-audio",
  )

  if (fs.existsSync(devPath)) {
    return devPath
  }

  // Fallback: check resources/bin relative to __dirname for dev mode
  const fallbackPath = path.join(__dirname, "../../resources/bin/screencapture-audio")

  if (fs.existsSync(fallbackPath)) {
    return fallbackPath
  }

  return devPath
}

/**
 * macOS-specific AudioBackend that uses ScreenCaptureKit via a Swift CLI
 * to capture desktop/system audio. Falls back to a synthetic stub if the
 * CLI is not available.
 */
export class MacSystemTapBackend implements AudioBackend {
  private audioHandlers: Array<(
    buffer: Buffer,
    info: { sessionId: string; sequence: number; sampleRate: number; channels: number },
  ) => void> = []
  private errorHandlers: Array<(err: Error) => void> = []

  private runningSession: string | null = null
  private captureProcess: ChildProcessWithoutNullStreams | null = null
  private sequence = 0

  async startCapture(sessionId: string): Promise<void> {
    if (this.runningSession) {
      logApp(
        "[MacSystemTapBackend] startCapture called while a session is already running; restarting",
        "previousSessionId=",
        this.runningSession,
        "newSessionId=",
        sessionId,
      )
      await this.stopCapture(this.runningSession)
    }

    this.runningSession = sessionId
    this.sequence = 0

    const binaryPath = getScreenCaptureAudioPath()

    if (!fs.existsSync(binaryPath)) {
      logApp(
        `[MacSystemTapBackend] screencapture-audio binary not found at ${binaryPath}, using synthetic stub`,
      )
      this.startSyntheticCapture(sessionId)
      return
    }

    logApp(`[MacSystemTapBackend] Starting ScreenCaptureKit capture: ${binaryPath}`)

    const sampleRate = 48_000
    const channels = 2

    try {
      const child = spawn(binaryPath, [], {
        stdio: ["pipe", "pipe", "pipe"],
      })

      child.on("error", (err) => {
        logApp(`[MacSystemTapBackend] Process error: ${err.message}`)
        this.emitError(err)
      })

      child.on("exit", (code, signal) => {
        logApp(`[MacSystemTapBackend] Process exited with code=${code} signal=${signal}`)
        if (this.captureProcess === child) {
          this.captureProcess = null
        }
      })

      child.stderr.on("data", (data: Buffer) => {
        logApp(`[MacSystemTapBackend] stderr: ${data.toString().trim()}`)
      })

      // The Swift CLI outputs raw 16-bit PCM to stdout
      child.stdout.on("data", (data: Buffer) => {
        if (!this.runningSession || this.runningSession !== sessionId) return

        for (const handler of this.audioHandlers) {
          handler(data, {
            sessionId,
            sequence: this.sequence++,
            sampleRate,
            channels,
          })
        }
      })

      this.captureProcess = child
      logApp(`[MacSystemTapBackend] Started ScreenCaptureKit audio capture for session ${sessionId}`)
    } catch (err) {
      logApp(`[MacSystemTapBackend] Failed to start capture process: ${err}`)
      this.emitError(err instanceof Error ? err : new Error(String(err)))
      // Fall back to synthetic
      this.startSyntheticCapture(sessionId)
    }
  }

  private syntheticInterval: NodeJS.Timeout | null = null

  private startSyntheticCapture(sessionId: string): void {
    // Synthetic backend: emit silence at 48kHz stereo in small chunks
    const sampleRate = 48_000
    const channels = 2
    const chunkDurationMs = 250
    const framesPerChunk = (sampleRate * chunkDurationMs) / 1000
    const bytesPerFrame = channels * 2 // 16-bit PCM
    const bytesPerChunk = framesPerChunk * bytesPerFrame

    this.syntheticInterval = setInterval(() => {
      if (!this.runningSession) return

      const buffer = Buffer.alloc(bytesPerChunk) // silence

      for (const handler of this.audioHandlers) {
        handler(buffer, {
          sessionId: this.runningSession,
          sequence: this.sequence++,
          sampleRate,
          channels,
        })
      }
    }, chunkDurationMs)

    logApp(`[MacSystemTapBackend] Started synthetic audio capture for session ${sessionId}`)
  }

  async stopCapture(sessionId: string): Promise<void> {
    if (!this.runningSession || this.runningSession !== sessionId) {
      return
    }

    // Stop the Swift CLI process
    if (this.captureProcess && !this.captureProcess.killed) {
      this.captureProcess.kill("SIGTERM")
      this.captureProcess = null
    }

    // Stop synthetic interval if active
    if (this.syntheticInterval) {
      clearInterval(this.syntheticInterval)
      this.syntheticInterval = null
    }

    logApp("[MacSystemTapBackend] Stopped audio capture for session", sessionId)
    this.runningSession = null
  }

  onAudioChunk(
    handler: (
      buffer: Buffer,
      info: { sessionId: string; sequence: number; sampleRate: number; channels: number },
    ) => void,
  ): void {
    this.audioHandlers.push(handler)
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler)
  }

  // Helper to surface backend errors to all subscribers
  private emitError(error: Error) {
    for (const handler of this.errorHandlers) {
      handler(error)
    }
  }
}

/**
 * macOS AudioBackend that combines system audio (via ScreenCaptureKit
 * through MacSystemTapBackend) and microphone audio (via the existing
 * Rust-based AudioService) into a single mixed PCM stream.
 */
export class MacDesktopAndMicBackend implements AudioBackend {
	  private readonly systemBackend = new MacSystemTapBackend()
	  private readonly micBackend = audioService

	  private audioHandlers: Array<(
	    buffer: Buffer,
	    info: { sessionId: string; sequence: number; sampleRate: number; channels: number },
	  ) => void> = []
	  private errorHandlers: Array<(err: Error) => void> = []

	  private runningSessionId: string | null = null

	  private systemBuffers: Buffer[] = []
	  private micBuffers: Buffer[] = []
	  private systemFormat: { sampleRate: number | null; channels: number | null } = {
	    sampleRate: null,
	    channels: null,
	  }
	  private micFormat: { sampleRate: number | null; channels: number | null } = {
	    sampleRate: null,
	    channels: null,
	  }

	  constructor() {
	    this.systemBackend.onAudioChunk((buffer, info) => {
	      if (!this.runningSessionId || info.sessionId !== this.runningSessionId) return

	      if (this.systemBuffers.length === 0) {
	        logApp(
	          "[MacDesktopAndMicBackend] Received first system audio chunk",
	          "sessionId=",
	          info.sessionId,
	          "bytes=",
	          buffer.length,
	          "sampleRate=",
	          info.sampleRate,
	          "channels=",
	          info.channels,
	        )
	      }

	      this.systemBuffers.push(buffer)
	      if (this.systemFormat.sampleRate == null) this.systemFormat.sampleRate = info.sampleRate
	      if (this.systemFormat.channels == null) this.systemFormat.channels = info.channels
	    })

	    this.micBackend.onAudioChunk((buffer, info) => {
	      if (!this.runningSessionId || info.sessionId !== this.runningSessionId) return

	      if (this.micBuffers.length === 0) {
	        logApp(
	          "[MacDesktopAndMicBackend] Received first mic audio chunk",
	          "sessionId=",
	          info.sessionId,
	          "bytes=",
	          buffer.length,
	          "sampleRate=",
	          info.sampleRate,
	          "channels=",
	          info.channels,
	        )
	      }

	      this.micBuffers.push(buffer)
	      if (this.micFormat.sampleRate == null) this.micFormat.sampleRate = info.sampleRate
	      if (this.micFormat.channels == null) this.micFormat.channels = info.channels
	    })

	    this.systemBackend.onError((err) => {
	      this.emitError(err)
	    })
	    this.micBackend.onError((err) => {
	      this.emitError(err)
	    })
	  }

	  async startCapture(sessionId: string): Promise<void> {
	    if (this.runningSessionId) {
	      logApp(
	        "[MacDesktopAndMicBackend] startCapture called while a session is already running; restarting",
	        "previousSessionId=",
	        this.runningSessionId,
	        "newSessionId=",
	        sessionId,
	      )
	      await this.stopCapture(this.runningSessionId)
	    }

	    this.runningSessionId = sessionId
	    this.systemBuffers = []
	    this.micBuffers = []
	    this.systemFormat = { sampleRate: null, channels: null }
	    this.micFormat = { sampleRate: null, channels: null }

	    await Promise.all([
	      this.systemBackend.startCapture(sessionId),
	      this.micBackend.startCapture(sessionId),
	    ])
	  }

	  async stopCapture(sessionId: string): Promise<void> {
	    if (!this.runningSessionId || this.runningSessionId !== sessionId) {
	      return
	    }

	    await Promise.allSettled([
	      this.systemBackend.stopCapture(sessionId),
	      this.micBackend.stopCapture(sessionId),
	    ])

	    // Allow a brief window for any final audio chunks to be delivered.
	    await new Promise((resolve) => setTimeout(resolve, 100))

    logApp(
      "[MacDesktopAndMicBackend] Mixing tracks for session",
      sessionId,
      "systemBuffers=",
      this.systemBuffers.length,
      "micBuffers=",
      this.micBuffers.length,
      "systemFormat=",
      this.systemFormat,
      "micFormat=",
      this.micFormat,
    )

    const systemTrack =
	      this.systemBuffers.length > 0 &&
	      this.systemFormat.sampleRate != null &&
	      this.systemFormat.channels != null
	        ? {
	            data: Buffer.concat(this.systemBuffers),
	            sampleRate: this.systemFormat.sampleRate,
	            channels: this.systemFormat.channels,
	          }
	        : null

	    const micTrack =
	      this.micBuffers.length > 0 &&
	      this.micFormat.sampleRate != null &&
	      this.micFormat.channels != null
	        ? {
	            data: Buffer.concat(this.micBuffers),
	            sampleRate: this.micFormat.sampleRate,
	            channels: this.micFormat.channels,
	          }
	        : null

	    if (!systemTrack && !micTrack) {
	      logApp(
	        "[MacDesktopAndMicBackend] No audio data captured from system or microphone for session",
	        sessionId,
	      )
	      this.runningSessionId = null
	      return
	    }

	    const { buffer, sampleRate, channels } = mixTracksToPcmS16le({
	      system: systemTrack || undefined,
	      mic: micTrack || undefined,
	    })

	    for (const handler of this.audioHandlers) {
	      handler(buffer, {
	        sessionId,
	        sequence: 0,
	        sampleRate,
	        channels,
	      })
	    }

	    this.runningSessionId = null
	  }

	  onAudioChunk(
	    handler: (
	      buffer: Buffer,
	      info: { sessionId: string; sequence: number; sampleRate: number; channels: number },
	    ) => void,
	  ): void {
	    this.audioHandlers.push(handler)
	  }

	  onError(handler: (error: Error) => void): void {
	    this.errorHandlers.push(handler)
	  }

	  private emitError(error: Error) {
	    for (const handler of this.errorHandlers) {
	      handler(error)
	    }
	  }
}

