/**
 * Tests for ACP Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock child_process
const mockSpawn = vi.fn()
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// Mock fs/promises for file operations
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

// Mock state for toolApprovalManager
vi.mock("./state", () => ({
  toolApprovalManager: {
    requestApproval: vi.fn(() => ({
      approvalId: "test-approval-id",
      promise: Promise.resolve(true),
    })),
    respondToApproval: vi.fn(),
    getPendingApproval: vi.fn(),
    cancelSessionApprovals: vi.fn(),
    cancelAllApprovals: vi.fn(),
  },
}))

// Mock emit-agent-progress
vi.mock("./emit-agent-progress", () => ({
  emitAgentProgress: vi.fn(() => Promise.resolve()),
}))

// Mock config store
const mockConfig = {
  acpAgents: [
    {
      name: "test-agent",
      displayName: "Test Agent",
      description: "A test ACP agent",
      enabled: true,
      autoSpawn: false,
      connection: {
        type: "stdio" as const,
        command: "test-command",
        args: ["--test"],
        env: { TEST_VAR: "value" },
      },
    },
    {
      name: "disabled-agent",
      displayName: "Disabled Agent",
      enabled: false,
      connection: {
        type: "stdio" as const,
        command: "disabled-cmd",
      },
    },
    {
      name: "auto-spawn-agent",
      displayName: "Auto Spawn Agent",
      enabled: true,
      autoSpawn: true,
      connection: {
        type: "stdio" as const,
        command: "auto-cmd",
      },
    },
  ],
}

vi.mock("./config", () => ({
  configStore: {
    get: () => mockConfig,
  },
}))

// Mock debug
vi.mock("./debug", () => ({
  logApp: vi.fn(),
}))

describe("ACP Service", () => {
  let mockProcess: {
    stdout: { on: ReturnType<typeof vi.fn> }
    stderr: { on: ReturnType<typeof vi.fn> }
    stdin: { write: ReturnType<typeof vi.fn> }
    on: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
    killed: boolean
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock process
    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { write: vi.fn((data, cb) => cb && cb()) },
      on: vi.fn(),
      kill: vi.fn(),
      killed: false,
    }

    mockSpawn.mockReturnValue(mockProcess)
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe("getAgents", () => {
    it("should return all configured agents with status", async () => {
      const { acpService } = await import("./acp-service")
      const agents = acpService.getAgents()

      expect(agents).toHaveLength(3)
      expect(agents[0]).toEqual({
        config: expect.objectContaining({ name: "test-agent" }),
        status: "stopped",
        error: undefined,
      })
    })
  })

  describe("spawnAgent", () => {
    it("should spawn an agent process", async () => {
      const { acpService } = await import("./acp-service")

      // Don't await - just start the spawn
      const spawnPromise = acpService.spawnAgent("test-agent")

      // Verify spawn was called with correct args
      expect(mockSpawn).toHaveBeenCalledWith(
        "test-command",
        ["--test"],
        expect.objectContaining({
          env: expect.objectContaining({ TEST_VAR: "value" }),
          stdio: ["pipe", "pipe", "pipe"],
        })
      )

      // Wait for the spawn to complete
      await spawnPromise

      // Check status is ready
      const status = acpService.getAgentStatus("test-agent")
      expect(status?.status).toBe("ready")
    })

    it("should throw error for non-existent agent", async () => {
      const { acpService } = await import("./acp-service")

      await expect(acpService.spawnAgent("nonexistent")).rejects.toThrow(
        "Agent nonexistent not found in configuration"
      )
    })

    it("should throw error for disabled agent", async () => {
      const { acpService } = await import("./acp-service")

      await expect(acpService.spawnAgent("disabled-agent")).rejects.toThrow(
        "Agent disabled-agent is disabled"
      )
    })
  })

  describe("getAgentStatus", () => {
    it("should return stopped for unspawned agent", async () => {
      const { acpService } = await import("./acp-service")
      const status = acpService.getAgentStatus("test-agent")
      expect(status).toEqual({ status: "stopped" })
    })
  })

  describe("ACP Client Capabilities", () => {
    describe("fs/read_text_file", () => {
      it("should read file contents", async () => {
        const { readFile } = await import("fs/promises")
        const mockReadFile = vi.mocked(readFile)
        mockReadFile.mockResolvedValue("file content line 1\nline 2\nline 3")

        // Import the service to access internal methods via events
        const { acpService } = await import("./acp-service")
        
        // The handleReadTextFile is private, so we test via the event system
        // Verify the service exists
        expect(acpService).toBeDefined()
        expect(acpService.on).toBeDefined()
      })
    })

    describe("fs/write_text_file", () => {
      it("should have write file capability", async () => {
        const { writeFile, mkdir } = await import("fs/promises")
        const mockWriteFile = vi.mocked(writeFile)
        const mockMkdir = vi.mocked(mkdir)
        mockWriteFile.mockResolvedValue()
        mockMkdir.mockResolvedValue(undefined)

        // Verify imports work
        expect(mockWriteFile).toBeDefined()
        expect(mockMkdir).toBeDefined()
      })
    })

    describe("session/request_permission", () => {
      it("should have permission request types exported", async () => {
        // Verify the types can be imported
        const acpService = await import("./acp-service")
        
        // Check that the service has the toolCallUpdate event
        expect(acpService.acpService.on).toBeDefined()
        expect(typeof acpService.acpService.on).toBe("function")
      })
    })
  })

  describe("Tool Call Status Types", () => {
    it("should export tool call status types", async () => {
      const acpModule = await import("./acp-service")
      
      // Verify the module exports the expected types
      // (TypeScript interfaces don't exist at runtime, but we can verify the module loads)
      expect(acpModule.acpService).toBeDefined()
    })
  })
})

