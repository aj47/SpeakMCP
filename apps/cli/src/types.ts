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
  isActive?: boolean
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
  ttsEnabled?: boolean
  mcpRequireApprovalBeforeToolCall?: boolean
  transcriptPostProcessingEnabled?: boolean
  openaiApiKey?: string
  groqApiKey?: string
  geminiApiKey?: string
  currentModelPresetId?: string
  [key: string]: unknown
}

export interface ModelPreset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  isBuiltIn?: boolean
  createdAt?: number
  updatedAt?: number
  mcpToolsModel?: string
  transcriptProcessingModel?: string
  summarizationModel?: string
}

export interface AgentMemory {
  id: string
  title: string
  content: string
  category?: string
  tags: string[]
  importance: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
  updatedAt: number
  profileId?: string
  sessionId?: string
  conversationId?: string
  conversationTitle?: string
  keyFindings?: string[]
  userNotes?: string
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  instructions: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  source?: 'local' | 'imported'
  filePath?: string
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

// OAuth types (G-22)
export interface OAuthInitiateResponse {
  authorizationUrl: string
  state: string
  codeVerifier: string
}

// Elicitation types (G-23)
export interface PendingElicitation {
  requestId: string
  request: {
    mode: 'form' | 'url'
    serverName: string
    message?: string
    requestedSchema?: unknown
    url?: string
    requestId: string
  }
}

// Sampling types (G-23)
export interface PendingSampling {
  requestId: string
  request: {
    serverName: string
    requestId: string
    messages: unknown[]
    systemPrompt?: string
    maxTokens?: number
  }
}

// Message queue types (G-18)
export interface QueuedMessage {
  id: string
  content: string
  conversationId?: string
  createdAt: number
  status: 'queued' | 'processing' | 'completed' | 'failed'
  error?: string
}

// Agent session types (G-24)
export interface AgentSession {
  sessionId: string
  shouldStop: boolean
  iterationCount: number
}

// ACP Agent types (G-19)
export interface ACPAgentConfig {
  name: string
  displayName: string
  description?: string
  autoSpawn?: boolean
  enabled?: boolean
  isInternal?: boolean
  connection: {
    type: 'stdio' | 'remote' | 'internal'
    command?: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    url?: string
  }
}

export type ACPAgentStatus = 'stopped' | 'starting' | 'ready' | 'error'

export interface ACPAgent {
  config: ACPAgentConfig
  status: ACPAgentStatus
  error?: string
}

export interface ACPRunResponse {
  success: boolean
  result?: string
  error?: string
}

// View state
export type ViewName = 'chat' | 'sessions' | 'settings' | 'tools'

// Connection state for status indicator
export type ConnectionState = 'online' | 'reconnecting' | 'offline'

export interface AppState {
  currentView: ViewName
  currentProfile?: Profile
  currentConversationId?: string
  connectionState: ConnectionState
  isProcessing: boolean
}

