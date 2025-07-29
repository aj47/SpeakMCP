import { EventEmitter } from "events"
import { configStore } from "./config"
import { WakeWordConfig } from "../shared/types"
import { diagnosticsService } from "./diagnostics"
import { BrowserWindow } from "electron"
import { WINDOWS } from "./window"

export interface WakeWordDetectionEvent {
  wakeWord: string
  timestamp: number
  confidence?: number
}

export class WakeWordService extends EventEmitter {
  private isActive = false
  private isDetecting = false
  private config: WakeWordConfig = {}
  private recognitionWindow?: BrowserWindow

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

      // Create a hidden window for Web Speech API
      await this.createRecognitionWindow()

      console.log("Wake word service initialized with Web Speech API")
      diagnosticsService.logInfo("wake-word-service", "Initialized with Web Speech API")

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

      if (!this.recognitionWindow) {
        await this.createRecognitionWindow()
      }

      this.isDetecting = true
      this.emit("detectionStarted")

      // Start Web Speech API recognition
      await this.startWebSpeechRecognition()

    } catch (error) {
      this.isDetecting = false
      diagnosticsService.logError("wake-word-service", "Failed to start detection", error)
      this.emit("detectionError", error)
      throw error
    }
  }

  private async createRecognitionWindow(): Promise<void> {
    if (this.recognitionWindow && !this.recognitionWindow.isDestroyed()) {
      return
    }

    this.recognitionWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    })

    // Load a minimal HTML page for Web Speech API
    await this.recognitionWindow.loadURL(`data:text/html,
      <!DOCTYPE html>
      <html>
        <head><title>Wake Word Recognition</title></head>
        <body>
          <script>
            let recognition = null;
            let isListening = false;

            window.electronAPI = {
              startRecognition: (config) => {
                if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                  throw new Error('Web Speech API not supported');
                }

                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                recognition = new SpeechRecognition();

                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onresult = (event) => {
                  for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript.toLowerCase().trim();

                    if (transcript.includes(config.wakeWord.toLowerCase())) {
                      window.postMessage({
                        type: 'wakeWordDetected',
                        data: {
                          wakeWord: config.wakeWord,
                          transcript: transcript,
                          timestamp: Date.now(),
                          confidence: event.results[i][0].confidence || config.sensitivity
                        }
                      }, '*');
                    }
                  }
                };

                recognition.onerror = (event) => {
                  window.postMessage({
                    type: 'recognitionError',
                    data: { error: event.error }
                  }, '*');
                };

                recognition.onend = () => {
                  if (isListening) {
                    // Restart recognition if we're still supposed to be listening
                    setTimeout(() => {
                      if (isListening && recognition) {
                        recognition.start();
                      }
                    }, 100);
                  }
                };

                isListening = true;
                recognition.start();
              },

              stopRecognition: () => {
                isListening = false;
                if (recognition) {
                  recognition.stop();
                  recognition = null;
                }
              }
            };
          </script>
        </body>
      </html>
    `)

    // Set up message handling
    this.recognitionWindow.webContents.on('console-message', (_event, _level, message) => {
      console.log('Recognition window:', message)
    })
  }

  private async startWebSpeechRecognition(): Promise<void> {
    if (!this.recognitionWindow || this.recognitionWindow.isDestroyed()) {
      throw new Error("Recognition window not available")
    }

    // Set up message listener for wake word detection
    this.recognitionWindow.webContents.on('did-finish-load', () => {
      this.recognitionWindow!.webContents.executeJavaScript(`
        window.addEventListener('message', (event) => {
          if (event.data.type === 'wakeWordDetected') {
            console.log('Wake word detected:', event.data.data);
          } else if (event.data.type === 'recognitionError') {
            console.error('Recognition error:', event.data.data);
          }
        });

        window.electronAPI.startRecognition({
          wakeWord: '${this.config.wakeWord || "hey computer"}',
          sensitivity: ${this.config.sensitivity || 0.5}
        });
      `)
    })

    // Handle messages from the recognition window
    this.recognitionWindow.webContents.on('console-message', (_event, _level, message) => {
      if (message.includes('Wake word detected:')) {
        try {
          const data = JSON.parse(message.split('Wake word detected: ')[1])
          const detectionEvent: WakeWordDetectionEvent = {
            wakeWord: data.wakeWord,
            timestamp: data.timestamp,
            confidence: data.confidence
          }

          console.log("Web Speech API wake word detected:", detectionEvent)
          this.emit("wakeWordDetected", detectionEvent)

          // Pause detection for the configured timeout
          this.pauseDetection()
        } catch (error) {
          console.error("Failed to parse wake word detection data:", error)
        }
      } else if (message.includes('Recognition error:')) {
        console.error("Web Speech API error:", message)
        this.emit("detectionError", new Error(message))
      }
    })
  }

  async stopDetection(): Promise<void> {
    if (!this.isDetecting) {
      return
    }

    this.isDetecting = false

    // Stop Web Speech API recognition
    if (this.recognitionWindow && !this.recognitionWindow.isDestroyed()) {
      await this.recognitionWindow.webContents.executeJavaScript(`
        if (window.electronAPI && window.electronAPI.stopRecognition) {
          window.electronAPI.stopRecognition();
        }
      `)
    }

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

    // Close recognition window
    if (this.recognitionWindow && !this.recognitionWindow.isDestroyed()) {
      this.recognitionWindow.close()
      this.recognitionWindow = undefined
    }

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
      "hey assistant",
      "wake up",
      "listen up",
      "computer",
      "assistant",
      "hello computer",
      "hello assistant",
      "start listening",
      "activate",
      "voice command"
    ]
  }
}

// Singleton instance
export const wakeWordService = new WakeWordService()
