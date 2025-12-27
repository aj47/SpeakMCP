import { HttpClient } from './http.js'
import { WebSocketClient, type WebSocketStatus } from './websocket.js'
import type {
  ClientConfig,
  Conversation,
  ConversationSummary,
  ConversationMessage,
  Profile,
  CreateProfileInput,
  UpdateProfileInput,
  AgentOptions,
  AgentProgress,
  AgentSession,
  McpServer,
  McpTool,
  McpServerConfig,
  QueuedMessage,
  AppConfig,
  HealthStatus,
  DiagnosticReport,
  ModelInfo,
  TranscribeOptions,
  SpeakOptions,
  Unsubscribe,
} from './types.js'

export class SpeakMCPClient {
  private http: HttpClient
  private ws: WebSocketClient | null = null
  private config: ClientConfig

  constructor(config: ClientConfig) {
    this.config = config
    this.http = new HttpClient(config)
  }

  // ==================== WebSocket ====================

  connectWebSocket(onStatusChange?: (status: WebSocketStatus) => void): void {
    const wsUrl = this.config.baseUrl
      .replace(/^http/, 'ws')
      .replace(/\/$/, '') + '/api/ws'

    this.ws = new WebSocketClient({
      url: wsUrl,
      apiKey: this.config.apiKey,
      onStatusChange,
    })
    this.ws.connect()
  }

  disconnectWebSocket(): void {
    this.ws?.disconnect()
    this.ws = null
  }

  getWebSocket(): WebSocketClient | null {
    return this.ws
  }

  // ==================== Health ====================

  async getHealth(): Promise<HealthStatus> {
    return this.http.get('/api/health')
  }

  async getHealthDetailed(): Promise<HealthStatus> {
    return this.http.get('/api/health/detailed')
  }

  // ==================== Config ====================

  async getConfig(): Promise<AppConfig> {
    return this.http.get('/api/config')
  }

  async updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    return this.http.patch('/api/config', patch)
  }

  async getConfigKey<K extends keyof AppConfig>(key: K): Promise<Pick<AppConfig, K>> {
    return this.http.get(`/api/config/${key}`)
  }

  async setConfigKey<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
    await this.http.put(`/api/config/${key}`, { value })
  }

  // ==================== Conversations ====================

  async getConversations(): Promise<ConversationSummary[]> {
    return this.http.get('/api/conversations')
  }

  async getConversation(id: string): Promise<Conversation> {
    return this.http.get(`/api/conversations/${id}`)
  }

  async createConversation(message?: string): Promise<Conversation> {
    return this.http.post('/api/conversations', { message })
  }

  async updateConversation(id: string, title: string): Promise<Conversation> {
    return this.http.patch(`/api/conversations/${id}`, { title })
  }

  async deleteConversation(id: string): Promise<void> {
    await this.http.delete(`/api/conversations/${id}`)
  }

  async deleteAllConversations(): Promise<{ deleted: number }> {
    return this.http.delete('/api/conversations')
  }

  async addMessage(
    conversationId: string,
    content: string,
    role: 'user' | 'assistant' | 'tool' = 'user'
  ): Promise<ConversationMessage> {
    return this.http.post(`/api/conversations/${conversationId}/messages`, {
      content,
      role,
    })
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.http.get(`/api/conversations/${conversationId}/messages`)
  }

  // ==================== Profiles ====================

  async getProfiles(): Promise<Profile[]> {
    return this.http.get('/api/profiles')
  }

  async getProfile(id: string): Promise<Profile> {
    return this.http.get(`/api/profiles/${id}`)
  }

  async getCurrentProfile(): Promise<Profile> {
    return this.http.get('/api/profiles/current')
  }

  async createProfile(data: CreateProfileInput): Promise<Profile> {
    return this.http.post('/api/profiles', data)
  }

  async updateProfile(id: string, data: UpdateProfileInput): Promise<Profile> {
    return this.http.patch(`/api/profiles/${id}`, data)
  }

  async deleteProfile(id: string): Promise<void> {
    await this.http.delete(`/api/profiles/${id}`)
  }

  async activateProfile(id: string): Promise<Profile> {
    return this.http.post(`/api/profiles/${id}/activate`)
  }

  async deactivateProfile(): Promise<void> {
    await this.http.post('/api/profiles/deactivate')
  }

  async exportProfile(id: string): Promise<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>> {
    return this.http.get(`/api/profiles/${id}/export`)
  }

  async importProfile(data: CreateProfileInput): Promise<Profile> {
    return this.http.post('/api/profiles/import', data)
  }

  // ==================== Agent ====================

  async *processAgent(
    input: string,
    options?: AgentOptions
  ): AsyncGenerator<AgentProgress> {
    yield* this.http.stream<AgentProgress>('POST', '/api/agent/process', {
      input,
      ...options,
    })
  }

  async processAgentSync(
    input: string,
    options?: AgentOptions
  ): Promise<{ content: string; conversationId: string; sessionId: string }> {
    return this.http.post('/api/agent/process/sync', { input, ...options })
  }

  async stopAgent(sessionId: string): Promise<void> {
    await this.http.post(`/api/agent/stop/${sessionId}`)
  }

  async stopAllAgents(): Promise<{ stopped: number }> {
    return this.http.post('/api/agent/stop-all')
  }

  async getAgentSessions(): Promise<AgentSession[]> {
    return this.http.get('/api/agent/sessions')
  }

  async getActiveSessions(): Promise<AgentSession[]> {
    return this.http.get('/api/agent/sessions/active')
  }

  async getAgentSession(sessionId: string): Promise<AgentSession> {
    return this.http.get(`/api/agent/sessions/${sessionId}`)
  }

  async respondToApproval(sessionId: string, approved: boolean): Promise<void> {
    await this.http.post(`/api/agent/sessions/${sessionId}/approval`, { approved })
  }

  // ==================== MCP ====================

  async getMcpServers(): Promise<McpServer[]> {
    return this.http.get('/api/mcp/servers')
  }

  async getMcpServer(name: string): Promise<McpServer & { tools: McpTool[] }> {
    return this.http.get(`/api/mcp/servers/${name}`)
  }

  async startMcpServer(name: string, config: McpServerConfig): Promise<void> {
    await this.http.post(`/api/mcp/servers/${name}`, config)
  }

  async stopMcpServer(name: string): Promise<void> {
    await this.http.post(`/api/mcp/servers/${name}/stop`)
  }

  async restartMcpServer(name: string): Promise<void> {
    await this.http.post(`/api/mcp/servers/${name}/restart`)
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    await this.http.patch(`/api/mcp/servers/${name}`, { enabled })
  }

  async getMcpServerLogs(name: string): Promise<{ logs: string[] }> {
    return this.http.get(`/api/mcp/servers/${name}/logs`)
  }

  async getMcpTools(): Promise<McpTool[]> {
    return this.http.get('/api/mcp/tools')
  }

  async getEnabledMcpTools(): Promise<McpTool[]> {
    return this.http.get('/api/mcp/tools/enabled')
  }

  async toggleMcpTool(serverName: string, toolName: string, enabled: boolean): Promise<void> {
    await this.http.patch(`/api/mcp/tools/${serverName}/${toolName}`, { enabled })
  }

  async executeMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/mcp/tools/execute', { name, arguments: args })
  }

  async initializeMcpServers(servers: Record<string, McpServerConfig>): Promise<void> {
    await this.http.post('/api/mcp/initialize', { servers })
  }

  async shutdownMcpServers(): Promise<void> {
    await this.http.post('/api/mcp/shutdown')
  }

  // ==================== Queue ====================

  async getQueue(conversationId: string): Promise<QueuedMessage[]> {
    return this.http.get(`/api/conversations/${conversationId}/queue`)
  }

  async enqueue(conversationId: string, text: string): Promise<QueuedMessage> {
    return this.http.post(`/api/conversations/${conversationId}/queue`, { text })
  }

  async removeFromQueue(conversationId: string, messageId: string): Promise<void> {
    await this.http.delete(`/api/conversations/${conversationId}/queue/${messageId}`)
  }

  async retryQueuedMessage(conversationId: string, messageId: string): Promise<QueuedMessage> {
    return this.http.post(`/api/conversations/${conversationId}/queue/${messageId}/retry`)
  }

  async cancelPendingQueue(conversationId: string): Promise<{ cancelled: number }> {
    return this.http.post(`/api/conversations/${conversationId}/queue/cancel-pending`)
  }

  async clearQueue(conversationId: string): Promise<{ cleared: number }> {
    return this.http.delete(`/api/conversations/${conversationId}/queue`)
  }

  async getAllPendingMessages(): Promise<QueuedMessage[]> {
    return this.http.get('/api/queue/pending')
  }

  // ==================== Speech ====================

  async transcribe(
    audio: Blob | File,
    filename: string,
    options?: TranscribeOptions
  ): Promise<{ text: string }> {
    const query: Record<string, string> = {}
    if (options?.language) query.language = options.language
    if (options?.prompt) query.prompt = options.prompt
    if (options?.providerId) query.providerId = options.providerId

    const queryString = new URLSearchParams(query).toString()
    const path = queryString ? `/api/speech/transcribe?${queryString}` : '/api/speech/transcribe'

    return this.http.uploadFile(path, audio, filename)
  }

  async synthesize(text: string, options?: SpeakOptions): Promise<Blob> {
    return this.http.downloadBlob('/api/speech/synthesize', {
      text,
      ...options,
    })
  }

  async preprocessForTTS(text: string): Promise<{ original: string; processed: string }> {
    return this.http.post('/api/speech/preprocess', { text })
  }

  // ==================== Models ====================

  async getModels(providerId: 'openai' | 'groq' | 'gemini'): Promise<ModelInfo[]> {
    return this.http.get(`/api/models/${providerId}`)
  }

  async getDefaultModels(providerId: string): Promise<ModelInfo[]> {
    return this.http.get(`/api/models/${providerId}/default`)
  }

  async getAllModels(): Promise<{
    openai: ModelInfo[]
    groq: ModelInfo[]
    gemini: ModelInfo[]
  }> {
    return this.http.get('/api/models')
  }

  async getPresetModels(presetId: string): Promise<ModelInfo[]> {
    return this.http.post('/api/models/preset', { presetId })
  }

  // ==================== Diagnostics ====================

  async getDiagnosticReport(): Promise<DiagnosticReport> {
    return this.http.get('/api/diagnostics/report')
  }

  async getDiagnosticHealth(): Promise<HealthStatus> {
    return this.http.get('/api/diagnostics/health')
  }

  async getErrors(limit?: number, detailed?: boolean): Promise<unknown[]> {
    return this.http.get('/api/diagnostics/errors', { limit, detailed })
  }

  async clearErrors(): Promise<{ cleared: number }> {
    return this.http.delete('/api/diagnostics/errors')
  }

  async cleanupOldErrors(maxAgeDays?: number): Promise<{ cleared: number }> {
    return this.http.post('/api/diagnostics/errors/cleanup', { maxAgeDays })
  }

  // ==================== Real-time Subscriptions ====================

  onProgress(callback: (progress: AgentProgress) => void): Unsubscribe {
    if (!this.ws) {
      throw new Error('WebSocket not connected. Call connectWebSocket() first.')
    }
    this.ws.subscribe('agent-progress')
    return this.ws.on('agent-progress', (msg) => callback(msg as unknown as AgentProgress))
  }

  onSession(sessionId: string, callback: (progress: AgentProgress) => void): Unsubscribe {
    if (!this.ws) {
      throw new Error('WebSocket not connected. Call connectWebSocket() first.')
    }
    const channel = `session:${sessionId}`
    this.ws.subscribe(channel)
    return this.ws.on(channel, (msg) => callback(msg as unknown as AgentProgress))
  }

  onConversation(conversationId: string, callback: (progress: AgentProgress) => void): Unsubscribe {
    if (!this.ws) {
      throw new Error('WebSocket not connected. Call connectWebSocket() first.')
    }
    const channel = `conversation:${conversationId}`
    this.ws.subscribe(channel)
    return this.ws.on(channel, (msg) => callback(msg as unknown as AgentProgress))
  }

  onMcpEvent(callback: (event: { type: string; name: string; error?: string }) => void): Unsubscribe {
    if (!this.ws) {
      throw new Error('WebSocket not connected. Call connectWebSocket() first.')
    }
    this.ws.subscribe('mcp')
    return this.ws.on('mcp', (msg) => callback(msg as unknown as { type: string; name: string; error?: string }))
  }

  onApprovalRequired(callback: (data: { sessionId: string; toolName: string; toolArgs: unknown }) => void): Unsubscribe {
    if (!this.ws) {
      throw new Error('WebSocket not connected. Call connectWebSocket() first.')
    }
    this.ws.subscribe('agent-progress')
    return this.ws.on('approval_required', (msg) => {
      callback(msg as unknown as { sessionId: string; toolName: string; toolArgs: unknown })
    })
  }
}
