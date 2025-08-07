import { MCPConfig, MCPServerConfig } from "../../shared/types"

// Mock the tipc router validation function
const validateMcpConfig = (
  config: MCPConfig,
): { valid: boolean; error?: string } => {
  try {
    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      return { valid: false, error: "Missing or invalid mcpServers" }
    }

    for (const [serverName, serverConfig] of Object.entries(
      config.mcpServers,
    )) {
      if (!serverConfig.command) {
        return {
          valid: false,
          error: `Server "${serverName}": missing command`,
        }
      }
      if (!Array.isArray(serverConfig.args)) {
        return {
          valid: false,
          error: `Server "${serverName}": args must be an array`,
        }
      }
      if (serverConfig.env && typeof serverConfig.env !== "object") {
        return {
          valid: false,
          error: `Server "${serverName}": env must be an object`,
        }
      }
      if (serverConfig.timeout && typeof serverConfig.timeout !== "number") {
        return {
          valid: false,
          error: `Server "${serverName}": timeout must be a number`,
        }
      }
      if (serverConfig.disabled && typeof serverConfig.disabled !== "boolean") {
        return {
          valid: false,
          error: `Server "${serverName}": disabled must be a boolean`,
        }
      }
    }

    return { valid: true }
  } catch (error) {
    return { valid: false, error: error.message }
  }
}

describe("MCP Config Validation", () => {
  describe("validateMcpConfig", () => {
    it("should validate a correct MCP config", () => {
      const config: MCPConfig = {
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-test"],
            env: {
              API_KEY: "test-key",
            },
            timeout: 30000,
            disabled: false,
          },
        },
      }

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it("should reject config without mcpServers", () => {
      const config = {} as MCPConfig

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(false)
      expect(result.error).toBe("Missing or invalid mcpServers")
    })

    it("should reject config with invalid mcpServers type", () => {
      const config = {
        mcpServers: "invalid",
      } as any

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(false)
      expect(result.error).toBe("Missing or invalid mcpServers")
    })

    it("should reject server config without command", () => {
      const config: MCPConfig = {
        mcpServers: {
          "test-server": {
            command: "",
            args: [],
          },
        },
      }

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Server "test-server": missing command')
    })

    it("should reject server config with invalid args", () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "npx",
            args: "invalid",
          },
        },
      } as any

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Server "test-server": args must be an array')
    })

    it("should reject server config with invalid env", () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "npx",
            args: [],
            env: "invalid",
          },
        },
      } as any

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Server "test-server": env must be an object')
    })

    it("should reject server config with invalid timeout", () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "npx",
            args: [],
            timeout: "invalid",
          },
        },
      } as any

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(false)
      expect(result.error).toBe(
        'Server "test-server": timeout must be a number',
      )
    })

    it("should reject server config with invalid disabled flag", () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "npx",
            args: [],
            disabled: "invalid",
          },
        },
      } as any

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(false)
      expect(result.error).toBe(
        'Server "test-server": disabled must be a boolean',
      )
    })

    it("should validate minimal server config", () => {
      const config: MCPConfig = {
        mcpServers: {
          "minimal-server": {
            command: "echo",
            args: ["hello"],
          },
        },
      }

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(true)
    })

    it("should validate multiple servers", () => {
      const config: MCPConfig = {
        mcpServers: {
          server1: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-test1"],
          },
          server2: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-test2"],
            disabled: true,
          },
        },
      }

      const result = validateMcpConfig(config)
      expect(result.valid).toBe(true)
    })
  })
})
