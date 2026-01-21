/**
 * Type definitions for SpeakMCP CLI
 */

// Configuration
export interface CliConfig {
  serverUrl: string
  apiKey: string
  conversationId?: string
  theme: 'dark' | 'light'
  embedded?: boolean
  serverOnly?: boolean
  port?: number
  debug?: boolean
}

// API Response Types
export interface Model {
  id: string
  name: string
  provider: string
}

export interface Profile {
  id: string
  name: string
  description?: string
  mcpServers?: Record<string, McpServerConfig>
  userGuidelines?: string
}

export interface McpServerConfig {
  command?: string
  args?: string[]
  url?: string
  transport?: 'stdio' | 'sse' | 'streamableHttp'
  enabled?: boolean
}

export interface McpServer {
  name: string
  status: 'connected' | 'disconnected' | 'error'
  transport: string
  toolCount: number
  error?: string
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  serverName: string
}

export interface Conversation {
  id: string
  title?: string
  messages: ConversationMessage[]
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  timestamp?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface Settings {
  mcpToolsProviderId?: string
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpMaxIterations?: number
  mcpToolsDelay?: number
  [key: string]: unknown
}

// Chat types
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatCompletionRequest {
  messages: ChatMessage[]
  stream?: boolean
  conversation_id?: string
  model?: string
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    delta: {
      role?: string
      content?: string
    }
    finish_reason?: string | null
  }[]
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }[]
  conversation_id?: string
}

// API client types
export interface ApiError {
  error: string
  message?: string
  statusCode?: number
}

// View state
export type ViewName = 'chat' | 'sessions' | 'settings' | 'tools'

export interface AppState {
  currentView: ViewName
  currentProfile?: Profile
  currentConversationId?: string
  isConnected: boolean
  isProcessing: boolean
}

