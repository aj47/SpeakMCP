import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest'
import {
  builtinTools,
  builtinToolDefinitions,
  isBuiltinTool,
  executeBuiltinTool,
  getBuiltinToolNames,
  BUILTIN_SERVER_NAME,
  type BuiltinToolDefinition,
} from './builtin-tools'

// Mock dependencies
vi.mock('../config', () => ({
  configStore: {
    get: vi.fn(),
    save: vi.fn(),
  },
}))

vi.mock('./profile-service', () => ({
  profileService: {
    getProfiles: vi.fn(),
    getCurrentProfile: vi.fn(),
    setCurrentProfile: vi.fn(),
  },
}))

vi.mock('./state', () => ({
  agentSessionStateManager: {},
  toolApprovalManager: {
    cancelAllApprovals: vi.fn(),
  },
}))

vi.mock('./emergency-stop', () => ({
  emergencyStopAll: vi.fn(),
}))

vi.mock('child_process', () => ({
  exec: vi.fn(),
}))

vi.mock('util', () => ({
  promisify: vi.fn((fn) => fn),
}))

import { configStore } from '../config'
import { profileService } from './profile-service'
import { toolApprovalManager } from './state'
import { emergencyStopAll } from './emergency-stop'
import { exec } from 'child_process'

describe('builtin-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('builtinTools array', () => {
    it('should export builtinTools and builtinToolDefinitions as the same array', () => {
      expect(builtinTools).toBe(builtinToolDefinitions)
    })

    it('should contain expected tool definitions', () => {
      const toolNames = builtinTools.map((t) => t.name)
      expect(toolNames).toContain('list_mcp_servers')
      expect(toolNames).toContain('toggle_mcp_server')
      expect(toolNames).toContain('list_profiles')
      expect(toolNames).toContain('switch_profile')
      expect(toolNames).toContain('get_current_profile')
      expect(toolNames).toContain('get_settings')
      expect(toolNames).toContain('execute_command')
      expect(toolNames).toContain('kill_all_agents')
    })

    it('should have proper inputSchema for each tool', () => {
      for (const tool of builtinTools) {
        expect(tool).toHaveProperty('name')
        expect(tool).toHaveProperty('description')
        expect(tool).toHaveProperty('inputSchema')
        expect(tool.inputSchema).toHaveProperty('type', 'object')
        expect(tool.inputSchema).toHaveProperty('properties')
        expect(tool.inputSchema).toHaveProperty('required')
        expect(Array.isArray(tool.inputSchema.required)).toBe(true)
      }
    })

    it('should have required fields specified correctly for tools with required params', () => {
      const toggleServer = builtinTools.find((t) => t.name === 'toggle_mcp_server')
      expect(toggleServer?.inputSchema.required).toContain('serverName')

      const switchProfile = builtinTools.find((t) => t.name === 'switch_profile')
      expect(switchProfile?.inputSchema.required).toContain('profileIdOrName')

      const executeCmd = builtinTools.find((t) => t.name === 'execute_command')
      expect(executeCmd?.inputSchema.required).toContain('command')
    })
  })

  describe('BUILTIN_SERVER_NAME', () => {
    it('should be speakmcp-settings', () => {
      expect(BUILTIN_SERVER_NAME).toBe('speakmcp-settings')
    })
  })

  describe('getBuiltinToolNames', () => {
    it('should return prefixed tool names', () => {
      const names = getBuiltinToolNames()
      expect(names.length).toBe(builtinTools.length)
      for (const name of names) {
        expect(name).toMatch(/^speakmcp-settings:/)
      }
    })

    it('should include all tool names with prefix', () => {
      const names = getBuiltinToolNames()
      expect(names).toContain('speakmcp-settings:list_mcp_servers')
      expect(names).toContain('speakmcp-settings:toggle_mcp_server')
      expect(names).toContain('speakmcp-settings:execute_command')
    })
  })

  describe('isBuiltinTool', () => {
    it('should return true for valid builtin tool names', () => {
      expect(isBuiltinTool('speakmcp-settings:list_mcp_servers')).toBe(true)
      expect(isBuiltinTool('speakmcp-settings:toggle_mcp_server')).toBe(true)
      expect(isBuiltinTool('speakmcp-settings:execute_command')).toBe(true)
    })

    it('should return true for any name starting with speakmcp-settings:', () => {
      expect(isBuiltinTool('speakmcp-settings:unknown_tool')).toBe(true)
      expect(isBuiltinTool('speakmcp-settings:')).toBe(true)
    })

    it('should return false for non-builtin tool names', () => {
      expect(isBuiltinTool('other-server:some_tool')).toBe(false)
      expect(isBuiltinTool('list_mcp_servers')).toBe(false)
      expect(isBuiltinTool('')).toBe(false)
      expect(isBuiltinTool('speakmcp-setting:list_mcp_servers')).toBe(false) // typo
    })
  })

  describe('executeBuiltinTool', () => {
    describe('unknown tool handling', () => {
      it('should return error for unknown tool', async () => {
        const result = await executeBuiltinTool('speakmcp-settings:unknown_tool', {})
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('not implemented')
      })

      it('should handle tool name without prefix', async () => {
        const result = await executeBuiltinTool('unknown_tool', {})
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('not implemented')
      })
    })

    describe('list_mcp_servers', () => {
      it('should list configured MCP servers', async () => {
        vi.mocked(configStore.get).mockReturnValue({
          mcpConfig: {
            mcpServers: {
              'test-server': { transport: 'stdio', command: 'node' },
              'disabled-server': { transport: 'stdio', disabled: true },
            },
          },
          mcpRuntimeDisabledServers: ['runtime-disabled'],
        })

        const result = await executeBuiltinTool('speakmcp-settings:list_mcp_servers', {})

        expect(result.isError).toBe(false)
        const data = JSON.parse(result.content[0].text)
        expect(data.servers).toHaveLength(2)
        expect(data.count).toBe(2)
      })

      it('should handle empty server config', async () => {
        vi.mocked(configStore.get).mockReturnValue({})

        const result = await executeBuiltinTool('list_mcp_servers', {})

        expect(result.isError).toBe(false)
        const data = JSON.parse(result.content[0].text)
        expect(data.servers).toHaveLength(0)
        expect(data.count).toBe(0)
      })
    })

    describe('toggle_mcp_server', () => {
      it('should return error when serverName is missing', async () => {
        const result = await executeBuiltinTool('speakmcp-settings:toggle_mcp_server', {})

        expect(result.isError).toBe(true)
        const data = JSON.parse(result.content[0].text)
        expect(data.error).toContain('serverName required')
      })

      it('should return error when serverName is empty string', async () => {
        const result = await executeBuiltinTool('toggle_mcp_server', { serverName: '  ' })

        expect(result.isError).toBe(true)
        const data = JSON.parse(result.content[0].text)
        expect(data.error).toContain('serverName required')
      })

      it('should return error when server not found', async () => {
        vi.mocked(configStore.get).mockReturnValue({
          mcpConfig: { mcpServers: {} },
        })

        const result = await executeBuiltinTool('toggle_mcp_server', { serverName: 'nonexistent' })

        expect(result.isError).toBe(true)
        const data = JSON.parse(result.content[0].text)
        expect(data.error).toContain('not found')
      })

      it('should toggle server successfully', async () => {
        vi.mocked(configStore.get).mockReturnValue({
          mcpConfig: { mcpServers: { 'my-server': { transport: 'stdio' } } },
          mcpRuntimeDisabledServers: [],
        })

        const result = await executeBuiltinTool('toggle_mcp_server', {
          serverName: 'my-server',
          enabled: false,
        })

        expect(result.isError).toBe(false)
        expect(configStore.save).toHaveBeenCalled()
        const data = JSON.parse(result.content[0].text)
        expect(data.success).toBe(true)
        expect(data.serverName).toBe('my-server')
      })
    })

    describe('list_profiles', () => {
      it('should list all profiles', async () => {
        vi.mocked(profileService.getProfiles).mockReturnValue([
          { id: 'p1', name: 'Default', isDefault: true, createdAt: 1, updatedAt: 1 },
          { id: 'p2', name: 'Custom', createdAt: 2, updatedAt: 2 },
        ])
        vi.mocked(profileService.getCurrentProfile).mockReturnValue({
          id: 'p1', name: 'Default', isDefault: true, createdAt: 1, updatedAt: 1,
        })

        const result = await executeBuiltinTool('speakmcp-settings:list_profiles', {})

        expect(result.isError).toBe(false)
        const data = JSON.parse(result.content[0].text)
        expect(data.profiles).toHaveLength(2)
        expect(data.profiles[0].isActive).toBe(true)
        expect(data.profiles[1].isActive).toBe(false)
      })
    })

    describe('switch_profile', () => {
      it('should return error when profileIdOrName is missing', async () => {
        const result = await executeBuiltinTool('switch_profile', {})

        expect(result.isError).toBe(true)
        const data = JSON.parse(result.content[0].text)
        expect(data.error).toContain('profileIdOrName required')
      })

      it('should return error when profile not found', async () => {
        vi.mocked(profileService.getProfiles).mockReturnValue([])

        const result = await executeBuiltinTool('switch_profile', { profileIdOrName: 'nonexistent' })

        expect(result.isError).toBe(true)
        const data = JSON.parse(result.content[0].text)
        expect(data.error).toContain('not found')
      })

      it('should switch profile by ID', async () => {
        vi.mocked(profileService.getProfiles).mockReturnValue([
          { id: 'profile-123', name: 'Test Profile', createdAt: 1, updatedAt: 1 },
        ])
        vi.mocked(configStore.get).mockReturnValue({})

        const result = await executeBuiltinTool('switch_profile', { profileIdOrName: 'profile-123' })

        expect(result.isError).toBe(false)
        expect(profileService.setCurrentProfile).toHaveBeenCalledWith('profile-123')
      })

      it('should switch profile by name (case insensitive)', async () => {
        vi.mocked(profileService.getProfiles).mockReturnValue([
          { id: 'p1', name: 'Developer Mode', createdAt: 1, updatedAt: 1 },
        ])
        vi.mocked(configStore.get).mockReturnValue({})

        const result = await executeBuiltinTool('switch_profile', { profileIdOrName: 'DEVELOPER MODE' })

        expect(result.isError).toBe(false)
        expect(profileService.setCurrentProfile).toHaveBeenCalledWith('p1')
      })
    })

    describe('get_current_profile', () => {
      it('should return current profile', async () => {
        vi.mocked(profileService.getCurrentProfile).mockReturnValue({
          id: 'active-profile', name: 'Active', guidelines: 'Be helpful', createdAt: 1, updatedAt: 1,
        })

        const result = await executeBuiltinTool('get_current_profile', {})

        expect(result.isError).toBe(false)
        const data = JSON.parse(result.content[0].text)
        expect(data.profile.id).toBe('active-profile')
        expect(data.profile.name).toBe('Active')
      })

      it('should return error when no current profile', async () => {
        vi.mocked(profileService.getCurrentProfile).mockReturnValue(null)

        const result = await executeBuiltinTool('get_current_profile', {})

        expect(result.isError).toBe(true)
        const data = JSON.parse(result.content[0].text)
        expect(data.error).toContain('No current profile')
      })
    })

    describe('get_settings', () => {
      it('should return feature settings with defaults', async () => {
        vi.mocked(configStore.get).mockReturnValue({})

        const result = await executeBuiltinTool('get_settings', {})

        expect(result.isError).toBe(false)
        const data = JSON.parse(result.content[0].text)
        expect(data.ttsEnabled).toBe(true) // default
        expect(data.toolApprovalEnabled).toBe(false) // default
        expect(data.verificationEnabled).toBe(true) // default
        expect(data.parallelToolExecutionEnabled).toBe(true) // default
      })

      it('should return configured settings', async () => {
        vi.mocked(configStore.get).mockReturnValue({
          ttsEnabled: false,
          mcpRequireApprovalBeforeToolCall: true,
          mcpVerifyCompletionEnabled: false,
          mcpParallelToolExecution: false,
        })

        const result = await executeBuiltinTool('get_settings', {})

        expect(result.isError).toBe(false)
        const data = JSON.parse(result.content[0].text)
        expect(data.ttsEnabled).toBe(false)
        expect(data.toolApprovalEnabled).toBe(true)
        expect(data.verificationEnabled).toBe(false)
        expect(data.parallelToolExecutionEnabled).toBe(false)
      })
    })

    describe('execute_command', () => {
      it('should return error when command is missing', async () => {
        const result = await executeBuiltinTool('execute_command', {})

        expect(result.isError).toBe(true)
        const data = JSON.parse(result.content[0].text)
        expect(data.error).toContain('command required')
      })

      it('should return error when command is not a string', async () => {
        const result = await executeBuiltinTool('execute_command', { command: 123 })

        expect(result.isError).toBe(true)
        const data = JSON.parse(result.content[0].text)
        expect(data.error).toContain('command required')
      })
    })

    describe('kill_all_agents', () => {
      it('should call emergency stop and cancel approvals', async () => {
        vi.mocked(emergencyStopAll).mockResolvedValue({ before: 3, after: 0 })

        const result = await executeBuiltinTool('kill_all_agents', {})

        expect(result.isError).toBe(false)
        expect(toolApprovalManager.cancelAllApprovals).toHaveBeenCalled()
        expect(emergencyStopAll).toHaveBeenCalled()
        const data = JSON.parse(result.content[0].text)
        expect(data.success).toBe(true)
        expect(data.processesKilled).toBe(3)
      })
    })

    describe('error handling', () => {
      it('should handle exceptions in tool handlers gracefully', async () => {
        vi.mocked(configStore.get).mockImplementation(() => {
          throw new Error('Config explosion!')
        })

        const result = await executeBuiltinTool('list_mcp_servers', {})

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Error executing')
        expect(result.content[0].text).toContain('Config explosion!')
      })
    })
  })
})

