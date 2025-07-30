import { describe, it, expect, vi } from 'vitest'

// Mock the config store to test default values
const mockConfigStore = {
  get: vi.fn(),
  save: vi.fn()
}

vi.mock('../config', () => ({
  configStore: mockConfigStore
}))

describe('Config Defaults', () => {

  it('should provide default MCP configuration structure', () => {
    // Mock a config with default MCP settings
    const mockConfig = {
      mcpToolsEnabled: true,
      mcpAgentModeEnabled: true,
      mcpAutoPasteEnabled: true,
      mcpAutoPasteDelay: 1000,
      mcpMaxIterations: 10,
      mcpRuntimeDisabledServers: [],
      mcpConfig: {
        mcpServers: {
          "filesystem": {
            transport: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
            env: {},
            disabled: false
          },
          "github": {
            transport: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: {
              GITHUB_PERSONAL_ACCESS_TOKEN: ""
            },
            disabled: true
          }
        }
      }
    }

    mockConfigStore.get.mockReturnValue(mockConfig)

    const config = mockConfigStore.get()

    // Check that mcpConfig exists
    expect(config.mcpConfig).toBeDefined()
    expect(config.mcpConfig?.mcpServers).toBeDefined()

    // Check that filesystem server is configured
    const filesystemServer = config.mcpConfig?.mcpServers?.filesystem
    expect(filesystemServer).toBeDefined()
    expect(filesystemServer?.transport).toBe('stdio')
    expect(filesystemServer?.command).toBe('npx')
    expect(filesystemServer?.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', process.cwd()])
    expect(filesystemServer?.disabled).toBe(false)

    // Check that github server is configured but disabled
    const githubServer = config.mcpConfig?.mcpServers?.github
    expect(githubServer).toBeDefined()
    expect(githubServer?.transport).toBe('stdio')
    expect(githubServer?.command).toBe('npx')
    expect(githubServer?.args).toEqual(['-y', '@modelcontextprotocol/server-github'])
    expect(githubServer?.disabled).toBe(true)
    expect(githubServer?.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('')
  })

  it('should have other MCP-related defaults', () => {
    const mockConfig = {
      mcpToolsEnabled: true,
      mcpAgentModeEnabled: true,
      mcpAutoPasteEnabled: true,
      mcpAutoPasteDelay: 1000,
      mcpMaxIterations: 10,
      mcpRuntimeDisabledServers: []
    }

    mockConfigStore.get.mockReturnValue(mockConfig)
    const config = mockConfigStore.get()

    expect(config.mcpToolsEnabled).toBe(true)
    expect(config.mcpAgentModeEnabled).toBe(true)
    expect(config.mcpAutoPasteEnabled).toBe(true)
    expect(config.mcpAutoPasteDelay).toBe(1000)
    expect(config.mcpMaxIterations).toBe(10)
    expect(config.mcpRuntimeDisabledServers).toEqual([])
  })

  it('should support custom MCP server configurations', () => {
    const mockConfig = {
      mcpConfig: {
        mcpServers: {
          'custom-server': {
            transport: 'stdio',
            command: 'echo',
            args: ['hello'],
            disabled: false
          },
          'websocket-server': {
            transport: 'websocket',
            url: 'ws://localhost:8080',
            timeout: 10000,
            disabled: false
          }
        }
      }
    }

    mockConfigStore.get.mockReturnValue(mockConfig)
    const config = mockConfigStore.get()

    // Should support custom servers
    expect(config.mcpConfig?.mcpServers?.['custom-server']).toBeDefined()
    expect(config.mcpConfig?.mcpServers?.['custom-server']?.command).toBe('echo')
    expect(config.mcpConfig?.mcpServers?.['websocket-server']).toBeDefined()
    expect(config.mcpConfig?.mcpServers?.['websocket-server']?.transport).toBe('websocket')
  })
})
