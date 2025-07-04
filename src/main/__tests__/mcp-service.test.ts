import { MCPService } from '../mcp-service'
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
  let mcpService: MCPService
  const mockConfigStore = configStore as jest.Mocked<typeof configStore>

  beforeEach(() => {
    mcpService = new MCPService()
    jest.clearAllMocks()
  })

  describe('initialize', () => {
    it('should initialize with fallback tools when no MCP config is provided', async () => {
      mockConfigStore.get.mockReturnValue({})

      await mcpService.initialize()

      const tools = mcpService.getAvailableTools()
      expect(tools).toHaveLength(4)
      expect(tools.map(t => t.name)).toEqual([
        'create_file',
        'read_file', 
        'list_files',
        'send_notification'
      ])
    })

    it('should initialize with fallback tools when MCP config is empty', async () => {
      mockConfigStore.get.mockReturnValue({
        mcpConfig: { mcpServers: {} }
      })

      await mcpService.initialize()

      const tools = mcpService.getAvailableTools()
      expect(tools).toHaveLength(4)
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
      expect(tools).toHaveLength(4) // Only fallback tools
    })
  })

  describe('getServerStatus', () => {
    it('should return empty status when no servers are configured', () => {
      const status = mcpService.getServerStatus()
      expect(status).toEqual({})
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
    it('should execute fallback tools', async () => {
      await mcpService.initialize()

      const result = await mcpService.executeToolCall({
        name: 'send_notification',
        arguments: { title: 'Test', message: 'Test message' }
      })

      expect(result.content).toHaveLength(1)
      expect(result.content[0].text).toContain('Notification sent')
    })

    it('should handle unknown tools', async () => {
      await mcpService.initialize()

      await expect(mcpService.executeToolCall({
        name: 'unknown_tool',
        arguments: {}
      })).rejects.toThrow('Unknown tool: unknown_tool')
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
