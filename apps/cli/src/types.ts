/**
 * Type definitions for SpeakMCP CLI
 */

// Configuration
export interface CliConfig {
  serverUrl: string
  apiKey: string
  conversationId?: string
  theme: 'dark' | 'light'
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

// Agent progress types (matches server's AgentProgressUpdate)
export interface AgentProgressStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result' | 'completion' | 'error' | 'retry' | 'context_reduction' | 'tool_processing' | 'verification' | 'streaming' | 'acp_delegation'
  title: string
  description?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  timestamp: number
  toolName?: string
  toolInput?: unknown
  toolOutput?: string
  isError?: boolean
  retryCount?: number
  retryReason?: string
  streamContent?: string
}

export interface AgentProgressUpdate {
  sessionId: string
  conversationId?: string
  conversationTitle?: string
  currentIteration: number
  maxIterations: number
  steps: AgentProgressStep[]
  isComplete?: boolean
  finalContent?: string
  conversationHistory?: Array<{
    role: 'user' | 'assistant' | 'tool'
    content: string
    toolCalls?: unknown[]
    toolResults?: unknown[]
  }>
  pendingToolApproval?: {
    approvalId: string
    toolName: string
    arguments: unknown
  }
}

// SSE Event types for streaming chat
export interface SSEProgressEvent {
  type: 'progress'
  data: AgentProgressUpdate
}

export interface SSEDoneEvent {
  type: 'done'
  data: {
    content: string
    conversation_id?: string
    conversation_history?: Array<{
      role: 'user' | 'assistant' | 'tool'
      content: string
      toolCalls?: unknown[]
      toolResults?: unknown[]
      timestamp?: number
    }>
    model?: string
  }
}

export interface SSEErrorEvent {
  type: 'error'
  data: {
    message: string
  }
}

export interface SSEChunkEvent {
  type: 'chunk'
  data: ChatCompletionChunk
}

export type SSEEvent = SSEProgressEvent | SSEDoneEvent | SSEErrorEvent | SSEChunkEvent

// View state
export type ViewName = 'chat' | 'sessions' | 'settings' | 'tools'

export interface AppState {
  currentView: ViewName
  currentProfile?: Profile
  currentConversationId?: string
  isConnected: boolean
  isProcessing: boolean
}

