import { getDb } from '../db/index.js'
import { config } from '../config.js'
import { configService } from './config-service.js'
import { mcpService } from './mcp-service.js'
import { agentService } from './agent-service.js'
import os from 'os'

export interface DiagnosticReport {
  timestamp: number
  system: {
    platform: string
    arch: string
    nodeVersion: string
    hostname: string
    uptime: number
    memory: {
      total: number
      free: number
      used: number
    }
    cpus: number
  }
  server: {
    port: number
    host: string
    databasePath: string
  }
  config: {
    sttProvider: string
    ttsProvider: string
    ttsEnabled: boolean
    agentProvider: string
    maxIterations: number
    toolApprovalRequired: boolean
    messageQueueEnabled: boolean
  }
  mcp: {
    servers: Array<{
      name: string
      status: string
      toolCount: number
      enabled: boolean
      error?: string
    }>
    totalTools: number
    enabledTools: number
  }
  sessions: {
    total: number
    active: number
    completed: number
    error: number
  }
  recentErrors: Array<{
    timestamp: number
    level: string
    message: string
  }>
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: {
    database: boolean
    mcpServers: boolean
    apiKeys: boolean
  }
  details: {
    database?: string
    mcpServers?: string
    apiKeys?: string
  }
}

interface DbErrorLog {
  id: number
  timestamp: number
  level: string
  message: string
  stack: string | null
  context: string | null
}

export const diagnosticsService = {
  /**
   * Generate a full diagnostic report
   */
  generateReport(): DiagnosticReport {
    const appConfig = configService.get()
    const mcpStatus = mcpService.getStatus()
    const allTools = mcpService.getAllTools()
    const enabledTools = mcpService.getEnabledTools()
    const sessions = agentService.getAllSessions()

    const memInfo = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
    }

    return {
      timestamp: Date.now(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        hostname: os.hostname(),
        uptime: os.uptime(),
        memory: memInfo,
        cpus: os.cpus().length,
      },
      server: {
        port: config.port,
        host: config.host,
        databasePath: config.databasePath,
      },
      config: {
        sttProvider: appConfig.sttProviderId ?? 'openai',
        ttsProvider: appConfig.ttsProviderId ?? 'openai',
        ttsEnabled: appConfig.ttsEnabled ?? false,
        agentProvider: appConfig.mcpToolsProviderId ?? 'openai',
        maxIterations: appConfig.mcpMaxIterations ?? 25,
        toolApprovalRequired: appConfig.mcpRequireApprovalBeforeToolCall ?? false,
        messageQueueEnabled: appConfig.mcpMessageQueueEnabled ?? true,
      },
      mcp: {
        servers: mcpStatus,
        totalTools: allTools.length,
        enabledTools: enabledTools.length,
      },
      sessions: {
        total: sessions.length,
        active: sessions.filter(s => s.status === 'running').length,
        completed: sessions.filter(s => s.status === 'completed').length,
        error: sessions.filter(s => s.status === 'error').length,
      },
      recentErrors: this.getRecentErrors(10),
    }
  },

  /**
   * Perform health check
   */
  checkHealth(): HealthStatus {
    const checks = {
      database: false,
      mcpServers: false,
      apiKeys: false,
    }
    const details: HealthStatus['details'] = {}

    // Check database
    try {
      const db = getDb()
      db.prepare('SELECT 1').get()
      checks.database = true
    } catch (e) {
      details.database = e instanceof Error ? e.message : 'Database error'
    }

    // Check MCP servers
    const mcpStatus = mcpService.getStatus()
    const runningServers = mcpStatus.filter(s => s.status === 'running')
    const errorServers = mcpStatus.filter(s => s.status === 'error')
    
    if (mcpStatus.length === 0 || runningServers.length > 0) {
      checks.mcpServers = true
    } else {
      details.mcpServers = `${errorServers.length} server(s) in error state`
    }

    // Check API keys
    const appConfig = configService.get()
    const hasOpenAI = !!(appConfig.openaiApiKey || config.openai.apiKey)
    const hasGroq = !!(appConfig.groqApiKey || config.groq.apiKey)
    const hasGemini = !!(appConfig.geminiApiKey || config.gemini.apiKey)
    
    if (hasOpenAI || hasGroq || hasGemini) {
      checks.apiKeys = true
    } else {
      details.apiKeys = 'No API keys configured'
    }

    // Determine overall status
    const allChecks = Object.values(checks)
    let status: HealthStatus['status']
    
    if (allChecks.every(c => c)) {
      status = 'healthy'
    } else if (checks.database) {
      status = 'degraded'
    } else {
      status = 'unhealthy'
    }

    return { status, checks, details }
  },

  /**
   * Log an error
   */
  logError(message: string, stack?: string, context?: Record<string, unknown>): void {
    const db = getDb()
    db.prepare(`
      INSERT INTO error_log (timestamp, level, message, stack, context)
      VALUES (?, 'error', ?, ?, ?)
    `).run(
      Date.now(),
      message,
      stack ?? null,
      context ? JSON.stringify(context) : null
    )
  },

  /**
   * Log a warning
   */
  logWarning(message: string, context?: Record<string, unknown>): void {
    const db = getDb()
    db.prepare(`
      INSERT INTO error_log (timestamp, level, message, context)
      VALUES (?, 'warning', ?, ?)
    `).run(
      Date.now(),
      message,
      context ? JSON.stringify(context) : null
    )
  },

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 50): Array<{ timestamp: number; level: string; message: string }> {
    const db = getDb()
    const rows = db.prepare(`
      SELECT timestamp, level, message FROM error_log
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as Array<{ timestamp: number; level: string; message: string }>
    return rows
  },

  /**
   * Get full error details
   */
  getErrorDetails(limit: number = 50): Array<{
    id: number
    timestamp: number
    level: string
    message: string
    stack?: string
    context?: Record<string, unknown>
  }> {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM error_log
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as DbErrorLog[]

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
      stack: row.stack ?? undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
    }))
  },

  /**
   * Clear error log
   */
  clearErrors(): number {
    const db = getDb()
    const result = db.prepare('DELETE FROM error_log').run()
    return result.changes
  },

  /**
   * Clear old errors (older than given age in milliseconds)
   */
  clearOldErrors(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
    const db = getDb()
    const cutoff = Date.now() - maxAge
    const result = db.prepare('DELETE FROM error_log WHERE timestamp < ?').run(cutoff)
    return result.changes
  },
}
