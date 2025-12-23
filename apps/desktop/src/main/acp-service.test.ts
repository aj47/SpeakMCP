/**
 * Tests for ACP Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock child_process
const mockSpawn = vi.fn()
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// Mock config store
const mockConfig = {
  acpAgents: [
    {
      name: "test-agent",
      displayName: "Test Agent",
      description: "A test ACP agent",
      capabilities: ["testing"],
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
})

