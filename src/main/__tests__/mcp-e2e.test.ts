import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { spawn, ChildProcess } from "child_process"
import path from "path"
import fs from "fs"

/**
 * End-to-End tests for MCP functionality
 * These tests verify the complete workflow from configuration to tool execution
 */

// Mock the config store
const mockConfigStore = {
  get: vi.fn(),
  set: vi.fn(),
}

vi.mock("../config", () => ({
  configStore: mockConfigStore,
}))

// Import after mocking
const { mcpService } = await import("../mcp-service")

describe("MCP End-to-End Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await mcpService.cleanup()
  })

  afterEach(async () => {
    await mcpService.cleanup()
  })

  describe("Complete MCP Workflow", () => {
    it("should handle complete workflow with mock server", async () => {
      // Skip if in CI or mock server doesn't exist
      const mockServerPath = path.join(
        process.cwd(),
        "scripts",
        "mock-mcp-server.mjs",
      )
      try {
        await fs.promises.access(mockServerPath)
      } catch {
        console.warn("Mock MCP server not found, skipping E2E test")
        return
      }

      // 1. Configure MCP server
      const serverConfig = {
        command: "node",
        args: [mockServerPath],
        timeout: 10000,
        env: {
          NODE_ENV: "test",
        },
      }

      mockConfigStore.get.mockReturnValue({
        mcpConfig: {
          mcpServers: {
            "test-server": serverConfig,
          },
        },
      })

      // 2. Initialize MCP service
      await mcpService.initialize()

      // 3. Verify tools are available
      const tools = mcpService.getAvailableTools()
      expect(tools.length).toBeGreaterThan(0)

      const serverTools = tools.filter((t) => t.name.startsWith("test-server:"))
      expect(serverTools.length).toBeGreaterThan(0)

      // 4. Test tool execution
      const echoResult = await mcpService.executeToolCall({
        name: "test-server:echo",
        arguments: { message: "Hello from E2E test!" },
      })

      expect(echoResult.content).toHaveLength(1)
      expect(echoResult.content[0].text).toContain("Echo: Hello from E2E test!")

      // 5. Test math tool
      const mathResult = await mcpService.executeToolCall({
        name: "test-server:add_numbers",
        arguments: { a: 5, b: 3 },
      })

      expect(mathResult.content).toHaveLength(1)
      expect(mathResult.content[0].text).toContain("5 + 3 = 8")

      // 6. Test file creation simulation
      const fileResult = await mcpService.executeToolCall({
        name: "test-server:create_test_file",
        arguments: { filename: "test.txt", content: "Hello, world!" },
      })

      expect(fileResult.content).toHaveLength(1)
      expect(fileResult.content[0].text).toContain(
        'Created test file "test.txt"',
      )
    }, 15000) // Longer timeout for real process spawning

    it("should handle server restart workflow", async () => {
      const mockServerPath = path.join(
        process.cwd(),
        "scripts",
        "mock-mcp-server.mjs",
      )
      try {
        await fs.promises.access(mockServerPath)
      } catch {
        console.warn("Mock MCP server not found, skipping restart test")
        return
      }

      const serverConfig = {
        command: "node",
        args: [mockServerPath],
        timeout: 10000,
      }

      mockConfigStore.get.mockReturnValue({
        mcpConfig: {
          mcpServers: {
            "restart-test": serverConfig,
          },
        },
      })

      // 1. Initial setup
      await mcpService.initialize()
      let tools = mcpService.getAvailableTools()
      const initialToolCount = tools.filter((t) =>
        t.name.startsWith("restart-test:"),
      ).length
      expect(initialToolCount).toBeGreaterThan(0)

      // 2. Test server restart
      const restartResult = await mcpService.restartServer("restart-test")
      expect(restartResult.success).toBe(true)

      // 3. Verify tools are still available after restart
      tools = mcpService.getAvailableTools()
      const postRestartToolCount = tools.filter((t) =>
        t.name.startsWith("restart-test:"),
      ).length
      expect(postRestartToolCount).toBe(initialToolCount)

      // 4. Test tool execution after restart
      const result = await mcpService.executeToolCall({
        name: "restart-test:echo",
        arguments: { message: "Post-restart test" },
      })

      expect(result.content).toHaveLength(1)
      expect(result.content[0].text).toContain("Echo: Post-restart test")
    }, 20000)

    it("should handle server connection testing", async () => {
      const mockServerPath = path.join(
        process.cwd(),
        "scripts",
        "mock-mcp-server.mjs",
      )

      // Test with valid server config
      const validConfig = {
        command: "node",
        args: [mockServerPath],
        timeout: 5000,
      }

      try {
        await fs.promises.access(mockServerPath)
        const result = await mcpService.testServerConnection(
          "test-connection",
          validConfig,
        )
        expect(result.success).toBe(true)
        expect(result.toolCount).toBeGreaterThan(0)
      } catch {
        console.warn("Mock server not available, testing with echo command")
        const echoConfig = {
          command: "echo",
          args: ["test"],
          timeout: 5000,
        }
        const result = await mcpService.testServerConnection(
          "echo-test",
          echoConfig,
        )
        expect(result.success).toBe(false) // echo won't work as MCP server
      }

      // Test with invalid server config
      const invalidConfig = {
        command: "nonexistent-command",
        args: ["test"],
        timeout: 5000,
      }

      const invalidResult = await mcpService.testServerConnection(
        "invalid-test",
        invalidConfig,
      )
      expect(invalidResult.success).toBe(false)
      expect(invalidResult.error).toBeTruthy()
    })

    it("should handle no tools when no servers configured", async () => {
      // Configure with no MCP servers
      mockConfigStore.get.mockReturnValue({})

      await mcpService.initialize()

      const tools = mcpService.getAvailableTools()
      expect(tools.length).toBe(0)

      // Test unknown tool execution should return error
      const result = await mcpService.executeToolCall({
        name: "unknown_tool",
        arguments: { test: "value" },
      })

      expect(result.content).toHaveLength(1)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(
        /Unknown tool.*Only MCP server tools are supported/,
      )
    })

    it("should handle multiple servers simultaneously", async () => {
      const mockServerPath = path.join(
        process.cwd(),
        "scripts",
        "mock-mcp-server.mjs",
      )
      try {
        await fs.promises.access(mockServerPath)
      } catch {
        console.warn("Mock MCP server not found, skipping multi-server test")
        return
      }

      const serverConfig = {
        command: "node",
        args: [mockServerPath],
        timeout: 10000,
      }

      mockConfigStore.get.mockReturnValue({
        mcpConfig: {
          mcpServers: {
            server1: serverConfig,
            server2: serverConfig,
            "disabled-server": {
              ...serverConfig,
              disabled: true,
            },
          },
        },
      })

      await mcpService.initialize()

      const tools = mcpService.getAvailableTools()

      // Should have tools from both active servers
      const server1Tools = tools.filter((t) => t.name.startsWith("server1:"))
      const server2Tools = tools.filter((t) => t.name.startsWith("server2:"))
      const disabledTools = tools.filter((t) =>
        t.name.startsWith("disabled-server:"),
      )

      expect(server1Tools.length).toBeGreaterThan(0)
      expect(server2Tools.length).toBeGreaterThan(0)
      expect(disabledTools.length).toBe(0) // Disabled server should not contribute tools

      // Test execution on both servers
      const result1 = await mcpService.executeToolCall({
        name: "server1:echo",
        arguments: { message: "Server 1 test" },
      })

      const result2 = await mcpService.executeToolCall({
        name: "server2:echo",
        arguments: { message: "Server 2 test" },
      })

      expect(result1.content[0].text).toContain("Echo: Server 1 test")
      expect(result2.content[0].text).toContain("Echo: Server 2 test")
    }, 25000)
  })

  describe("Error Handling", () => {
    it("should handle tool execution errors gracefully", async () => {
      const mockServerPath = path.join(
        process.cwd(),
        "scripts",
        "mock-mcp-server.mjs",
      )
      try {
        await fs.promises.access(mockServerPath)
      } catch {
        console.warn("Mock MCP server not found, skipping error handling test")
        return
      }

      const serverConfig = {
        command: "node",
        args: [mockServerPath],
        timeout: 10000,
      }

      mockConfigStore.get.mockReturnValue({
        mcpConfig: {
          mcpServers: {
            "error-test": serverConfig,
          },
        },
      })

      await mcpService.initialize()

      // Test unknown tool - should return error result
      const unknownToolResult = await mcpService.executeToolCall({
        name: "error-test:unknown_tool",
        arguments: {},
      })
      expect(unknownToolResult.isError).toBe(true)
      expect(unknownToolResult.content[0].text).toContain("Unknown tool")
    })
  })
})
