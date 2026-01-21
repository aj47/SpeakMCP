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
  ApiError
} from './types'

export class SpeakMcpClient {
  private baseUrl: string
  private apiKey: string
  
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
  
  // Models
  async getModels(): Promise<{ models: Model[] }> {
    return this.request('GET', '/v1/models')
  }
  
  // Profiles
  async getProfiles(): Promise<{ profiles: Profile[]; currentProfileId: string }> {
    return this.request('GET', '/v1/profiles')
  }
  
  async getCurrentProfile(): Promise<Profile> {
    return this.request('GET', '/v1/profiles/current')
  }
  
  async switchProfile(profileId: string): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/profiles/switch', { profileId })
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
  
  // MCP
  async getMcpServers(): Promise<{ servers: McpServer[] }> {
    return this.request('GET', '/v1/mcp/servers')
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
  
  // Chat - streaming (SSE)
  // Server sends custom format: {type: "progress"|"done"|"error", data: {...}}
  // We convert these to OpenAI-compatible chunks for the TUI
  async *chatStream(
    messages: ChatMessage[],
    conversationId?: string
  ): AsyncGenerator<ChatCompletionChunk> {
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
    let lastContent = '' // Track accumulated content for delta calculation

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
            const parsed = JSON.parse(data)

            // Handle server's custom streaming format
            if (parsed.type === 'progress') {
              // Extract content from conversationHistory (last assistant message)
              const history = parsed.data?.conversationHistory
              if (Array.isArray(history)) {
                const lastAssistant = [...history].reverse().find(
                  (m: { role: string }) => m.role === 'assistant'
                )
                if (lastAssistant?.content && lastAssistant.content !== lastContent) {
                  const delta = lastAssistant.content.slice(lastContent.length)
                  lastContent = lastAssistant.content
                  if (delta) {
                    yield this.createChunk(delta, parsed.data?.model)
                  }
                }
              }
              // Also check streamingContent for real-time streaming
              const streamingContent = parsed.data?.streamingContent
              if (streamingContent?.text && streamingContent.text !== lastContent) {
                const delta = streamingContent.text.slice(lastContent.length)
                lastContent = streamingContent.text
                if (delta) {
                  yield this.createChunk(delta, parsed.data?.model)
                }
              }
            } else if (parsed.type === 'done') {
              // Final content - emit any remaining delta
              const content = parsed.data?.content || ''
              if (content && content !== lastContent) {
                const delta = content.slice(lastContent.length)
                if (delta) {
                  yield this.createChunk(delta, parsed.data?.model)
                }
              }
              return
            } else if (parsed.type === 'error') {
              throw new Error(parsed.data?.message || 'Server streaming error')
            } else if (parsed.choices) {
              // OpenAI-compatible format (fallback)
              yield parsed as ChatCompletionChunk
            }
          } catch (e) {
            // Re-throw actual errors, skip malformed JSON
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
              throw e
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private createChunk(content: string, model?: string): ChatCompletionChunk {
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: model || 'unknown',
      choices: [{
        index: 0,
        delta: { content },
        finish_reason: null
      }]
    }
  }
  
  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      await this.getModels()
      return true
    } catch {
      return false
    }
  }
}

