// Configuration
export interface ClientConfig {
  baseUrl: string
  apiKey?: string
  timeout?: number
  onAuthError?: () => void
  onError?: (error: Error) => void
}

// Conversations
export interface ConversationSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface Conversation extends Omit<ConversationSummary, 'messageCount'> {
  messages: ConversationMessage[]
}

export interface ToolCall {
  name: string
  arguments: unknown
}

export interface ToolResult {
  success: boolean
  content: string
  error?: string
}

// Profiles
export interface Profile {
  id: string
  name: string
  guidelines: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpConfig
  modelConfig?: ProfileModelConfig
  createdAt: number
  updatedAt: number
}

export interface ProfileMcpConfig {
  disabledServers?: string[]
  disabledTools?: string[]
}

export interface ProfileModelConfig {
  providerId?: 'openai' | 'groq' | 'gemini'
  modelId?: string
  customPresetId?: string
}

export interface CreateProfileInput {
  name: string
  guidelines?: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpConfig
  modelConfig?: ProfileModelConfig
}

export interface UpdateProfileInput {
  name?: string
  guidelines?: string
  systemPrompt?: string | null
  mcpServerConfig?: ProfileMcpConfig | null
  modelConfig?: ProfileModelConfig | null
}

// Agent
export interface AgentOptions {
  conversationId?: string
  profileId?: string
  maxIterations?: number
  requireToolApproval?: boolean
}

export type AgentProgressType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'response'
  | 'stream'
  | 'error'
  | 'done'
  | 'approval_required'

export interface AgentProgress {
  type: AgentProgressType
  sessionId: string
  conversationId?: string
  iteration?: number
  message?: string
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
  content?: string
  error?: string
  delta?: string
}

export interface AgentSession {
  id: string
  conversationId: string
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'error'
  iteration: number
  maxIterations: number
  startedAt: number
  error?: string
}

// MCP
export interface McpServer {
  name: string
  status: 'stopped' | 'starting' | 'running' | 'error'
  toolCount: number
  enabled: boolean
  error?: string
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: unknown
  serverName: string
  enabled: boolean
}

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  transport?: 'stdio' | 'sse' | 'http'
  disabled?: boolean
}

// Queue
export interface QueuedMessage {
  id: string
  conversationId: string
  text: string
  status: 'pending' | 'processing' | 'cancelled' | 'failed'
  errorMessage?: string
  addedToHistory: boolean
  createdAt: number
}

// Config
export interface AppConfig {
  openaiApiKey?: string
  openaiBaseUrl?: string
  groqApiKey?: string
  groqBaseUrl?: string
  geminiApiKey?: string
  geminiBaseUrl?: string
  sttProviderId?: 'openai' | 'groq'
  sttLanguage?: string
  ttsEnabled?: boolean
  ttsProviderId?: 'openai' | 'groq' | 'gemini'
  ttsVoice?: string
  ttsModel?: string
  mcpToolsProviderId?: 'openai' | 'groq' | 'gemini'
  mcpToolsModelId?: string
  mcpMaxIterations?: number
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpMessageQueueEnabled?: boolean
}

// Health
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: number
  checks: {
    database: boolean
    mcpServers: boolean
    apiKeys: boolean
  }
}

// Diagnostics
export interface DiagnosticReport {
  timestamp: number
  system: {
    platform: string
    arch: string
    nodeVersion: string
    uptime: number
    memory: { total: number; free: number; used: number }
  }
  server: { port: number; host: string }
  mcp: { servers: McpServer[]; totalTools: number; enabledTools: number }
  sessions: { total: number; active: number; completed: number; error: number }
}

// Models
export interface ModelInfo {
  id: string
  name: string
  providerId: string
}

// Speech
export interface TranscribeOptions {
  language?: string
  prompt?: string
  providerId?: 'openai' | 'groq'
}

export interface SpeakOptions {
  voice?: string
  model?: string
  providerId?: 'openai' | 'groq' | 'gemini'
  speed?: number
  preprocess?: boolean
}

// WebSocket
export interface WebSocketMessage {
  type: string
  channel?: string
  timestamp?: number
  [key: string]: unknown
}

export type Unsubscribe = () => void

