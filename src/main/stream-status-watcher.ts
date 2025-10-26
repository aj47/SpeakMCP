import fs from "fs"
import path from "path"
import { app } from "electron"
import { configStore } from "./config"
import { logApp } from "./debug"

/**
 * Service that watches the stream_status.txt file for transcription commands
 * Supports commands like: tr <file_name.ext>
 */
class StreamStatusWatcher {
  private watcher: fs.FSWatcher | null = null
  private streamStatusPath: string
  private lastContent: string = ""
  private isProcessing: boolean = false

  constructor() {
    // Default to ~/Desktop/stream_status.txt
    const homeDir = app.getPath("home")
    this.streamStatusPath = path.join(homeDir, "Desktop", "stream_status.txt")
  }

  /**
   * Start watching the stream_status.txt file
   */
  start() {
    const config = configStore.get()
    
    // Check if feature is enabled
    if (!config.streamStatusWatcherEnabled) {
      logApp("Stream status watcher is disabled in config")
      return
    }

    // Use custom path if configured
    if (config.streamStatusFilePath) {
      this.streamStatusPath = config.streamStatusFilePath
    }

    // Ensure the file exists
    this.ensureFileExists()

    // Read initial content
    try {
      this.lastContent = fs.readFileSync(this.streamStatusPath, "utf8")
    } catch (error) {
      logApp(`Failed to read initial stream_status.txt content: ${error}`)
      this.lastContent = ""
    }

    // Start watching
    try {
      this.watcher = fs.watch(this.streamStatusPath, (eventType) => {
        if (eventType === "change") {
          this.handleFileChange()
        }
      })
      logApp(`Started watching stream_status.txt at: ${this.streamStatusPath}`)
    } catch (error) {
      logApp(`Failed to start watching stream_status.txt: ${error}`)
    }
  }

  /**
   * Stop watching the file
   */
  stop() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      logApp("Stopped watching stream_status.txt")
    }
  }

  /**
   * Ensure the stream_status.txt file exists
   */
  private ensureFileExists() {
    try {
      if (!fs.existsSync(this.streamStatusPath)) {
        fs.writeFileSync(this.streamStatusPath, "", "utf8")
        logApp(`Created stream_status.txt at: ${this.streamStatusPath}`)
      }
    } catch (error) {
      logApp(`Failed to create stream_status.txt: ${error}`)
    }
  }

  /**
   * Handle file change events
   */
  private async handleFileChange() {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return
    }

    try {
      this.isProcessing = true

      // Read current content
      const currentContent = fs.readFileSync(this.streamStatusPath, "utf8")

      // Check if content has actually changed
      if (currentContent === this.lastContent) {
        return
      }

      // Update last content
      this.lastContent = currentContent

      // Parse and process commands
      await this.processCommands(currentContent)
    } catch (error) {
      logApp(`Error handling file change: ${error}`)
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Process commands from the file content
   */
  private async processCommands(content: string) {
    const lines = content.split("\n")
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      
      // Check for tr command: tr <filename>
      const trMatch = trimmedLine.match(/^tr\s+(.+)$/)
      if (trMatch) {
        const filename = trMatch[1].trim()
        await this.handleTranscribeCommand(filename)
      }
    }
  }

  /**
   * Handle the transcribe command
   */
  private async handleTranscribeCommand(filename: string) {
    logApp(`Processing transcribe command for file: ${filename}`)

    try {
      // Import the transcription function
      const { transcribeAudioFile } = await import("./audio-transcription")
      
      // Transcribe the file
      const transcript = await transcribeAudioFile(filename)
      
      // Write the result back to stream_status.txt
      await this.writeTranscriptionResult(filename, transcript)
      
      logApp(`Successfully transcribed ${filename}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logApp(`Failed to transcribe ${filename}: ${errorMessage}`)
      
      // Write error back to file
      await this.writeTranscriptionError(filename, errorMessage)
    }
  }

  /**
   * Write transcription result to the file
   */
  private async writeTranscriptionResult(filename: string, transcript: string) {
    try {
      const result = `Transcription of ${filename}:\n${transcript}\n`
      fs.writeFileSync(this.streamStatusPath, result, "utf8")
      this.lastContent = result
    } catch (error) {
      logApp(`Failed to write transcription result: ${error}`)
    }
  }

  /**
   * Write transcription error to the file
   */
  private async writeTranscriptionError(filename: string, error: string) {
    try {
      const result = `Error transcribing ${filename}:\n${error}\n`
      fs.writeFileSync(this.streamStatusPath, result, "utf8")
      this.lastContent = result
    } catch (writeError) {
      logApp(`Failed to write transcription error: ${writeError}`)
    }
  }

  /**
   * Update the file path and restart watcher if needed
   */
  updateFilePath(newPath: string) {
    const wasWatching = this.watcher !== null
    
    if (wasWatching) {
      this.stop()
    }
    
    this.streamStatusPath = newPath
    
    if (wasWatching) {
      this.start()
    }
  }
}

// Export singleton instance
export const streamStatusWatcher = new StreamStatusWatcher()

