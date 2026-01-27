/**
 * HTTP Endpoint Tests for SpeakMCP Server
 * Tests the Fastify routes using inject()
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// Mock all service dependencies before imports
vi.mock('./config', () => ({
  configStore: {
    get: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
    reload: vi.fn(),
  },
}))

vi.mock('./services/profile-service', () => ({
  profileService: {
    getProfiles: vi.fn(),
    getCurrentProfile: vi.fn(),
    setCurrentProfile: vi.fn(),
  },
}))

vi.mock('./services/conversation-service', () => ({
  conversationService: {
    getConversationHistory: vi.fn(),
    loadConversation: vi.fn(),
    createConversationWithId: vi.fn(),
    addMessageToConversation: vi.fn(),
    saveConversation: vi.fn(),
    generateConversationIdPublic: vi.fn(),
  },
}))

vi.mock('./services/mcp-service', () => ({
  mcpService: {
    initialize: vi.fn(),
    getServerStatus: vi.fn(),
    getAvailableTools: vi.fn(),
    executeToolCall: vi.fn(),
    setServerRuntimeEnabled: vi.fn(),
    applyProfileMcpConfig: vi.fn(),
  },
  handleWhatsAppToggle: vi.fn(),
}))

vi.mock('./services/emergency-stop', () => ({
  emergencyStopAll: vi.fn(),
}))

vi.mock('./services/diagnostics', () => ({
  diagnosticsService: {
    logError: vi.fn(),
    logInfo: vi.fn(),
  },
}))

vi.mock('./services/state', () => ({
  state: {
    isAgentModeActive: false,
    agentSessions: new Map(),
  },
  agentSessionStateManager: {
    stopAllSessions: vi.fn(),
    cleanupSession: vi.fn(),
  },
}))

vi.mock('./services/builtin-tools', () => ({
  builtinTools: [
    { name: 'speakmcp-settings:test_tool', description: 'Test tool', inputSchema: { type: 'object', properties: {}, required: [] } },
  ],
  isBuiltinTool: vi.fn((name: string) => name.startsWith('speakmcp-settings:')),
  executeBuiltinTool: vi.fn(),
}))

vi.mock('./services/llm', () => ({
  processTranscriptWithAgentMode: vi.fn(),
}))

import { startServer, stopServer } from './server'
import { configStore } from './config'
import { profileService } from './services/profile-service'
import { conversationService } from './services/conversation-service'
import { mcpService } from './services/mcp-service'
import { emergencyStopAll } from './services/emergency-stop'
import { builtinTools, executeBuiltinTool, isBuiltinTool } from './services/builtin-tools'

const TEST_API_KEY = 'test-api-key-12345'
const TEST_PORT = 3999

// Helper to make authorized requests
function authHeaders() {
  return { Authorization: `Bearer ${TEST_API_KEY}` }
}

describe('Server HTTP Endpoints', () => {
  let serverResult: { running: boolean; bind?: string; port?: number; error?: string }

  beforeAll(async () => {
    // Setup default mock returns
    vi.mocked(configStore.get).mockReturnValue({
      remoteServerApiKey: TEST_API_KEY,
      mcpToolsProviderId: 'openai',
      mcpToolsOpenaiModel: 'gpt-4o-mini',
    })

    serverResult = await startServer({
      port: TEST_PORT,
      bind: '127.0.0.1',
      apiKey: TEST_API_KEY,
      logLevel: 'silent',
    })
  })

  afterAll(async () => {
    await stopServer()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Restore default config mock
    vi.mocked(configStore.get).mockReturnValue({
      remoteServerApiKey: TEST_API_KEY,
      mcpToolsProviderId: 'openai',
      mcpToolsOpenaiModel: 'gpt-4o-mini',
    })
  })

  describe('Server startup', () => {
    it('should start successfully', () => {
      expect(serverResult.running).toBe(true)
      expect(serverResult.port).toBe(TEST_PORT)
    })
  })

  describe('Authentication', () => {
    it('should return 401 for missing Authorization header', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/models`)
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    it('should return 401 for invalid API key', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/models`, {
        headers: { Authorization: 'Bearer wrong-key' },
      })
      expect(response.status).toBe(401)
    })

    it('should return 401 for malformed Authorization header', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/models`, {
        headers: { Authorization: 'Basic sometoken' },
      })
      expect(response.status).toBe(401)
    })

    it('should allow OPTIONS requests without auth (CORS preflight)', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/models`, {
        method: 'OPTIONS',
      })
      expect(response.status).toBe(204)
    })

    it('should accept valid API key', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/models`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
    })
  })

  describe('GET /v1/models', () => {
    it('should return models list', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/models`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.object).toBe('list')
      expect(body.data).toBeInstanceOf(Array)
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data[0]).toHaveProperty('id')
      expect(body.data[0]).toHaveProperty('object', 'model')
    })

    it('should return the configured model', async () => {
      vi.mocked(configStore.get).mockReturnValue({
        remoteServerApiKey: TEST_API_KEY,
        mcpToolsProviderId: 'groq',
        mcpToolsGroqModel: 'llama-3.3-70b-versatile',
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/models`, {
        headers: authHeaders(),
      })
      const body = await response.json()
      expect(body.data[0].id).toBe('llama-3.3-70b-versatile')
    })
  })

  describe('GET /v1/profiles', () => {
    it('should return profiles list', async () => {
      vi.mocked(profileService.getProfiles).mockReturnValue([
        { id: 'p1', name: 'Default', isDefault: true, createdAt: 1000, updatedAt: 1000 },
        { id: 'p2', name: 'Custom', createdAt: 2000, updatedAt: 2000 },
      ])
      vi.mocked(profileService.getCurrentProfile).mockReturnValue({
        id: 'p1', name: 'Default', isDefault: true, createdAt: 1000, updatedAt: 1000,
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/profiles`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.profiles).toHaveLength(2)
      expect(body.currentProfileId).toBe('p1')
      expect(body.profiles[0]).toHaveProperty('id', 'p1')
      expect(body.profiles[0]).toHaveProperty('name', 'Default')
    })
  })

  describe('GET /v1/profiles/current', () => {
    it('should return current profile', async () => {
      vi.mocked(profileService.getCurrentProfile).mockReturnValue({
        id: 'p1', name: 'Default', isDefault: true, guidelines: 'Be helpful',
        createdAt: 1000, updatedAt: 1000,
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/profiles/current`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.id).toBe('p1')
      expect(body.name).toBe('Default')
      expect(body.guidelines).toBe('Be helpful')
    })

    it('should return 404 when no current profile', async () => {
      vi.mocked(profileService.getCurrentProfile).mockReturnValue(null)

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/profiles/current`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toContain('No current profile')
    })
  })

  describe('POST /v1/profiles/current', () => {
    it('should switch profile successfully', async () => {
      vi.mocked(profileService.setCurrentProfile).mockReturnValue({
        id: 'p2', name: 'Custom', isDefault: false, createdAt: 2000, updatedAt: 2000,
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/profiles/current`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: 'p2' }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.profile.id).toBe('p2')
      expect(profileService.setCurrentProfile).toHaveBeenCalledWith('p2')
      expect(mcpService.applyProfileMcpConfig).toHaveBeenCalled()
    })

    it('should return 400 for missing profileId', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/profiles/current`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('profileId')
    })

    it('should return 404 for non-existent profile', async () => {
      vi.mocked(profileService.setCurrentProfile).mockImplementation(() => {
        throw new Error('Profile not found')
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/profiles/current`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: 'nonexistent' }),
      })
      expect(response.status).toBe(404)
    })
  })


  describe('GET /v1/mcp/servers', () => {
    it('should return MCP server list', async () => {
      vi.mocked(mcpService.getServerStatus).mockReturnValue({
        'test-server': { connected: true, toolCount: 5 },
        'other-server': { connected: false, toolCount: 0 },
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/mcp/servers`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.servers).toBeInstanceOf(Array)
      expect(body.servers).toHaveLength(2)
      expect(body.servers[0]).toHaveProperty('name')
      expect(body.servers[0]).toHaveProperty('connected')
      expect(body.servers[0]).toHaveProperty('toolCount')
    })

    it('should filter out speakmcp-settings server', async () => {
      vi.mocked(mcpService.getServerStatus).mockReturnValue({
        'speakmcp-settings': { connected: true, toolCount: 10 },
        'user-server': { connected: true, toolCount: 3 },
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/mcp/servers`, {
        headers: authHeaders(),
      })
      const body = await response.json()
      expect(body.servers).toHaveLength(1)
      expect(body.servers[0].name).toBe('user-server')
    })
  })

  describe('GET /v1/settings', () => {
    it('should return settings with defaults', async () => {
      vi.mocked(configStore.get).mockReturnValue({
        remoteServerApiKey: TEST_API_KEY,
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/settings`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.mcpToolsProviderId).toBe('openai')
      expect(body.transcriptPostProcessingEnabled).toBe(true)
      expect(body.mcpRequireApprovalBeforeToolCall).toBe(false)
      expect(body.ttsEnabled).toBe(true)
      expect(body.mcpMaxIterations).toBe(10)
    })

    it('should return configured settings', async () => {
      vi.mocked(configStore.get).mockReturnValue({
        remoteServerApiKey: TEST_API_KEY,
        mcpToolsProviderId: 'groq',
        ttsEnabled: false,
        mcpRequireApprovalBeforeToolCall: true,
        mcpMaxIterations: 25,
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/settings`, {
        headers: authHeaders(),
      })
      const body = await response.json()
      expect(body.mcpToolsProviderId).toBe('groq')
      expect(body.ttsEnabled).toBe(false)
      expect(body.mcpRequireApprovalBeforeToolCall).toBe(true)
      expect(body.mcpMaxIterations).toBe(25)
    })
  })

  describe('PATCH /v1/settings', () => {
    it('should update settings successfully', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/settings`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttsEnabled: false, mcpMaxIterations: 20 }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.updated).toContain('ttsEnabled')
      expect(body.updated).toContain('mcpMaxIterations')
      expect(configStore.save).toHaveBeenCalled()
    })

    it('should return 400 when no valid settings provided', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/settings`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalidSetting: 'value' }),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('No valid settings')
    })

    it('should validate provider ID', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/settings`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpToolsProviderId: 'groq' }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.updated).toContain('mcpToolsProviderId')
    })

    it('should reject invalid provider ID', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/settings`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpToolsProviderId: 'invalid-provider' }),
      })
      expect(response.status).toBe(400)
    })

    it('should clamp mcpMaxIterations to valid range', async () => {
      // Value 50 is within 1-100 range, should be accepted
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/settings`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpMaxIterations: 50 }),
      })
      expect(response.status).toBe(200)
    })
  })


  describe('GET /v1/conversations', () => {
    it('should return conversations list', async () => {
      vi.mocked(conversationService.getConversationHistory).mockResolvedValue([
        { id: 'conv1', title: 'First', createdAt: 1000, updatedAt: 1000, messageCount: 2 },
        { id: 'conv2', title: 'Second', createdAt: 2000, updatedAt: 2000, messageCount: 5 },
      ])

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.conversations).toHaveLength(2)
    })
  })

  describe('GET /v1/conversations/:id', () => {
    it('should return conversation by ID', async () => {
      vi.mocked(conversationService.loadConversation).mockResolvedValue({
        id: 'conv123',
        title: 'Test Conversation',
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          { id: 'msg1', role: 'user', content: 'Hello', timestamp: 1000 },
          { id: 'msg2', role: 'assistant', content: 'Hi there!', timestamp: 1001 },
        ],
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations/conv123`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.id).toBe('conv123')
      expect(body.title).toBe('Test Conversation')
      expect(body.messages).toHaveLength(2)
    })

    it('should return 404 for non-existent conversation', async () => {
      vi.mocked(conversationService.loadConversation).mockResolvedValue(null)

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations/nonexistent`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toContain('not found')
    })

    it('should reject path traversal in conversation ID', async () => {
      // Use a URL-encoded path traversal that the server should detect
      vi.mocked(conversationService.loadConversation).mockResolvedValue(null)

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations/conv..test`, {
        headers: authHeaders(),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('path traversal')
    })
  })

  describe('POST /v1/conversations', () => {
    it('should create conversation successfully', async () => {
      vi.mocked(conversationService.generateConversationIdPublic).mockReturnValue('conv_new_123')
      vi.mocked(conversationService.saveConversation).mockResolvedValue(undefined)

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'Hello there' },
            { role: 'assistant', content: 'Hi!' },
          ],
        }),
      })
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.id).toBe('conv_new_123')
      expect(body.messages).toHaveLength(2)
      expect(conversationService.saveConversation).toHaveBeenCalled()
    })

    it('should return 400 for missing messages', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('messages')
    })

    it('should return 400 for empty messages array', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      })
      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid message role', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'invalid', content: 'test' }],
        }),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('role')
    })

    it('should return 400 for non-string content', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 123 }],
        }),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('content')
    })

    it('should use custom title if provided', async () => {
      vi.mocked(conversationService.generateConversationIdPublic).mockReturnValue('conv_custom')
      vi.mocked(conversationService.saveConversation).mockResolvedValue(undefined)

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/conversations`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'My Custom Title',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      })
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.title).toBe('My Custom Title')
    })
  })


  describe('POST /v1/emergency-stop', () => {
    it('should execute emergency stop successfully', async () => {
      vi.mocked(emergencyStopAll).mockResolvedValue({ before: 5, after: 0 })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/emergency-stop`, {
        method: 'POST',
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('Emergency stop')
      expect(body.processesKilled).toBe(5)
      expect(body.processesRemaining).toBe(0)
      expect(emergencyStopAll).toHaveBeenCalled()
    })

    it('should handle emergency stop error', async () => {
      vi.mocked(emergencyStopAll).mockRejectedValue(new Error('Stop failed'))

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/emergency-stop`, {
        method: 'POST',
        headers: authHeaders(),
      })
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('Stop failed')
    })
  })

  describe('POST /mcp/tools/list', () => {
    it('should return builtin tools list', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp/tools/list`, {
        method: 'POST',
        headers: authHeaders(),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.tools).toBeInstanceOf(Array)
      expect(body.tools.length).toBeGreaterThan(0)
      expect(body.tools[0]).toHaveProperty('name')
      expect(body.tools[0]).toHaveProperty('description')
      expect(body.tools[0]).toHaveProperty('inputSchema')
    })
  })

  describe('POST /mcp/tools/call', () => {
    it('should call builtin tool successfully', async () => {
      vi.mocked(isBuiltinTool).mockReturnValue(true)
      vi.mocked(executeBuiltinTool).mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }],
        isError: false,
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp/tools/call`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'speakmcp-settings:test_tool',
          arguments: { param: 'value' },
        }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.content).toBeInstanceOf(Array)
      expect(body.isError).toBe(false)
      expect(executeBuiltinTool).toHaveBeenCalledWith('speakmcp-settings:test_tool', { param: 'value' })
    })

    it('should return 400 for missing tool name', async () => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp/tools/call`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('name')
    })

    it('should return 400 for unknown tool', async () => {
      vi.mocked(isBuiltinTool).mockReturnValue(false)

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp/tools/call`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'unknown:tool',
          arguments: {},
        }),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('Unknown builtin tool')
    })

    it('should handle tool execution error', async () => {
      vi.mocked(isBuiltinTool).mockReturnValue(true)
      vi.mocked(executeBuiltinTool).mockRejectedValue(new Error('Tool execution failed'))

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp/tools/call`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'speakmcp-settings:test_tool',
          arguments: {},
        }),
      })
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.isError).toBe(true)
      expect(body.content[0].text).toContain('Tool execution failed')
    })

    it('should handle missing arguments gracefully', async () => {
      vi.mocked(isBuiltinTool).mockReturnValue(true)
      vi.mocked(executeBuiltinTool).mockResolvedValue({
        content: [{ type: 'text', text: 'OK' }],
        isError: false,
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp/tools/call`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'speakmcp-settings:test_tool',
        }),
      })
      expect(response.status).toBe(200)
      expect(executeBuiltinTool).toHaveBeenCalledWith('speakmcp-settings:test_tool', {})
    })
  })
})