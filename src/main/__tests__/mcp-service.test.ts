import { mcpService } from '../mcp-service'
import { configStore } from '../config'
import { MCPConfig, MCPServerConfig } from '../../shared/types'

// Mock the dependencies
jest.mock('../config', () => ({
  configStore: {
    get: jest.fn()
  }
}))

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    callTool: jest.fn(),
    close: jest.fn()
  }))
}))

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn()
  }))
}))

describe('MCPService', () => {
  const mockConfigStore = configStore as jest.Mocked<typeof configStore>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('initialize', () => {
    it('should initialize with no tools when no MCP config is provided', async () => {
      mockConfigStore.get.mockReturnValue({})

      await mcpService.initialize()

      const tools = mcpService.getAvailableTools()
      expect(tools).toHaveLength(0)
    })

    it('should initialize with no tools when MCP config is empty', async () => {
      mockConfigStore.get.mockReturnValue({
        mcpConfig: { mcpServers: {} }
      })

      await mcpService.initialize()

      const tools = mcpService.getAvailableTools()
      expect(tools).toHaveLength(0)
    })

    it('should skip disabled servers', async () => {
      const mcpConfig: MCPConfig = {
        mcpServers: {
          'test-server': {
            command: 'echo',
            args: ['test'],
            disabled: true
          }
        }
      }

      mockConfigStore.get.mockReturnValue({ mcpConfig })

      await mcpService.initialize()

      const tools = mcpService.getAvailableTools()
      expect(tools).toHaveLength(0) // No tools when servers are disabled
    })

    it('should not re-initialize runtime-disabled servers on subsequent calls', async () => {
      const mcpConfig: MCPConfig = {
        mcpServers: {
          'test-server': {
            command: 'echo',
            args: ['test']
          }
        }
      }

      mockConfigStore.get.mockReturnValue({ mcpConfig })

      // First initialization - should initialize the server
      await mcpService.initialize()
      expect(mcpService.isServerRuntimeEnabled('test-server')).toBe(true)

      // User disables the server at runtime
      mcpService.setServerRuntimeEnabled('test-server', false)
      expect(mcpService.isServerRuntimeEnabled('test-server')).toBe(false)

      // Second initialization (like agent mode trigger) - should NOT re-enable the server
      await mcpService.initialize()
      expect(mcpService.isServerRuntimeEnabled('test-server')).toBe(false)
    })
  })

  describe('getServerStatus', () => {
    it('should return empty status when no servers are configured', () => {
      mockConfigStore.get.mockReturnValue({})
      const status = mcpService.getServerStatus()
      expect(status).toEqual({})
    })

    it('should include runtime state information', () => {
      const mcpConfig: MCPConfig = {
        mcpServers: {
          'test-server': {
            command: 'echo',
            args: ['test'],
            disabled: false
          }
        }
      }

      mockConfigStore.get.mockReturnValue({ mcpConfig })
      const status = mcpService.getServerStatus()

      expect(status['test-server']).toEqual({
        connected: false,
        toolCount: 0,
        runtimeEnabled: true,
        configDisabled: false
      })
    })
  })

  describe('runtime server state management', () => {
    it('should allow setting server runtime enabled state', () => {
      const mcpConfig: MCPConfig = {
        mcpServers: {
          'test-server': {
            command: 'echo',
            args: ['test']
          }
        }
      }

      mockConfigStore.get.mockReturnValue({ mcpConfig })

      // Initially enabled
      expect(mcpService.isServerRuntimeEnabled('test-server')).toBe(true)
      expect(mcpService.isServerAvailable('test-server')).toBe(true)

      // Disable runtime
      const result = mcpService.setServerRuntimeEnabled('test-server', false)
      expect(result).toBe(true)
      expect(mcpService.isServerRuntimeEnabled('test-server')).toBe(false)
      expect(mcpService.isServerAvailable('test-server')).toBe(false)

      // Re-enable
      mcpService.setServerRuntimeEnabled('test-server', true)
      expect(mcpService.isServerRuntimeEnabled('test-server')).toBe(true)
      expect(mcpService.isServerAvailable('test-server')).toBe(true)
    })

    it('should respect config disabled flag even when runtime enabled', () => {
      const mcpConfig: MCPConfig = {
        mcpServers: {
          'disabled-server': {
            command: 'echo',
            args: ['test'],
            disabled: true
          }
        }
      }

      mockConfigStore.get.mockReturnValue({ mcpConfig })

      // Even if runtime enabled, config disabled should make it unavailable
      expect(mcpService.isServerRuntimeEnabled('disabled-server')).toBe(true)
      expect(mcpService.isServerAvailable('disabled-server')).toBe(false)
    })

    it('should return false when setting state for non-existent server', () => {
      mockConfigStore.get.mockReturnValue({})
      const result = mcpService.setServerRuntimeEnabled('non-existent', false)
      expect(result).toBe(false)
    })
  })

  describe('testServerConnection', () => {
    it('should return error for missing command', async () => {
      const serverConfig: MCPServerConfig = {
        command: '',
        args: []
      }

      const result = await mcpService.testServerConnection('test', serverConfig)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Command is required')
    })

    it('should return error for invalid args', async () => {
      const serverConfig = {
        command: 'echo',
        args: 'invalid' as any
      }

      const result = await mcpService.testServerConnection('test', serverConfig)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Args must be an array')
    })

    it('should return success for valid config', async () => {
      const serverConfig: MCPServerConfig = {
        command: 'echo',
        args: ['test']
      }

      const result = await mcpService.testServerConnection('test', serverConfig)

      expect(result.success).toBe(true)
    })
  })

  describe('executeToolCall', () => {
    it('should handle unknown tools when no servers configured', async () => {
      await mcpService.initialize()

      const result = await mcpService.executeToolCall({
        name: 'unknown_tool',
        arguments: {}
      })

      expect(result.content).toHaveLength(1)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown tool: unknown_tool. Only MCP server tools are supported.')
    })
  })

  describe('cleanup', () => {
    it('should clear all data on cleanup', async () => {
      await mcpService.initialize()

      await mcpService.cleanup()

      const tools = mcpService.getAvailableTools()
      expect(tools).toHaveLength(0)
    })
  })
})
