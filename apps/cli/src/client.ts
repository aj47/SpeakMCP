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
            const chunk = JSON.parse(data) as ChatCompletionChunk
            yield chunk
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock()
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

