import fs from 'fs'
import path from 'path'

// Lazy import to avoid circular dependency
let configStore: { get: () => any } | null = null
let mcpService: { getAvailableTools: () => any[]; testServerConnection: (name: string, config: any) => Promise<any> } | null = null

export function setConfigStore(store: { get: () => any }) {
  configStore = store
}

export function setMcpService(service: { getAvailableTools: () => any[]; testServerConnection: (name: string, config: any) => Promise<any> }) {
  mcpService = service
}

export interface DiagnosticInfo {
  timestamp: number
  system: {
    platform: string
    nodeVersion: string
    electronVersion: string
  }
  config: {
    mcpServersCount: number
  }
  mcp: {
    availableTools: number
    serverStatus: Record<string, { connected: boolean; toolCount: number }>
  }
  errors: Array<{
    timestamp: number
    level: 'error' | 'warning' | 'info'
    component: string
    message: string
    stack?: string
  }>
}

class DiagnosticsService {
  private static instance: DiagnosticsService | null = null
  private errorLog: DiagnosticInfo['errors'] = []
  private maxErrorLogSize = 100

  static getInstance(): DiagnosticsService {
    if (!DiagnosticsService.instance) {
      DiagnosticsService.instance = new DiagnosticsService()
    }
    return DiagnosticsService.instance
  }

  private constructor() {
    this.setupErrorHandlers()
  }

  private setupErrorHandlers(): void {
    process.on('unhandledRejection', (reason, promise) => {
      this.logError('system', 'Unhandled Promise Rejection', {
        reason: String(reason),
        promise: String(promise),
      })
    })

    process.on('uncaughtException', (error) => {
      this.logError('system', 'Uncaught Exception', {
        message: error.message,
        stack: error.stack,
      })
    })
  }

  logError(component: string, message: string, details?: any): void {
    const errorEntry = {
      timestamp: Date.now(),
      level: 'error' as const,
      component,
      message,
      stack: details?.stack || new Error().stack,
    }

    this.errorLog.push(errorEntry)

    if (this.errorLog.length > this.maxErrorLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxErrorLogSize)
    }
  }

  logWarning(component: string, message: string, details?: any): void {
    const warningEntry = {
      timestamp: Date.now(),
      level: 'warning' as const,
      component,
      message,
      stack: details?.stack,
    }

    this.errorLog.push(warningEntry)

    if (this.errorLog.length > this.maxErrorLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxErrorLogSize)
    }
  }

  logInfo(component: string, message: string, _details?: any): void {
    const infoEntry = {
      timestamp: Date.now(),
      level: 'info' as const,
      component,
      message,
    }

    this.errorLog.push(infoEntry)

    if (this.errorLog.length > this.maxErrorLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxErrorLogSize)
    }
  }

  async generateDiagnosticReport(): Promise<DiagnosticInfo> {
    const config = configStore?.get() || {}

    return {
      timestamp: Date.now(),
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        // Return 'standalone' when not in Electron
        electronVersion: process.versions.electron || 'standalone',
      },
      config: {
        mcpServersCount: Object.keys(config.mcpConfig?.mcpServers || {}).length,
      },
      mcp: {
        availableTools: mcpService?.getAvailableTools().length || 0,
        serverStatus: await this.getServerStatus(),
      },
      errors: [...this.errorLog],
    }
  }

  private async getServerStatus(): Promise<Record<string, { connected: boolean; toolCount: number }>> {
    if (!configStore || !mcpService) {
      return {}
    }

    const config = configStore.get()
    const serverStatus: Record<string, { connected: boolean; toolCount: number }> = {}

    for (const [serverName, serverConfig] of Object.entries(config.mcpConfig?.mcpServers || {})) {
      try {
        const testResult = await mcpService.testServerConnection(serverName, serverConfig as any)
        serverStatus[serverName] = {
          connected: testResult.success,
          toolCount: testResult.toolCount || 0,
        }
      } catch (error) {
        serverStatus[serverName] = {
          connected: false,
          toolCount: 0,
        }
      }
    }

    return serverStatus
  }

  async saveDiagnosticReport(filePath?: string): Promise<string> {
    const report = await this.generateDiagnosticReport()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const defaultPath = filePath || path.join(process.cwd(), `diagnostic-report-${timestamp}.json`)

    fs.writeFileSync(defaultPath, JSON.stringify(report, null, 2))

    return defaultPath
  }

  getRecentErrors(count: number = 10): DiagnosticInfo['errors'] {
    return this.errorLog.slice(-count)
  }

  clearErrorLog(): void {
    this.errorLog = []
  }

  async performHealthCheck(): Promise<{
    overall: 'healthy' | 'warning' | 'critical'
    checks: Record<string, { status: 'pass' | 'fail' | 'warning'; message: string }>
  }> {
    const checks: Record<string, { status: 'pass' | 'fail' | 'warning'; message: string }> = {}

    // Check MCP service
    try {
      const tools = mcpService?.getAvailableTools() || []
      checks.mcpService = {
        status: tools.length > 0 ? 'pass' : 'warning',
        message: `${tools.length} tools available`,
      }
    } catch (error) {
      checks.mcpService = {
        status: 'fail',
        message: `MCP service error: ${error}`,
      }
    }

    // Check recent errors
    const recentErrors = this.errorLog.filter(
      (e) => e.level === 'error' && Date.now() - e.timestamp < 5 * 60 * 1000
    )

    checks.recentErrors = {
      status: recentErrors.length === 0 ? 'pass' : recentErrors.length < 5 ? 'warning' : 'fail',
      message: `${recentErrors.length} errors in last 5 minutes`,
    }

    // Check configuration
    const config = configStore?.get() || {}
    const mcpServers = config.mcpConfig?.mcpServers || {}
    checks.configuration = {
      status: Object.keys(mcpServers).length > 0 ? 'pass' : 'warning',
      message: `${Object.keys(mcpServers).length} MCP servers configured`,
    }

    // Determine overall status
    const failCount = Object.values(checks).filter((c) => c.status === 'fail').length
    const warningCount = Object.values(checks).filter((c) => c.status === 'warning').length

    let overall: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (failCount > 0) {
      overall = 'critical'
    } else if (warningCount > 0) {
      overall = 'warning'
    }

    return { overall, checks }
  }
}

export const diagnosticsService = DiagnosticsService.getInstance()

