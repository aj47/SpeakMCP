/**
 * HTTP Client for SpeakMCP Server API
 * Handles all communication with @speakmcp/server
 */

import type {
  CliConfig,
  Model,
  Profile,
  McpServer,
  McpTool,
  Conversation,
  Settings,
  ChatMessage,
  ChatCompletionChunk,
  ChatCompletionResponse,
  ApiError,
  SSEEvent,
  AgentProgressUpdate,
  ModelPreset,
  AgentMemory,
  AgentSkill,
  OAuthInitiateResponse,
  PendingElicitation,
  PendingSampling,
  QueuedMessage,
  AgentSession,
  ACPAgent,
  ACPAgentConfig,
  ACPRunResponse,
} from './types'

export class SpeakMcpClient {
  private baseUrl: string
  private apiKey: string
  private maxRetries = 3
  private baseDelay = 1000

  constructor(config: CliConfig) {
    this.baseUrl = config.serverUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
  }
  
  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`
    }
    return h
  }
  
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as ApiError
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }
    
    return response.json() as Promise<T>
  }

  /**
   * Make a request with automatic retry and exponential backoff
   */
  private async requestWithRetry<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.request<T>(method, path, body)
      } catch (error) {
        lastError = error as Error
        if (!this.isRetryable(error) || attempt === this.maxRetries) {
          throw error
        }
        const delay = this.baseDelay * Math.pow(2, attempt)
        await new Promise(r => setTimeout(r, delay))
      }
    }
    throw lastError
  }

  /**
   * Check if an error is retryable (network errors, 5xx, 429)
   */
  private isRetryable(error: unknown): boolean {
    // Network errors (TypeError from fetch)
    if (error instanceof TypeError) return true

    if (error instanceof Error) {
      const msg = error.message
      // Server errors (5xx) and rate limiting (429) are retryable
      return msg.includes('HTTP 5') || msg.includes('HTTP 429')
    }
    return false
  }

  // Models
  async getModels(): Promise<{ models: Model[] }> {
    return this.request('GET', '/v1/models')
  }

  async getModelsForProvider(providerId: string): Promise<{
    providerId: string
    models: Array<{
      id: string
      name: string
      description?: string
      context_length?: number
    }>
  }> {
    return this.request('GET', `/v1/models/${encodeURIComponent(providerId)}`)
  }

  // Profiles
  async getProfiles(): Promise<{ profiles: Profile[]; currentProfileId: string }> {
    return this.request('GET', '/v1/profiles')
  }

  async getCurrentProfile(): Promise<Profile> {
    return this.request('GET', '/v1/profiles/current')
  }

  async switchProfile(profileId: string): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/profiles/current', { profileId })
  }

  async exportProfile(profileId: string): Promise<{ profileJson: string }> {
    return this.request('GET', `/v1/profiles/${encodeURIComponent(profileId)}/export`)
  }

  async importProfile(profileJson: string): Promise<{ success: boolean; profile: Profile }> {
    return this.request('POST', '/v1/profiles/import', { profileJson })
  }

  // Settings
  async getSettings(): Promise<Settings> {
    return this.request('GET', '/v1/settings')
  }
  
  async patchSettings(settings: Partial<Settings>): Promise<Settings> {
    return this.request('PATCH', '/v1/settings', settings)
  }
  
  // Conversations
  async getConversations(): Promise<{ conversations: Conversation[] }> {
    return this.request('GET', '/v1/conversations')
  }
  
  async getConversation(id: string): Promise<Conversation> {
    return this.request('GET', `/v1/conversations/${id}`)
  }
  
  async createConversation(data: {
    title?: string
    messages: ChatMessage[]
  }): Promise<Conversation> {
    return this.request('POST', '/v1/conversations', data)
  }

  async deleteConversation(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/v1/conversations/${id}`)
  }

  async updateConversation(id: string, data: {
    title?: string
    messages?: Array<{ role: string; content: string; timestamp?: number }>
  }): Promise<Conversation> {
    return this.request('PUT', `/v1/conversations/${id}`, data)
  }

  // Profiles CRUD
  async createProfile(name: string, guidelines: string, systemPrompt?: string): Promise<{ success: boolean; profile: Profile }> {
    return this.request('POST', '/v1/profiles', { name, guidelines, systemPrompt })
  }

  async updateProfile(id: string, updates: { name?: string; guidelines?: string; systemPrompt?: string }): Promise<{ success: boolean; profile: Profile }> {
    return this.request('PATCH', `/v1/profiles/${encodeURIComponent(id)}`, updates)
  }

  async deleteProfile(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/v1/profiles/${encodeURIComponent(id)}`)
  }

  // Tool approval
  async respondToToolApproval(approvalId: string, approved: boolean): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/tool-approval', { approvalId, approved })
  }

  // Diagnostics
  async getDiagnosticReport(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/diagnostics/report')
  }

  async getHealthCheck(): Promise<{ overall: string; checks: Record<string, unknown> }> {
    return this.request('GET', '/v1/diagnostics/health')
  }

  async getRecentErrors(count?: number): Promise<{ errors: Array<Record<string, unknown>> }> {
    const query = count ? `?count=${count}` : ''
    return this.request('GET', `/v1/diagnostics/errors${query}`)
  }

  async clearErrors(): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/diagnostics/errors/clear', {})
  }

  // Model Presets (G-08)
  async getModelPresets(): Promise<{ presets: ModelPreset[]; currentPresetId: string }> {
    return this.request('GET', '/v1/model-presets')
  }

  async createModelPreset(preset: { name: string; baseUrl: string; apiKey?: string }): Promise<{ success: boolean; preset: ModelPreset }> {
    return this.request('POST', '/v1/model-presets', preset)
  }

  async updateModelPreset(id: string, updates: Partial<ModelPreset>): Promise<{ success: boolean; preset: ModelPreset }> {
    return this.request('PATCH', `/v1/model-presets/${encodeURIComponent(id)}`, updates)
  }

  async deleteModelPreset(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/v1/model-presets/${encodeURIComponent(id)}`)
  }

  // MCP
  async getMcpServers(): Promise<{ servers: McpServer[] }> {
    return this.request('GET', '/v1/mcp/servers')
  }

  async toggleMcpServer(
    serverName: string,
    enabled: boolean
  ): Promise<{ success: boolean; server: string; enabled: boolean }> {
    return this.request('POST', `/v1/mcp/servers/${encodeURIComponent(serverName)}/toggle`, { enabled })
  }

  async listMcpTools(): Promise<{ tools: McpTool[] }> {
    return this.request('POST', '/mcp/tools/list', {})
  }

  async callMcpTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ result: unknown }> {
    return this.request('POST', '/mcp/tools/call', { name, arguments: args })
  }

  // MCP Server Management (G-17)
  async restartMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
    return this.request('POST', `/v1/mcp/servers/${encodeURIComponent(name)}/restart`)
  }

  async stopMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
    return this.request('POST', `/v1/mcp/servers/${encodeURIComponent(name)}/stop`)
  }

  async getMcpServerLogs(name: string): Promise<{ server: string; logs: string[] }> {
    return this.request('GET', `/v1/mcp/servers/${encodeURIComponent(name)}/logs`)
  }

  async clearMcpServerLogs(name: string): Promise<{ success: boolean }> {
    return this.request('POST', `/v1/mcp/servers/${encodeURIComponent(name)}/logs/clear`)
  }

  async testMcpServer(name: string): Promise<{ success: boolean; toolCount?: number; error?: string }> {
    return this.request('POST', `/v1/mcp/servers/${encodeURIComponent(name)}/test`)
  }

  // Memory (G-12)
  async getMemories(): Promise<{ memories: AgentMemory[] }> {
    return this.request('GET', '/v1/memories')
  }

  async createMemory(memory: { title: string; content: string; tags?: string[]; importance?: string }): Promise<{ success: boolean; memory: AgentMemory }> {
    return this.request('POST', '/v1/memories', memory)
  }

  async updateMemory(id: string, updates: Partial<AgentMemory>): Promise<{ success: boolean; memory: AgentMemory }> {
    return this.request('PATCH', `/v1/memories/${encodeURIComponent(id)}`, updates)
  }

  async deleteMemory(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/v1/memories/${encodeURIComponent(id)}`)
  }

  async searchMemories(query: string): Promise<{ memories: AgentMemory[] }> {
    return this.request('GET', `/v1/memories/search?q=${encodeURIComponent(query)}`)
  }

  // Skills (G-13)
  async getSkills(): Promise<{ skills: AgentSkill[] }> {
    return this.request('GET', '/v1/skills')
  }

  async createSkill(skill: { name: string; description: string; instructions: string }): Promise<{ success: boolean; skill: AgentSkill }> {
    return this.request('POST', '/v1/skills', skill)
  }

  async updateSkill(id: string, updates: Partial<AgentSkill>): Promise<{ success: boolean; skill: AgentSkill }> {
    return this.request('PATCH', `/v1/skills/${encodeURIComponent(id)}`, updates)
  }

  async deleteSkill(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/v1/skills/${encodeURIComponent(id)}`)
  }

  async toggleSkill(id: string, enabled: boolean): Promise<{ success: boolean }> {
    return this.request('POST', `/v1/skills/${encodeURIComponent(id)}/toggle`, { enabled })
  }

  // Emergency stop
  async emergencyStop(): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/emergency-stop', {})
  }
  
  // Chat - non-streaming
  async chat(
    messages: ChatMessage[],
    conversationId?: string
  ): Promise<ChatCompletionResponse> {
    return this.request('POST', '/v1/chat/completions', {
      messages,
      stream: false,
      conversation_id: conversationId
    })
  }
  
  // Chat - streaming (SSE) - yields typed SSEEvent objects
  async *chatStream(
    messages: ChatMessage[],
    conversationId?: string
  ): AsyncGenerator<SSEEvent> {
    const url = `${this.baseUrl}/v1/chat/completions`

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        messages,
        stream: true,
        conversation_id: conversationId
      })
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as ApiError
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    if (!response.body) {
      throw new Error('No response body for streaming')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') return

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>

            // Handle typed events from the server
            if (parsed.type === 'error') {
              const errorData = parsed.data as { message: string }
              throw new Error(errorData?.message || 'Unknown streaming error')
            }

            if (parsed.type === 'progress') {
              yield {
                type: 'progress',
                data: parsed.data as AgentProgressUpdate
              }
              continue
            }

            if (parsed.type === 'done') {
              yield {
                type: 'done',
                data: parsed.data as SSEEvent extends { type: 'done'; data: infer D } ? D : never
              }
              return
            }

            // Handle OpenAI-compatible chunks with choices[].delta.content
            if (parsed.choices && Array.isArray(parsed.choices)) {
              yield {
                type: 'chunk',
                data: parsed as unknown as ChatCompletionChunk
              }
              continue
            }

            // Unknown event type - skip
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unknown streaming error') {
              // Re-throw actual errors from type: 'error' events
              if (e.message.includes('streaming error') || !data.startsWith('{')) {
                throw e
              }
            }
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
  
  // Health check - uses retry logic for resilience
  async isHealthy(): Promise<boolean> {
    try {
      await this.requestWithRetry('GET', '/v1/models')
      return true
    } catch {
      return false
    }
  }

  /**
   * Check health with a callback for state transitions
   * @returns Connection state: 'online', 'reconnecting', or 'offline'
   */
  async checkHealthWithState(
    onReconnecting?: () => void
  ): Promise<'online' | 'reconnecting' | 'offline'> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.request('GET', '/v1/models')
        return 'online'
      } catch (error) {
        lastError = error as Error

        if (!this.isRetryable(error) || attempt === this.maxRetries) {
          return 'offline'
        }

        // Notify that we're reconnecting
        if (attempt === 0 && onReconnecting) {
          onReconnecting()
        }

        const delay = this.baseDelay * Math.pow(2, attempt)
        await new Promise(r => setTimeout(r, delay))
      }
    }

    return lastError ? 'offline' : 'online'
  }

  // ====================================================================
  // G-22: OAuth Flow
  // ====================================================================

  async initiateOAuth(serverName: string): Promise<OAuthInitiateResponse> {
    return this.request('POST', '/v1/oauth/initiate', { serverName })
  }

  async handleOAuthCallback(
    serverName: string,
    code: string,
    state: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.request('POST', '/v1/oauth/callback', { serverName, code, state })
  }

  // ====================================================================
  // G-23: MCP Protocol Extensions — Elicitation
  // ====================================================================

  async getPendingElicitations(): Promise<{ pending: PendingElicitation[] }> {
    return this.request('GET', '/v1/elicitation/pending')
  }

  async resolveElicitation(
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, unknown>
  ): Promise<{ success: boolean }> {
    return this.request('POST', `/v1/elicitation/${requestId}/resolve`, { action, content })
  }

  // ====================================================================
  // G-23: MCP Protocol Extensions — Sampling
  // ====================================================================

  async getPendingSamplingRequests(): Promise<{ pending: PendingSampling[] }> {
    return this.request('GET', '/v1/sampling/pending')
  }

  async resolveSampling(
    requestId: string,
    approved: boolean
  ): Promise<{ success: boolean }> {
    return this.request('POST', `/v1/sampling/${requestId}/resolve`, { approved })
  }

  // ====================================================================
  // G-18: Message Queue
  // ====================================================================

  async getMessageQueue(): Promise<{ messages: QueuedMessage[] }> {
    return this.request('GET', '/v1/queue')
  }

  async enqueueMessage(
    content: string,
    conversationId?: string
  ): Promise<{ success: boolean; message: QueuedMessage }> {
    return this.request('POST', '/v1/queue', { content, conversationId })
  }

  async removeQueuedMessage(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/v1/queue/${id}`)
  }

  async dequeueMessage(): Promise<{ message: QueuedMessage | null }> {
    return this.request('POST', '/v1/queue/dequeue')
  }

  async clearMessageQueue(): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/queue/clear')
  }

  // ====================================================================
  // G-24: Agent Sessions
  // ====================================================================

  async getAgentSessions(): Promise<{ sessions: AgentSession[]; activeCount: number }> {
    return this.request('GET', '/v1/agent-sessions')
  }

  async getAgentSession(sessionId: string): Promise<AgentSession> {
    return this.request('GET', `/v1/agent-sessions/${sessionId}`)
  }

  async stopAgentSession(sessionId: string): Promise<{ success: boolean }> {
    return this.request('POST', `/v1/agent-sessions/${sessionId}/stop`)
  }

  async stopAllAgentSessions(): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/agent-sessions/stop-all')
  }

  // ====================================================================
  // G-19: ACP Agent Delegation
  // ====================================================================

  async getACPAgents(): Promise<{ agents: ACPAgent[] }> {
    return this.request('GET', '/v1/acp/agents')
  }

  async getACPAgentStatus(agentName: string): Promise<{ status: string; error?: string }> {
    return this.request('GET', `/v1/acp/agents/${agentName}`)
  }

  async addACPAgent(config: ACPAgentConfig): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/acp/agents', config)
  }

  async updateACPAgent(agentName: string, updates: Partial<ACPAgentConfig>): Promise<{ success: boolean }> {
    return this.request('PATCH', `/v1/acp/agents/${agentName}`, updates)
  }

  async removeACPAgent(agentName: string): Promise<{ success: boolean }> {
    return this.request('POST', `/v1/acp/agents/${agentName}/remove`)
  }

  async spawnACPAgent(agentName: string): Promise<{ success: boolean }> {
    return this.request('POST', `/v1/acp/agents/${agentName}/spawn`)
  }

  async stopACPAgent(agentName: string): Promise<{ success: boolean }> {
    return this.request('POST', `/v1/acp/agents/${agentName}/stop`)
  }

  async stopAllACPAgents(): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/acp/agents/stop-all')
  }

  async runACPTask(agentName: string, input: string): Promise<ACPRunResponse> {
    return this.request('POST', `/v1/acp/agents/${agentName}/run`, { input })
  }
}

