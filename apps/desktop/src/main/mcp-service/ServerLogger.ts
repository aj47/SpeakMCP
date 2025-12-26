import { ServerLogEntry } from "../../shared/types"
import { isDebugTools, logTools } from "../debug"

/**
 * ServerLogger - Manages logging for MCP servers
 *
 * Responsibilities:
 * - Server log storage with circular buffer
 * - Log entry management
 * - Log retrieval and clearing
 */
export class ServerLogger {
  private serverLogs: Map<string, ServerLogEntry[]> = new Map()
  private readonly MAX_LOG_ENTRIES = 1000

  /**
   * Add a log entry for a server with circular buffer
   */
  addLogEntry(serverName: string, message: string): void {
    let logs = this.serverLogs.get(serverName)
    if (!logs) {
      logs = []
      this.serverLogs.set(serverName, logs)
    }

    logs.push({
      timestamp: Date.now(),
      message: message.trim()
    })

    // Implement circular buffer - keep only last MAX_LOG_ENTRIES
    if (logs.length > this.MAX_LOG_ENTRIES) {
      logs.shift()
    }
  }

  /**
   * Get logs for a specific server
   */
  getServerLogs(serverName: string): ServerLogEntry[] {
    return this.serverLogs.get(serverName) || []
  }

  /**
   * Clear logs for a specific server
   */
  clearServerLogs(serverName: string): void {
    this.serverLogs.set(serverName, [])
  }

  /**
   * Clear all server logs
   */
  clearAllServerLogs(): void {
    this.serverLogs.clear()
  }

  /**
   * Delete logs for a server (cleanup)
   */
  deleteServerLogs(serverName: string): void {
    this.serverLogs.delete(serverName)
  }
}
