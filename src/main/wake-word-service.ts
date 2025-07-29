import { EventEmitter } from "events"
import { configStore } from "./config"
import { WakeWordConfig } from "../shared/types"
import { diagnosticsService } from "./diagnostics"

// For production use, uncomment these imports:
// import { Porcupine } from "@picovoice/porcupine-node"
// import { PvRecorder } from "@picovoice/pvrecorder-node"

export interface WakeWordDetectionEvent {
  wakeWord: string
  timestamp: number
  confidence?: number
}

export class WakeWordService extends EventEmitter {
  private isActive = false
  private isDetecting = false
  private demoTimer?: NodeJS.Timeout
  private config: WakeWordConfig = {}
  
  // For production use:
  // private porcupine?: Porcupine
  // private recorder?: PvRecorder

  constructor() {
    super()
    this.updateConfig()
  }

  private updateConfig() {
    const appConfig = configStore.get()
    this.config = appConfig.wakeWord || {}
  }

  async initialize(): Promise<void> {
    try {
      this.updateConfig()
      
      if (!this.config.enabled) {
        return
      }

      // Demo mode implementation
      // In production, this would initialize Picovoice Porcupine
      console.log("Wake word service initialized in demo mode")
      diagnosticsService.logInfo("wake-word-service", "Initialized in demo mode")
      
      // For production use:
      /*
      if (!this.config.accessKey) {
        throw new Error("Picovoice access key is required")
      }

      this.porcupine = new Porcupine(
        this.config.accessKey,
        [this.config.wakeWord || "hey computer"],
        [this.config.sensitivity || 0.5]
      )

      this.recorder = new PvRecorder(512) // Frame length
      */
      
    } catch (error) {
      diagnosticsService.logError("wake-word-service", "Failed to initialize", error)
      throw error
    }
  }

  async startDetection(): Promise<void> {
    if (this.isDetecting) {
      return
    }

    try {
      this.updateConfig()
      
      if (!this.config.enabled) {
        throw new Error("Wake word detection is disabled")
      }

      this.isDetecting = true
      this.emit("detectionStarted")
      
      // Demo mode: simulate detection every 30 seconds
      this.startDemoMode()
      
      // For production use:
      /*
      if (!this.recorder || !this.porcupine) {
        await this.initialize()
      }

      this.recorder!.start()
      
      const frameLength = this.porcupine!.frameLength
      
      while (this.isDetecting) {
        const pcm = await this.recorder!.read()
        const keywordIndex = this.porcupine!.process(pcm)
        
        if (keywordIndex >= 0) {
          const detectionEvent: WakeWordDetectionEvent = {
            wakeWord: this.config.wakeWord || "hey computer",
            timestamp: Date.now(),
            confidence: this.config.sensitivity
          }
          
          this.emit("wakeWordDetected", detectionEvent)
          
          // Pause detection for the configured timeout
          await this.pauseDetection()
        }
      }
      */
      
    } catch (error) {
      this.isDetecting = false
      diagnosticsService.logError("wake-word-service", "Failed to start detection", error)
      this.emit("detectionError", error)
      throw error
    }
  }

  private startDemoMode(): void {
    if (this.demoTimer) {
      clearTimeout(this.demoTimer)
    }

    const scheduleNextDetection = () => {
      if (!this.isDetecting) return
      
      this.demoTimer = setTimeout(() => {
        if (this.isDetecting) {
          const detectionEvent: WakeWordDetectionEvent = {
            wakeWord: this.config.wakeWord || "hey computer",
            timestamp: Date.now(),
            confidence: this.config.sensitivity || 0.5
          }
          
          console.log("Demo wake word detected:", detectionEvent)
          this.emit("wakeWordDetected", detectionEvent)
          
          // Schedule next detection
          scheduleNextDetection()
        }
      }, 30000) // 30 seconds for demo
    }

    scheduleNextDetection()
  }

  async stopDetection(): Promise<void> {
    if (!this.isDetecting) {
      return
    }

    this.isDetecting = false
    
    // Clear demo timer
    if (this.demoTimer) {
      clearTimeout(this.demoTimer)
      this.demoTimer = undefined
    }
    
    // For production use:
    /*
    if (this.recorder) {
      this.recorder.stop()
    }
    */
    
    this.emit("detectionStopped")
    diagnosticsService.logInfo("wake-word-service", "Detection stopped")
  }

  private async pauseDetection(): Promise<void> {
    const timeout = (this.config.recordingTimeout || 5) * 1000
    
    await this.stopDetection()
    
    setTimeout(async () => {
      if (this.config.enabled) {
        await this.startDetection()
      }
    }, timeout)
  }

  async cleanup(): Promise<void> {
    await this.stopDetection()
    
    // For production use:
    /*
    if (this.porcupine) {
      this.porcupine.release()
      this.porcupine = undefined
    }
    
    if (this.recorder) {
      this.recorder.release()
      this.recorder = undefined
    }
    */
    
    this.removeAllListeners()
    diagnosticsService.logInfo("wake-word-service", "Service cleaned up")
  }

  isDetectionActive(): boolean {
    return this.isDetecting
  }

  getConfig(): WakeWordConfig {
    return { ...this.config }
  }

  async updateSettings(newConfig: Partial<WakeWordConfig>): Promise<void> {
    const currentConfig = configStore.get()
    const updatedWakeWordConfig = {
      ...currentConfig.wakeWord,
      ...newConfig
    }

    configStore.save({
      ...currentConfig,
      wakeWord: updatedWakeWordConfig
    })

    this.updateConfig()

    // Restart detection if it was active and settings changed
    if (this.isDetecting) {
      await this.stopDetection()
      if (this.config.enabled) {
        await this.startDetection()
      }
    }
  }

  getAvailableWakeWords(): string[] {
    return [
      "hey computer",
      "hey porcupine", 
      "alexa",
      "americano",
      "blueberry",
      "bumblebee",
      "grapefruit",
      "grasshopper",
      "picovoice",
      "porcupine",
      "terminator"
    ]
  }
}

// Singleton instance
export const wakeWordService = new WakeWordService()
