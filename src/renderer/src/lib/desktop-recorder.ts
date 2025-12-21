import EventEmitter from "./event-emitter"
import { tipcClient } from "./tipc-client"

export class DesktopRecorder extends EventEmitter<{
  "session-start": []
  "session-end": []
  error: [Error]
}> {
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
}

