export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'agent' | 'mcp-client' | 'transport' | 'tool-call' | 'oauth/auth' | 'network' | 'ui' | 'session'

export interface LogEntry {
  timestamp: number
  level: LogLevel
  category: LogCategory
  message: string
  sessionId?: string
  messageId?: string
  toolCallId?: string
  duration?: number
  data?: any
  error?: Error
}

export interface LoggerConfig {
  level: LogLevel
  enableConsole: boolean
  enableUI: boolean
  maxEntries: number
  redactSecrets: boolean
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4
}

const SECRET_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_-]+/gi,
  /token["\s]*[:=]["\s]*[a-zA-Z0-9_-]+/gi,
  /api[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9_-]+/gi,
  /password["\s]*[:=]["\s]*[^"\s]+/gi,
  /secret["\s]*[:=]["\s]*[^"\s]+/gi,
]

class WebDebugLogger {
  private config: LoggerConfig
  private entries: LogEntry[] = []
  private listeners: Set<(entry: LogEntry) => void> = new Set()

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: 'info',
      enableConsole: true,
      enableUI: true,
      maxEntries: 1000,
      redactSecrets: true,
      ...config
    }

    // Set initial level from environment variable
    const envLevel = process.env.WEB_DEBUG_LOG_LEVEL as LogLevel
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
      this.config.level = envLevel
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level]
  }

  private redactSecrets(text: string): string {
    if (!this.config.redactSecrets) return text
    
    let redacted = text
    for (const pattern of SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, (match) => {
        const parts = match.split(/[:=]/)
        if (parts.length > 1) {
          return `${parts[0]}:***REDACTED***`
        }
        return '***REDACTED***'
      })
    }
    return redacted
  }

  private formatForConsole(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString()
    const level = entry.level.toUpperCase().padEnd(5)
    const category = entry.category.toUpperCase().padEnd(12)
    
    let message = `[${timestamp}] [${level}] [${category}] ${entry.message}`
    
    if (entry.sessionId) message += ` [session:${entry.sessionId.slice(-8)}]`
    if (entry.messageId) message += ` [msg:${entry.messageId.slice(-8)}]`
    if (entry.toolCallId) message += ` [tool:${entry.toolCallId.slice(-8)}]`
    if (entry.duration !== undefined) message += ` [${entry.duration}ms]`
    
    return message
  }

  private addEntry(entry: LogEntry): void {
    // Redact secrets in message and data
    const redactedEntry: LogEntry = {
      ...entry,
      message: this.redactSecrets(entry.message),
      data: entry.data ? this.redactSecrets(JSON.stringify(entry.data)) : undefined
    }

    // Add to entries with size limit
    this.entries.push(redactedEntry)
    if (this.entries.length > this.config.maxEntries) {
      this.entries.shift()
    }

    // Console output
    if (this.config.enableConsole) {
      const consoleMessage = this.formatForConsole(redactedEntry)
      
      switch (entry.level) {
        case 'error':
          console.error(consoleMessage, entry.error || '')
          break
        case 'warn':
          console.warn(consoleMessage)
          break
        case 'trace':
        case 'debug':
          console.debug(consoleMessage)
          break
        default:
          console.log(consoleMessage)
      }
    }

    // Notify UI listeners
    if (this.config.enableUI) {
      this.listeners.forEach(listener => listener(redactedEntry))
    }
  }

  public trace(category: LogCategory, message: string, context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'category' | 'message'>>): void {
    if (!this.shouldLog('trace')) return
    this.addEntry({
      timestamp: Date.now(),
      level: 'trace',
      category,
      message,
      ...context
    })
  }

  public debug(category: LogCategory, message: string, context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'category' | 'message'>>): void {
    if (!this.shouldLog('debug')) return
    this.addEntry({
      timestamp: Date.now(),
      level: 'debug',
      category,
      message,
      ...context
    })
  }

  public info(category: LogCategory, message: string, context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'category' | 'message'>>): void {
    if (!this.shouldLog('info')) return
    this.addEntry({
      timestamp: Date.now(),
      level: 'info',
      category,
      message,
      ...context
    })
  }

  public warn(category: LogCategory, message: string, context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'category' | 'message'>>): void {
    if (!this.shouldLog('warn')) return
    this.addEntry({
      timestamp: Date.now(),
      level: 'warn',
      category,
      message,
      ...context
    })
  }

  public error(category: LogCategory, message: string, context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'category' | 'message'>>): void {
    if (!this.shouldLog('error')) return
    this.addEntry({
      timestamp: Date.now(),
      level: 'error',
      category,
      message,
      ...context
    })
  }

  public setLevel(level: LogLevel): void {
    this.config.level = level
    this.info('ui', `Log level changed to ${level}`)
  }

  public getLevel(): LogLevel {
    return this.config.level
  }

  public getEntries(): LogEntry[] {
    return [...this.entries]
  }

  public clearEntries(): void {
    this.entries = []
    this.info('ui', 'Log entries cleared')
  }

  public addListener(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public exportLogs(): string {
    return this.entries
      .map(entry => this.formatForConsole(entry))
      .join('\n')
  }

  // Utility methods for common logging patterns
  public startTimer(category: LogCategory, operation: string, context?: Partial<LogEntry>): () => void {
    const startTime = Date.now()
    this.debug(category, `Starting ${operation}`, context)
    
    return () => {
      const duration = Date.now() - startTime
      this.debug(category, `Completed ${operation}`, { ...context, duration })
    }
  }

  public logToolCall(toolName: string, args: any, sessionId?: string, toolCallId?: string): () => void {
    const startTime = Date.now()
    this.info('tool-call', `Starting tool call: ${toolName}`, {
      sessionId,
      toolCallId,
      data: { toolName, args }
    })
    
    return () => {
      const duration = Date.now() - startTime
      this.info('tool-call', `Completed tool call: ${toolName}`, {
        sessionId,
        toolCallId,
        duration
      })
    }
  }

  public logAgentStep(step: string, sessionId?: string, messageId?: string): void {
    this.info('agent', step, { sessionId, messageId })
  }

  public logMCPOperation(operation: string, serverName?: string, sessionId?: string): () => void {
    const startTime = Date.now()
    this.debug('mcp-client', `Starting MCP operation: ${operation}`, {
      sessionId,
      data: { serverName }
    })
    
    return () => {
      const duration = Date.now() - startTime
      this.debug('mcp-client', `Completed MCP operation: ${operation}`, {
        sessionId,
        duration,
        data: { serverName }
      })
    }
  }
}

// Global logger instance
export const logger = new WebDebugLogger()

// Export for testing and configuration
export { WebDebugLogger }
