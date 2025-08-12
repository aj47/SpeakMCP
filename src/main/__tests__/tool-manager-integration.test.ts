import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { MCPService } from "../mcp-service"
import { dynamicToolManager } from "../dynamic-tool-manager"
import { configStore } from "../config"

// Mock dependencies
vi.mock("../config", () => ({
  configStore: {
    get: vi.fn(),
    save: vi.fn(),
  },
}))

vi.mock("../debug", () => ({
  isDebugTools: vi.fn(() => false),
  logTools: vi.fn(),
}))

vi.mock("../diagnostics", () => ({
  diagnosticsService: {
    logError: vi.fn(),
  },
}))

vi.mock("../state", () => ({
  state: {
    isAgentModeActive: false,
  },
  agentProcessManager: {
    registerProcess: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  dialog: {
    showMessageBox: vi.fn(),
  },
}))

describe("Tool Manager Integration", () => {
  let mcpService: MCPService
  const mockConfigStore = configStore as any

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default config
    mockConfigStore.get.mockReturnValue({
      mcpConfig: {
        mcpServers: {},
      },
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
      mcpRequireApprovalBeforeToolCall: false,
    })

    mcpService = new MCPService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("Tool Manager Tools", () => {
    beforeEach(async () => {
      // Initialize MCP service to add tool manager tools
      await mcpService.initialize()
    })

    it("should include tool manager tools in available tools", () => {
      const availableTools = mcpService.getAvailableTools()
      const toolManagerTools = availableTools.filter(tool =>
        tool.name.startsWith("tool_manager:")
      )

      expect(toolManagerTools.length).toBeGreaterThan(0)

      const toolNames = toolManagerTools.map(t => t.name)
      expect(toolNames).toContain("tool_manager:list_tools")
      expect(toolNames).toContain("tool_manager:get_tool_status")
      expect(toolNames).toContain("tool_manager:enable_tool")
      expect(toolNames).toContain("tool_manager:disable_tool")
      expect(toolNames).toContain("tool_manager:get_tool_permissions")
      expect(toolNames).toContain("tool_manager:get_tool_usage_stats")
    })

    it("should execute list_tools tool manager command", async () => {
      const result = await mcpService.executeToolCall({
        name: "tool_manager:list_tools",
        arguments: { includeDisabled: true },
      })

      expect(result.isError).toBe(false)
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe("text")

      const response = JSON.parse(result.content[0].text)
      expect(response).toHaveProperty("totalTools")
      expect(response).toHaveProperty("enabledTools")
      expect(response).toHaveProperty("disabledTools")
      expect(response).toHaveProperty("tools")
      expect(Array.isArray(response.tools)).toBe(true)
    })

    it("should execute get_tool_status for tool manager tool", async () => {
      const result = await mcpService.executeToolCall({
        name: "tool_manager:get_tool_status",
        arguments: { toolName: "tool_manager:list_tools" },
      })

      expect(result.isError).toBe(false)
      expect(result.content).toHaveLength(1)

      const response = JSON.parse(result.content[0].text)
      expect(response).toHaveProperty("toolName", "tool_manager:list_tools")
      expect(response).toHaveProperty("enabled")
      expect(response).toHaveProperty("permissions")
      expect(response).toHaveProperty("usageStats")
    })

    it("should handle disable_tool for regular tools", async () => {
      // First, add a mock regular tool
      const mockTool = {
        name: "test-server:test-tool",
        description: "Test tool",
        inputSchema: { type: "object" },
      }

      // Add the tool to available tools and initialize its state
      mcpService.getAvailableTools().push(mockTool)
      dynamicToolManager.initializeToolState("test-server:test-tool", "test-server", false)

      const result = await mcpService.executeToolCall({
        name: "tool_manager:disable_tool",
        arguments: {
          toolName: "test-server:test-tool",
          reason: "Testing disable functionality"
        },
      })

      expect(result.isError).toBe(false)
      expect(result.content).toHaveLength(1)

      const response = JSON.parse(result.content[0].text)
      expect(response.success).toBe(true)
      expect(response.newState).toBe(false)
    })

    it("should handle enable_tool for regular tools", async () => {
      // First, add and disable a mock regular tool
      const mockTool = {
        name: "test-server:test-tool",
        description: "Test tool",
        inputSchema: { type: "object" },
      }

      mcpService.getAvailableTools().push(mockTool)
      dynamicToolManager.initializeToolState("test-server:test-tool", "test-server", false)

      // Disable it first
      await dynamicToolManager.processToolControlRequest({
        toolName: "test-server:test-tool",
        action: 'disable',
        requestedBy: 'user',
      })

      // Now enable it via tool manager
      const result = await mcpService.executeToolCall({
        name: "tool_manager:enable_tool",
        arguments: {
          toolName: "test-server:test-tool",
          reason: "Re-enabling for testing"
        },
      })

      expect(result.isError).toBe(false)
      expect(result.content).toHaveLength(1)

      const response = JSON.parse(result.content[0].text)
      expect(response.success).toBe(true)
      expect(response.newState).toBe(true)
    })

    it("should get tool permissions", async () => {
      const result = await mcpService.executeToolCall({
        name: "tool_manager:get_tool_permissions",
        arguments: { toolName: "tool_manager:list_tools" },
      })

      expect(result.isError).toBe(false)
      expect(result.content).toHaveLength(1)

      const response = JSON.parse(result.content[0].text)
      expect(response).toHaveProperty("toolName", "tool_manager:list_tools")
      expect(response).toHaveProperty("permissions")
      expect(response).toHaveProperty("currentlyEnabled")
      expect(response).toHaveProperty("dynamicallyControlled")

      // Tool manager tools should have restricted permissions
      expect(response.permissions.canBeDisabledByAgent).toBe(false)
      expect(response.permissions.canBeEnabledByAgent).toBe(false)
    })

    it("should get tool usage stats", async () => {
      // Execute a tool first to generate some stats
      await mcpService.executeToolCall({
        name: "tool_manager:list_tools",
        arguments: {},
      })

      const result = await mcpService.executeToolCall({
        name: "tool_manager:get_tool_usage_stats",
        arguments: { toolName: "tool_manager:list_tools" },
      })

      expect(result.isError).toBe(false)
      expect(result.content).toHaveLength(1)

      const response = JSON.parse(result.content[0].text)
      expect(response).toHaveProperty("toolName", "tool_manager:list_tools")
      expect(response).toHaveProperty("usageStats")
      expect(response).toHaveProperty("lastModified")
      expect(response).toHaveProperty("modifiedBy")

      // Should have recorded at least one successful call
      expect(response.usageStats.totalCalls).toBeGreaterThan(0)
      expect(response.usageStats.successfulCalls).toBeGreaterThan(0)
    })

    it("should handle errors gracefully for non-existent tools", async () => {
      const result = await mcpService.executeToolCall({
        name: "tool_manager:get_tool_status",
        arguments: { toolName: "non-existent:tool" },
      })

      expect(result.isError).toBe(true)
      expect(result.content).toHaveLength(1)
      expect(result.content[0].text).toContain("Tool not found")
    })

    it("should prevent agents from disabling system tools", async () => {
      const result = await mcpService.executeToolCall({
        name: "tool_manager:disable_tool",
        arguments: {
          toolName: "tool_manager:list_tools",
          reason: "Trying to disable system tool"
        },
      })

      expect(result.isError).toBe(false) // The call succeeds but the operation fails
      expect(result.content).toHaveLength(1)

      const response = JSON.parse(result.content[0].text)
      expect(response.success).toBe(false)
      expect(response.error).toContain("not allowed for this tool")
    })
  })

  describe("Tool Filtering", () => {
    beforeEach(async () => {
      await mcpService.initialize()

      // Add some mock tools to the internal array
      const mockTools = [
        { name: "server1:tool1", description: "Tool 1", inputSchema: {} },
        { name: "server1:tool2", description: "Tool 2", inputSchema: {} },
        { name: "server2:tool3", description: "Tool 3", inputSchema: {} },
      ]

      for (const tool of mockTools) {
        // Add to internal available tools array
        ;(mcpService as any).availableTools.push(tool)
        const [serverName] = tool.name.split(":")
        dynamicToolManager.initializeToolState(tool.name, serverName, false)
      }
    })

    it("should filter tools by enabled status", async () => {
      // Disable one tool
      await dynamicToolManager.processToolControlRequest({
        toolName: "server1:tool1",
        action: 'disable',
        requestedBy: 'user',
      })

      const result = await mcpService.executeToolCall({
        name: "tool_manager:list_tools",
        arguments: { includeDisabled: false },
      })

      expect(result.isError).toBe(false)
      const response = JSON.parse(result.content[0].text)

      const disabledTool = response.tools.find((t: any) => t.name === "server1:tool1")
      expect(disabledTool).toBeUndefined()
    })

    it("should filter tools by server", async () => {
      const result = await mcpService.executeToolCall({
        name: "tool_manager:list_tools",
        arguments: { serverFilter: "server1" },
      })

      expect(result.isError).toBe(false)
      const response = JSON.parse(result.content[0].text)

      const server1Tools = response.tools.filter((t: any) => t.serverName === "server1")
      const server2Tools = response.tools.filter((t: any) => t.serverName === "server2")

      expect(server1Tools.length).toBe(2)
      expect(server2Tools.length).toBe(0)
    })
  })
})
