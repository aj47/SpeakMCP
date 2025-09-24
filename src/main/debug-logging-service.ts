import fs from "fs"
import path from "path"
import { configStore, dataFolder } from "./config"
import { DebugLogEntry, DebugLogFile } from "../shared/types"

export class DebugLoggingService {
  private static instance: DebugLoggingService | null = null
  private logBuffer: DebugLogEntry[] = []
  private currentLogFile: string | null = null
  private logFolder: string
  private bufferFlushInterval: NodeJS.Timeout | null = null
  private readonly BUFFER_SIZE = 100
  private readonly FLUSH_INTERVAL = 5000 // 5 seconds

  static getInstance(): DebugLoggingService {
    if (!DebugLoggingService.instance) {
      DebugLoggingService.instance = new DebugLoggingService()
    }
    return DebugLoggingService.instance
  }

  private constructor() {
    this.logFolder = path.join(dataFolder, "debug-logs")
    this.ensureLogFolder()
    this.initializeCurrentLogFile()
    this.startBufferFlushTimer()
  }

  private ensureLogFolder(): void {
    try {
      fs.mkdirSync(this.logFolder, { recursive: true })
    } catch (error) {
      console.error("Failed to create debug logs folder:", error)
    }
  }

  private initializeCurrentLogFile(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    this.currentLogFile = path.join(this.logFolder, `debug-${timestamp}.log`)
  }

  private startBufferFlushTimer(): void {
    this.bufferFlushInterval = setInterval(() => {
      this.flushBuffer()
    }, this.FLUSH_INTERVAL)
  }

  private flushBuffer(): void {
    if (this.logBuffer.length === 0 || !this.currentLogFile) return

    try {
      const config = configStore.get()
      if (!config.debugLoggingEnabled) return

      const logEntries = this.logBuffer.splice(0)
      const logLines = logEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n'
      
      fs.appendFileSync(this.currentLogFile, logLines)
      
      // Check file size and rotate if necessary
      this.checkAndRotateLogFile()
    } catch (error) {
      console.error("Failed to flush debug log buffer:", error)
    }
  }

  private checkAndRotateLogFile(): void {
    if (!this.currentLogFile) return

    try {
      const config = configStore.get()
      const maxSizeMB = config.debugLoggingMaxFileSize || 10
      const maxSizeBytes = maxSizeMB * 1024 * 1024

      const stats = fs.statSync(this.currentLogFile)
      if (stats.size >= maxSizeBytes) {
        this.rotateLogFile()
      }
    } catch (error) {
      console.error("Failed to check log file size:", error)
    }
  }

  private rotateLogFile(): void {
    if (!this.currentLogFile) return

    try {
      const config = configStore.get()
      const maxFiles = config.debugLoggingMaxFiles || 5

      // Create new log file
      this.initializeCurrentLogFile()

      // Clean up old log files
      this.cleanupOldLogFiles(maxFiles)
    } catch (error) {
      console.error("Failed to rotate log file:", error)
    }
  }

  private cleanupOldLogFiles(maxFiles: number): void {
    try {
      const files = fs.readdirSync(this.logFolder)
        .filter(file => file.startsWith('debug-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(this.logFolder, file),
          stats: fs.statSync(path.join(this.logFolder, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime())

      // Keep only the most recent files
      const filesToDelete = files.slice(maxFiles)
      for (const file of filesToDelete) {
        fs.unlinkSync(file.path)
      }
    } catch (error) {
      console.error("Failed to cleanup old log files:", error)
    }
  }

  public log(level: DebugLogEntry["level"], component: string, message: string, details?: any): void {
    const config = configStore.get()
    if (!config.debugLoggingEnabled) return

    // Check if this log level should be recorded
    const configLevel = config.debugLoggingLevel || "info"
    const levelPriority = { debug: 0, info: 1, warning: 2, error: 3 }
    if (levelPriority[level] < levelPriority[configLevel]) return

    const entry: DebugLogEntry = {
      timestamp: Date.now(),
      level,
      component,
      message,
      details: details ? this.sanitizeDetails(details) : undefined,
      stack: level === "error" ? new Error().stack : undefined
    }

    this.logBuffer.push(entry)

    // Flush immediately if buffer is full or if it's an error
    if (this.logBuffer.length >= this.BUFFER_SIZE || level === "error") {
      this.flushBuffer()
    }
  }

  private sanitizeDetails(details: any): any {
    try {
      // Remove circular references and limit depth
      return JSON.parse(JSON.stringify(details, null, 0))
    } catch {
      return String(details)
    }
  }

  public debug(component: string, message: string, details?: any): void {
    this.log("debug", component, message, details)
  }

  public info(component: string, message: string, details?: any): void {
    this.log("info", component, message, details)
  }

  public warning(component: string, message: string, details?: any): void {
    this.log("warning", component, message, details)
  }

  public error(component: string, message: string, details?: any): void {
    this.log("error", component, message, details)
  }

  public getLogFiles(): DebugLogFile[] {
    try {
      const files = fs.readdirSync(this.logFolder)
        .filter(file => file.startsWith('debug-') && file.endsWith('.log'))
        .map(file => {
          const filePath = path.join(this.logFolder, file)
          const stats = fs.statSync(filePath)
          return {
            path: filePath,
            size: stats.size,
            createdAt: stats.birthtime.getTime(),
            modifiedAt: stats.mtime.getTime()
          }
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt)

      return files
    } catch (error) {
      console.error("Failed to get log files:", error)
      return []
    }
  }

  public async getRecentLogs(count: number = 100): Promise<DebugLogEntry[]> {
    try {
      // First, flush any pending logs
      this.flushBuffer()

      const logFiles = this.getLogFiles()
      const logs: DebugLogEntry[] = []

      for (const file of logFiles) {
        if (logs.length >= count) break

        try {
          const content = fs.readFileSync(file.path, 'utf8')
          const lines = content.trim().split('\n').filter(line => line.trim())
          
          for (let i = lines.length - 1; i >= 0 && logs.length < count; i--) {
            try {
              const entry = JSON.parse(lines[i])
              logs.push(entry)
            } catch {
              // Skip invalid JSON lines
            }
          }
        } catch (error) {
          console.error(`Failed to read log file ${file.path}:`, error)
        }
      }

      return logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, count)
    } catch (error) {
      console.error("Failed to get recent logs:", error)
      return []
    }
  }

  public clearLogs(): void {
    try {
      // Clear buffer
      this.logBuffer = []

      // Remove all log files
      const files = fs.readdirSync(this.logFolder)
        .filter(file => file.startsWith('debug-') && file.endsWith('.log'))

      for (const file of files) {
        fs.unlinkSync(path.join(this.logFolder, file))
      }

      // Create new log file
      this.initializeCurrentLogFile()
    } catch (error) {
      console.error("Failed to clear logs:", error)
    }
  }

  public exportLogs(exportPath: string): string {
    try {
      this.flushBuffer()
      
      const logFiles = this.getLogFiles()
      const allLogs: DebugLogEntry[] = []

      for (const file of logFiles) {
        try {
          const content = fs.readFileSync(file.path, 'utf8')
          const lines = content.trim().split('\n').filter(line => line.trim())
          
          for (const line of lines) {
            try {
              const entry = JSON.parse(line)
              allLogs.push(entry)
            } catch {
              // Skip invalid JSON lines
            }
          }
        } catch (error) {
          console.error(`Failed to read log file ${file.path}:`, error)
        }
      }

      // Sort by timestamp
      allLogs.sort((a, b) => a.timestamp - b.timestamp)

      const exportData = {
        exportedAt: Date.now(),
        totalEntries: allLogs.length,
        logs: allLogs
      }

      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2))
      return exportPath
    } catch (error) {
      console.error("Failed to export logs:", error)
      throw error
    }
  }

  public destroy(): void {
    if (this.bufferFlushInterval) {
      clearInterval(this.bufferFlushInterval)
      this.bufferFlushInterval = null
    }
    this.flushBuffer()
  }
}

export const debugLoggingService = DebugLoggingService.getInstance()
