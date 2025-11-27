import { spawn, ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import fs from "fs"
import { EventEmitter } from "events"
import { logApp } from "./debug"
import type { AudioBackend } from "./audio-backend"

export type AudioChunkInfo = {
  sessionId: string
  sequence: number
  sampleRate: number
  channels: number
}

export type AudioServiceEvents = {
  "audio-chunk": [Buffer, AudioChunkInfo]
  error: [Error]
}

// Simple typed EventEmitter wrapper
class TypedEmitter<T extends Record<string, any[]>> extends EventEmitter {
  onTyped<K extends keyof T>(event: K, listener: (...args: T[K]) => void) {
    return super.on(event as string, listener)
  }

  onceTyped<K extends keyof T>(event: K, listener: (...args: T[K]) => void) {
    return super.once(event as string, listener)
  }

  emitTyped<K extends keyof T>(event: K, ...args: T[K]) {
    return super.emit(event as string, ...args)
  }
}

class AudioService extends TypedEmitter<AudioServiceEvents> implements AudioBackend {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ""
  private seenSessionIds = new Set<string>()


  private getBinaryPath() {
    const base = path
      .join(
        __dirname,
        `../../resources/bin/speakmcp-audio${process.platform === "win32" ? ".exe" : ""}`,
      )
      .replace("app.asar", "app.asar.unpacked")

    return base
  }

  private ensureProcess() {
    if (this.child && !this.child.killed) return

    const binaryPath = this.getBinaryPath()

    if (!fs.existsSync(binaryPath)) {
      const error = new Error(
        `Audio capture binary not found at ${binaryPath}. Please run \"npm run build-rs\" to build the Rust audio helper.`,
      )
      logApp("[AUDIO]", error.message)
      throw error
    }

    logApp(`[AUDIO] Starting audio capture service: ${binaryPath}`)

    const child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams

    child.on("error", (err) => {
      const error = err instanceof Error ? err : new Error(String(err))
      this.emitTyped("error", error)
    })

    child.stderr.on("data", (data: Buffer) => {
      logApp(`[AUDIO] stderr: ${data.toString().trim()}`)
    })

    child.stdout.on("data", (data: Buffer) => {
      this.stdoutBuffer += data.toString("utf8")

      let idx: number
      while ((idx = this.stdoutBuffer.indexOf("\n")) !== -1) {
        const line = this.stdoutBuffer.slice(0, idx).trim()
        this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1)
        if (!line) continue

        try {
          const msg = JSON.parse(line)
          if (msg.type === "error") {
            const error = new Error(msg.message || "Audio service error")
            this.emitTyped("error", error)
          } else if (msg.type === "audio_chunk" && typeof msg.data === "string") {
            try {
              const buffer = Buffer.from(msg.data, "base64")
              const info: AudioChunkInfo = {
                sessionId: msg.id,
                sequence: typeof msg.sequence === "number" ? msg.sequence : 0,
                sampleRate: typeof msg.sampleRate === "number" ? msg.sampleRate : 48000,
                channels: typeof msg.channels === "number" ? msg.channels : 1,
              }

              if (!this.seenSessionIds.has(info.sessionId)) {
                this.seenSessionIds.add(info.sessionId)
                logApp(
                  `[AUDIO] First chunk for session ${info.sessionId} sequence=${info.sequence} bytes=${buffer.length} sampleRate=${info.sampleRate} channels=${info.channels}`,
                )
              }

              this.emitTyped("audio-chunk", buffer, info)
            } catch (e) {
              logApp(`[AUDIO] Failed to decode audio chunk: ${String(e)}`)
            }
          }
        } catch (err) {
          logApp(`[AUDIO] Failed to parse message: ${line}`)
        }
      }
    })
    this.child = child
  }


  onAudioChunk(
    handler: (
      buffer: Buffer,
      info: { sessionId: string; sequence: number; sampleRate: number; channels: number },
    ) => void,
  ) {
    this.onTyped("audio-chunk", handler)
  }

  onError(handler: (error: Error) => void) {
    this.onTyped("error", handler)
  }

  async startCapture(sessionId: string): Promise<void> {
    await this.startSystemCapture(sessionId)
  }

  async stopCapture(sessionId: string): Promise<void> {
    await this.stopCaptureInternal(sessionId)
  }




  async startSystemCapture(sessionId: string): Promise<void> {
    // Placeholder implementation: we will implement real capture per-OS
    // in the Rust audio service. For now this just ensures the process
    // exists and logs the request.
    this.ensureProcess()
    logApp(`[AUDIO] startSystemCapture requested for session ${sessionId}`)

    const payload = {
      type: "start_capture",
      id: sessionId,
      kind: "system",
    }

    this.child?.stdin.write(JSON.stringify(payload) + "\n")
  }

  private async stopCaptureInternal(sessionId: string): Promise<void> {
    if (!this.child || this.child.killed) return

    const payload = {
      type: "stop_capture",
      id: sessionId,
    }

    this.child.stdin.write(JSON.stringify(payload) + "\n")
  }


  shutdown() {
    if (!this.child || this.child.killed) return

    try {
      this.child.stdin.write(JSON.stringify({ type: "shutdown" }) + "\n")
    } catch {
      // ignore
    }

    this.child.kill()
    this.child = null
  }
}

export const audioService = new AudioService()

