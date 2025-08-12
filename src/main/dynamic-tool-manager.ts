import { configStore } from "./config"
import {
  DynamicToolState,
  ToolPermissions,
  ToolUsageStats,
  ToolControlRequest,
  ToolControlResponse,
  DynamicToolManagerConfig,
  Config,
} from "../shared/types"
import { diagnosticsService } from "./diagnostics"
import { isDebugTools, logTools } from "./debug"

export class DynamicToolManager {
  private toolStates: Map<string, DynamicToolState> = new Map()
  private pendingApprovals: Map<string, ToolControlRequest> = new Map()
  private auditLog: Array<{
    timestamp: number
    action: string
    toolName: string
    requestedBy: string
    success: boolean
    details?: any
  }> = []

  constructor() {
    this.loadPersistedStates()
  }

  /**
   * Get default configuration for dynamic tool management
   */
  private getDefaultConfig(): DynamicToolManagerConfig {
    return {
      enableAgentToolControl: true,
      defaultToolPermissions: {
        canBeDisabledByAgent: true,
        canBeEnabledByAgent: true,
        requiresApproval: false,
        maxDisableDuration: 30 * 60 * 1000, // 30 minutes
        allowedOperations: ['enable', 'disable', 'query'],
      },
      auditLogging: true,
      maxTemporaryDisableDuration: 60 * 60 * 1000, // 1 hour
      allowedAgentOperations: ['enable', 'disable', 'query'],
    }
  }

  /**
   * Get current configuration, merging with defaults
   */
  private getConfig(): DynamicToolManagerConfig {
    const config = configStore.get()
    const defaultConfig = this.getDefaultConfig()
    return { ...defaultConfig, ...config.dynamicToolManagerConfig }
  }

  /**
   * Load persisted tool states from configuration
   */
  private loadPersistedStates(): void {
    try {
      const config = configStore.get()
      const persistedStates = config.dynamicToolStates || {}

      for (const [toolName, state] of Object.entries(persistedStates)) {
        this.toolStates.set(toolName, state)
      }

      if (isDebugTools()) {
        logTools(`Loaded ${this.toolStates.size} persisted tool states`)
      }
    } catch (error) {
      diagnosticsService.logError(
        "dynamic-tool-manager",
        "Failed to load persisted tool states",
        error
      )
    }
  }

  /**
   * Persist tool states to configuration
   */
  private persistStates(): void {
    try {
      const config = configStore.get()
      const statesToPersist: Record<string, DynamicToolState> = {}

      for (const [toolName, state] of this.toolStates) {
        statesToPersist[toolName] = state
      }

      const newConfig: Config = {
        ...config,
        dynamicToolStates: statesToPersist,
      }

      configStore.save(newConfig)

      if (isDebugTools()) {
        logTools(`Persisted ${Object.keys(statesToPersist).length} tool states`)
      }
    } catch (error) {
      diagnosticsService.logError(
        "dynamic-tool-manager",
        "Failed to persist tool states",
        error
      )
    }
  }

  /**
   * Initialize or update tool state for a discovered tool
   */
  initializeToolState(
    toolName: string,
    serverName: string,
    isSystemTool: boolean = false
  ): DynamicToolState {
    const existingState = this.toolStates.get(toolName)

    if (existingState) {
      // Update server name if it changed
      if (existingState.serverName !== serverName) {
        existingState.serverName = serverName
        existingState.lastModified = Date.now()
        existingState.modifiedBy = 'system'
      }
      return existingState
    }

    // Create new tool state
    const config = this.getConfig()
    const defaultPermissions = { ...config.defaultToolPermissions }

    // System tools have restricted permissions
    if (isSystemTool) {
      defaultPermissions.canBeDisabledByAgent = false
      defaultPermissions.canBeEnabledByAgent = false
      defaultPermissions.requiresApproval = true
      defaultPermissions.allowedOperations = ['query']
    }

    const newState: DynamicToolState = {
      toolName,
      serverName,
      enabled: true,
      dynamicallyControlled: false,
      lastModified: Date.now(),
      modifiedBy: 'system',
      permissions: defaultPermissions,
      usageStats: {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        lastUsed: 0,
        averageExecutionTime: 0,
        firstUsed: 0,
      },
    }

    this.toolStates.set(toolName, newState)
    this.persistStates()

    if (isDebugTools()) {
      logTools(`Initialized tool state for ${toolName}`, { isSystemTool })
    }

    return newState
  }

  /**
   * Record tool usage statistics
   */
  recordToolUsage(
    toolName: string,
    success: boolean,
    executionTime: number
  ): void {
    const state = this.toolStates.get(toolName)
    if (!state) return

    const now = Date.now()
    const stats = state.usageStats

    stats.totalCalls++
    if (success) {
      stats.successfulCalls++
    } else {
      stats.failedCalls++
    }

    stats.lastUsed = now
    if (stats.firstUsed === 0) {
      stats.firstUsed = now
    }

    // Update average execution time
    const totalTime = stats.averageExecutionTime * (stats.totalCalls - 1) + executionTime
    stats.averageExecutionTime = totalTime / stats.totalCalls

    state.lastModified = now
    this.persistStates()
  }

  /**
   * Process a tool control request
   */
  async processToolControlRequest(
    request: ToolControlRequest
  ): Promise<ToolControlResponse> {
    const config = this.getConfig()

    if (!config.enableAgentToolControl && request.requestedBy === 'agent') {
      return {
        success: false,
        toolName: request.toolName,
        error: "Agent tool control is disabled",
      }
    }

    const state = this.toolStates.get(request.toolName)
    if (!state) {
      return {
        success: false,
        toolName: request.toolName,
        error: "Tool not found",
      }
    }

    // Check permissions
    const hasPermission = this.checkPermission(state, request)
    if (!hasPermission.allowed) {
      return {
        success: false,
        toolName: request.toolName,
        error: hasPermission.reason,
      }
    }

    // Handle query requests
    if (request.action === 'query') {
      return {
        success: true,
        toolName: request.toolName,
        newState: state.enabled,
      }
    }

    // Check if approval is required
    if (state.permissions.requiresApproval && request.requestedBy === 'agent') {
      const approvalToken = this.generateApprovalToken()
      this.pendingApprovals.set(approvalToken, request)

      return {
        success: false,
        toolName: request.toolName,
        requiresApproval: true,
        approvalToken,
        error: "This operation requires user approval",
      }
    }

    // Execute the control action
    return this.executeToolControl(request, state)
  }

  /**
   * Check if a request has permission to execute
   */
  private checkPermission(
    state: DynamicToolState,
    request: ToolControlRequest
  ): { allowed: boolean; reason?: string } {
    const { permissions } = state
    const { action, requestedBy } = request

    if (!permissions.allowedOperations.includes(action)) {
      return { allowed: false, reason: `Operation '${action}' not allowed for this tool` }
    }

    if (requestedBy === 'agent') {
      if (action === 'enable' && !permissions.canBeEnabledByAgent) {
        return { allowed: false, reason: "Agent cannot enable this tool" }
      }
      if (action === 'disable' && !permissions.canBeDisabledByAgent) {
        return { allowed: false, reason: "Agent cannot disable this tool" }
      }
    }

    // Check temporary disable duration
    if (action === 'disable' && request.duration) {
      const maxDuration = permissions.maxDisableDuration || 0
      if (request.duration > maxDuration) {
        return {
          allowed: false,
          reason: `Disable duration exceeds maximum allowed (${maxDuration}ms)`
        }
      }
    }

    return { allowed: true }
  }

  /**
   * Execute a tool control action
   */
  private executeToolControl(
    request: ToolControlRequest,
    state: DynamicToolState
  ): ToolControlResponse {
    const now = Date.now()
    let newEnabled = state.enabled

    try {
      if (request.action === 'enable') {
        newEnabled = true
        state.temporaryDisableUntil = undefined
        state.disableReason = undefined
      } else if (request.action === 'disable') {
        newEnabled = false
        if (request.duration) {
          state.temporaryDisableUntil = now + request.duration
        }
        state.disableReason = request.reason
      }

      // Update state
      state.enabled = newEnabled
      state.dynamicallyControlled = true
      state.lastModified = now
      state.modifiedBy = request.requestedBy

      // Log the action
      this.logAction({
        timestamp: now,
        action: request.action,
        toolName: request.toolName,
        requestedBy: request.requestedBy,
        success: true,
        details: {
          reason: request.reason,
          duration: request.duration,
        },
      })

      this.persistStates()

      if (isDebugTools()) {
        logTools(`Tool control executed: ${request.action} on ${request.toolName}`, {
          newState: newEnabled,
          requestedBy: request.requestedBy,
        })
      }

      return {
        success: true,
        toolName: request.toolName,
        newState: newEnabled,
      }
    } catch (error) {
      this.logAction({
        timestamp: now,
        action: request.action,
        toolName: request.toolName,
        requestedBy: request.requestedBy,
        success: false,
        details: { error: error instanceof Error ? error.message : String(error) },
      })

      return {
        success: false,
        toolName: request.toolName,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  /**
   * Generate approval token for pending requests
   */
  private generateApprovalToken(): string {
    return `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Log an action to the audit log
   */
  private logAction(entry: {
    timestamp: number
    action: string
    toolName: string
    requestedBy: string
    success: boolean
    details?: any
  }): void {
    const config = this.getConfig()
    if (!config.auditLogging) return

    this.auditLog.push(entry)

    // Keep only last 1000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000)
    }

    if (isDebugTools()) {
      logTools("Tool control action logged", entry)
    }
  }

  /**
   * Get tool state by name
   */
  getToolState(toolName: string): DynamicToolState | undefined {
    return this.toolStates.get(toolName)
  }

  /**
   * Get all tool states
   */
  getAllToolStates(): DynamicToolState[] {
    return Array.from(this.toolStates.values())
  }

  /**
   * Check if a tool is currently enabled (considering temporary disables)
   */
  isToolEnabled(toolName: string): boolean {
    const state = this.toolStates.get(toolName)
    if (!state) return true // Default to enabled for tools not yet managed

    // Check if temporary disable has expired
    if (state.temporaryDisableUntil && Date.now() > state.temporaryDisableUntil) {
      state.enabled = true
      state.temporaryDisableUntil = undefined
      state.disableReason = undefined
      state.lastModified = Date.now()
      state.modifiedBy = 'system'
      this.persistStates()
    }

    return state.enabled
  }

  /**
   * Get audit log entries
   */
  getAuditLog(limit: number = 100): Array<{
    timestamp: number
    action: string
    toolName: string
    requestedBy: string
    success: boolean
    details?: any
  }> {
    return this.auditLog.slice(-limit)
  }

  /**
   * Clean up expired temporary disables
   */
  cleanupExpiredDisables(): void {
    const now = Date.now()
    let hasChanges = false

    for (const [toolName, state] of this.toolStates) {
      if (state.temporaryDisableUntil && now > state.temporaryDisableUntil) {
        state.enabled = true
        state.temporaryDisableUntil = undefined
        state.disableReason = undefined
        state.lastModified = now
        state.modifiedBy = 'system'
        hasChanges = true

        if (isDebugTools()) {
          logTools(`Temporary disable expired for tool: ${toolName}`)
        }
      }
    }

    if (hasChanges) {
      this.persistStates()
    }
  }
}

export const dynamicToolManager = new DynamicToolManager()
