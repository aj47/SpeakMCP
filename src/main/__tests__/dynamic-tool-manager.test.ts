import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { DynamicToolManager } from "../dynamic-tool-manager"
import { configStore } from "../config"
import {
  ToolControlRequest,
  DynamicToolState,
  ToolPermissions
} from "../../shared/types"

// Mock the config store
vi.mock("../config", () => ({
  configStore: {
    get: vi.fn(),
    save: vi.fn(),
  },
}))

// Mock debug functions
vi.mock("../debug", () => ({
  isDebugTools: vi.fn(() => false),
  logTools: vi.fn(),
}))

// Mock diagnostics service
vi.mock("../diagnostics", () => ({
  diagnosticsService: {
    logError: vi.fn(),
  },
}))

describe("DynamicToolManager", () => {
  let toolManager: DynamicToolManager
  const mockConfigStore = configStore as any

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Setup default config mock
    mockConfigStore.get.mockReturnValue({
      dynamicToolManagerConfig: {
        enableAgentToolControl: true,
        defaultToolPermissions: {
          canBeDisabledByAgent: true,
          canBeEnabledByAgent: true,
          requiresApproval: false,
          maxDisableDuration: 30 * 60 * 1000,
          allowedOperations: ['enable', 'disable', 'query'],
        },
        auditLogging: true,
        maxTemporaryDisableDuration: 60 * 60 * 1000,
        allowedAgentOperations: ['enable', 'disable', 'query'],
      },
      dynamicToolStates: {},
    })

    toolManager = new DynamicToolManager()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("Tool State Initialization", () => {
    it("should initialize tool state for a new tool", () => {
      const toolName = "test-server:test-tool"
      const serverName = "test-server"

      const state = toolManager.initializeToolState(toolName, serverName, false)

      expect(state.toolName).toBe(toolName)
      expect(state.serverName).toBe(serverName)
      expect(state.enabled).toBe(true)
      expect(state.dynamicallyControlled).toBe(false)
      expect(state.modifiedBy).toBe('system')
      expect(state.permissions.canBeDisabledByAgent).toBe(true)
      expect(state.permissions.canBeEnabledByAgent).toBe(true)
    })

    it("should initialize system tool with restricted permissions", () => {
      const toolName = "tool_manager:list_tools"
      const serverName = "tool_manager"

      const state = toolManager.initializeToolState(toolName, serverName, true)

      expect(state.permissions.canBeDisabledByAgent).toBe(false)
      expect(state.permissions.canBeEnabledByAgent).toBe(false)
      expect(state.permissions.requiresApproval).toBe(true)
      expect(state.permissions.allowedOperations).toEqual(['query'])
    })

    it("should return existing state if tool already initialized", () => {
      const toolName = "test-server:test-tool"
      const serverName = "test-server"

      const state1 = toolManager.initializeToolState(toolName, serverName, false)
      const state2 = toolManager.initializeToolState(toolName, serverName, false)

      expect(state1).toBe(state2)
    })
  })

  describe("Tool Control Requests", () => {
    beforeEach(() => {
      // Initialize a test tool
      toolManager.initializeToolState("test-server:test-tool", "test-server", false)
    })

    it("should enable a tool successfully", async () => {
      const request: ToolControlRequest = {
        toolName: "test-server:test-tool",
        action: 'enable',
        requestedBy: 'agent',
      }

      const response = await toolManager.processToolControlRequest(request)

      expect(response.success).toBe(true)
      expect(response.newState).toBe(true)
      expect(toolManager.isToolEnabled("test-server:test-tool")).toBe(true)
    })

    it("should disable a tool successfully", async () => {
      const request: ToolControlRequest = {
        toolName: "test-server:test-tool",
        action: 'disable',
        reason: 'Testing disable functionality',
        requestedBy: 'agent',
      }

      const response = await toolManager.processToolControlRequest(request)

      expect(response.success).toBe(true)
      expect(response.newState).toBe(false)
      expect(toolManager.isToolEnabled("test-server:test-tool")).toBe(false)
    })

    it("should handle temporary disable with duration", async () => {
      const duration = 5000 // 5 seconds
      const request: ToolControlRequest = {
        toolName: "test-server:test-tool",
        action: 'disable',
        reason: 'Temporary disable for testing',
        duration,
        requestedBy: 'agent',
      }

      const response = await toolManager.processToolControlRequest(request)

      expect(response.success).toBe(true)
      expect(response.newState).toBe(false)

      const state = toolManager.getToolState("test-server:test-tool")
      expect(state?.temporaryDisableUntil).toBeDefined()
      expect(state?.temporaryDisableUntil).toBeGreaterThan(Date.now())
    })

    it("should reject request for non-existent tool", async () => {
      const request: ToolControlRequest = {
        toolName: "non-existent:tool",
        action: 'enable',
        requestedBy: 'agent',
      }

      const response = await toolManager.processToolControlRequest(request)

      expect(response.success).toBe(false)
      expect(response.error).toBe("Tool not found")
    })

    it("should reject agent control when disabled in config", async () => {
      // Update config to disable agent control
      mockConfigStore.get.mockReturnValue({
        dynamicToolManagerConfig: {
          enableAgentToolControl: false,
          defaultToolPermissions: {
            canBeDisabledByAgent: true,
            canBeEnabledByAgent: true,
            requiresApproval: false,
            maxDisableDuration: 30 * 60 * 1000,
            allowedOperations: ['enable', 'disable', 'query'],
          },
          auditLogging: true,
          maxTemporaryDisableDuration: 60 * 60 * 1000,
          allowedAgentOperations: ['enable', 'disable', 'query'],
        },
        dynamicToolStates: {},
      })

      const request: ToolControlRequest = {
        toolName: "test-server:test-tool",
        action: 'disable',
        requestedBy: 'agent',
      }

      const response = await toolManager.processToolControlRequest(request)

      expect(response.success).toBe(false)
      expect(response.error).toBe("Agent tool control is disabled")
    })

    it("should handle query requests", async () => {
      const request: ToolControlRequest = {
        toolName: "test-server:test-tool",
        action: 'query',
        requestedBy: 'agent',
      }

      const response = await toolManager.processToolControlRequest(request)

      expect(response.success).toBe(true)
      expect(response.newState).toBe(true) // Tool should be enabled by default
    })
  })

  describe("Usage Statistics", () => {
    beforeEach(() => {
      toolManager.initializeToolState("test-server:test-tool", "test-server", false)
    })

    it("should record successful tool usage", () => {
      const toolName = "test-server:test-tool"
      const executionTime = 150

      toolManager.recordToolUsage(toolName, true, executionTime)

      const state = toolManager.getToolState(toolName)
      expect(state?.usageStats.totalCalls).toBe(1)
      expect(state?.usageStats.successfulCalls).toBe(1)
      expect(state?.usageStats.failedCalls).toBe(0)
      expect(state?.usageStats.averageExecutionTime).toBe(executionTime)
      expect(state?.usageStats.lastUsed).toBeGreaterThan(0)
    })

    it("should record failed tool usage", () => {
      const toolName = "test-server:test-tool"
      const executionTime = 75

      toolManager.recordToolUsage(toolName, false, executionTime)

      const state = toolManager.getToolState(toolName)
      expect(state?.usageStats.totalCalls).toBe(1)
      expect(state?.usageStats.successfulCalls).toBe(0)
      expect(state?.usageStats.failedCalls).toBe(1)
      expect(state?.usageStats.averageExecutionTime).toBe(executionTime)
    })

    it("should calculate average execution time correctly", () => {
      const toolName = "test-server:test-tool"

      toolManager.recordToolUsage(toolName, true, 100)
      toolManager.recordToolUsage(toolName, true, 200)
      toolManager.recordToolUsage(toolName, false, 300)

      const state = toolManager.getToolState(toolName)
      expect(state?.usageStats.totalCalls).toBe(3)
      expect(state?.usageStats.successfulCalls).toBe(2)
      expect(state?.usageStats.failedCalls).toBe(1)
      expect(state?.usageStats.averageExecutionTime).toBe(200) // (100 + 200 + 300) / 3
    })
  })

  describe("Temporary Disable Cleanup", () => {
    beforeEach(() => {
      toolManager.initializeToolState("test-server:test-tool", "test-server", false)
    })

    it("should automatically re-enable tools after temporary disable expires", async () => {
      const toolName = "test-server:test-tool"

      // Disable tool temporarily for 1ms
      await toolManager.processToolControlRequest({
        toolName,
        action: 'disable',
        duration: 1,
        requestedBy: 'agent',
      })

      expect(toolManager.isToolEnabled(toolName)).toBe(false)

      // Wait for disable to expire
      await new Promise(resolve => setTimeout(resolve, 10))

      // Check if tool is re-enabled after cleanup
      expect(toolManager.isToolEnabled(toolName)).toBe(true)
    })

    it("should clean up multiple expired disables", () => {
      const toolName1 = "test-server:tool1"
      const toolName2 = "test-server:tool2"

      toolManager.initializeToolState(toolName1, "test-server", false)
      toolManager.initializeToolState(toolName2, "test-server", false)

      // Set both tools to have expired temporary disables
      const state1 = toolManager.getToolState(toolName1)!
      const state2 = toolManager.getToolState(toolName2)!

      state1.enabled = false
      state1.temporaryDisableUntil = Date.now() - 1000 // Expired 1 second ago

      state2.enabled = false
      state2.temporaryDisableUntil = Date.now() - 2000 // Expired 2 seconds ago

      toolManager.cleanupExpiredDisables()

      expect(toolManager.isToolEnabled(toolName1)).toBe(true)
      expect(toolManager.isToolEnabled(toolName2)).toBe(true)
    })
  })

  describe("Audit Logging", () => {
    beforeEach(() => {
      toolManager.initializeToolState("test-server:test-tool", "test-server", false)
    })

    it("should log successful tool control actions", async () => {
      await toolManager.processToolControlRequest({
        toolName: "test-server:test-tool",
        action: 'disable',
        reason: 'Test disable',
        requestedBy: 'agent',
      })

      const auditLog = toolManager.getAuditLog(10)
      expect(auditLog.length).toBe(1)
      expect(auditLog[0].action).toBe('disable')
      expect(auditLog[0].toolName).toBe("test-server:test-tool")
      expect(auditLog[0].requestedBy).toBe('agent')
      expect(auditLog[0].success).toBe(true)
    })

    it("should log failed tool control actions", async () => {
      await toolManager.processToolControlRequest({
        toolName: "non-existent:tool",
        action: 'enable',
        requestedBy: 'agent',
      })

      const auditLog = toolManager.getAuditLog(10)
      expect(auditLog.length).toBe(0) // Failed requests before execution don't get logged
    })
  })
})
