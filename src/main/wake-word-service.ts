// import { Porcupine, BuiltinKeyword } from '@picovoice/porcupine-node'
// import { PvRecorder } from '@picovoice/pvrecorder-node'
import { configStore } from './config'
import { showPanelWindowAndStartMcpRecording } from './window'
import { EventEmitter } from 'events'

export class WakeWordService extends EventEmitter {
  private porcupine: any = null
  private recorder: any = null
  private isListening = false
  private isInitialized = false
  private accessKey: string | null = null
  private demoTimer: NodeJS.Timeout | null = null

  constructor() {
    super()
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      const config = configStore.get()

      if (!config.wakeWordEnabled) {
        return
      }

      // Demo implementation - in production this would initialize Porcupine
      console.log('Wake word service initialized (demo mode)')
      console.log(`Configured wake word: ${config.wakeWordKeyword || 'hey computer'}`)
      console.log(`Sensitivity: ${config.wakeWordSensitivity || 0.5}`)

      this.isInitialized = true
      this.emit('initialized')
    } catch (error) {
      console.error('Failed to initialize wake word service:', error)
      throw error
    }
  }

  private getBuiltinKeywords(keyword: string): string[] {
    // Demo implementation - return keyword as string
    return [keyword]
  }

  async startListening(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (this.isListening) {
      return
    }

    try {
      this.isListening = true

      console.log('Wake word detection started (demo mode)')
      this.emit('listening-started')

      // Demo: simulate wake word detection every 30 seconds for testing
      this.demoTimer = setInterval(() => {
        if (this.isListening) {
          console.log('Demo wake word detected!')
          this.emit('wake-word-detected', 0)
          this.handleWakeWordDetection()
        }
      }, 30000)
    } catch (error) {
      console.error('Failed to start wake word detection:', error)
      this.emit('error', error)
    }
  }



  private async handleWakeWordDetection(): Promise<void> {
    try {
      // Temporarily stop wake word detection to avoid interference
      await this.pauseListening()

      // Start MCP recording (same as Ctrl+Alt hotkey)
      await showPanelWindowAndStartMcpRecording()

      // Resume wake word detection after a timeout
      const config = configStore.get()
      const timeout = config.wakeWordTimeout || 5000
      
      setTimeout(() => {
        if (config.wakeWordEnabled) {
          this.resumeListening()
        }
      }, timeout)
    } catch (error) {
      console.error('Error handling wake word detection:', error)
      this.emit('error', error)
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isListening) {
      return
    }

    try {
      this.isListening = false

      if (this.demoTimer) {
        clearInterval(this.demoTimer)
        this.demoTimer = null
      }

      console.log('Wake word detection stopped (demo mode)')
      this.emit('listening-stopped')
    } catch (error) {
      console.error('Failed to stop wake word detection:', error)
      this.emit('error', error)
    }
  }

  private async pauseListening(): Promise<void> {
    if (this.isListening) {
      if (this.demoTimer) {
        clearInterval(this.demoTimer)
        this.demoTimer = null
      }
      this.isListening = false
      this.emit('listening-paused')
    }
  }

  private async resumeListening(): Promise<void> {
    if (!this.isListening) {
      this.isListening = true
      this.emit('listening-resumed')
      // Restart demo timer
      this.demoTimer = setInterval(() => {
        if (this.isListening) {
          console.log('Demo wake word detected!')
          this.emit('wake-word-detected', 0)
          this.handleWakeWordDetection()
        }
      }, 30000)
    }
  }

  async updateConfiguration(): Promise<void> {
    const config = configStore.get()
    
    if (config.wakeWordEnabled && !this.isListening) {
      await this.startListening()
    } else if (!config.wakeWordEnabled && this.isListening) {
      await this.stopListening()
    }
  }

  async destroy(): Promise<void> {
    await this.stopListening()

    if (this.demoTimer) {
      clearInterval(this.demoTimer)
      this.demoTimer = null
    }

    this.porcupine = null
    this.recorder = null
    this.isInitialized = false
    this.removeAllListeners()
  }

  getStatus(): { isListening: boolean; isInitialized: boolean } {
    return {
      isListening: this.isListening,
      isInitialized: this.isInitialized
    }
  }

  setAccessKey(accessKey: string): void {
    this.accessKey = accessKey
  }
}

// Singleton instance
export const wakeWordService = new WakeWordService()
