/**
 * Server-specific types for @speakmcp/server
 */

// Import types from shared package for use in this file
import type {
  ToolCall,
  ToolResult,
  BaseChatMessage,
  ConversationHistoryMessage,
  ChatApiResponse,
  QueuedMessage,
  MessageQueue,
} from '@speakmcp/shared'

// Re-export types from shared package
export type {
  ToolCall,
  ToolResult,
  BaseChatMessage,
  ConversationHistoryMessage,
  ChatApiResponse,
  QueuedMessage,
  MessageQueue,
}

// Server configuration types
export interface ServerConfig {
  port: number
  bindAddress: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  authToken?: string
  corsOrigins?: string[]
}

export interface ServerStatus {
  running: boolean
  url?: string
  bind: string
  port: number
  error?: string
}

// MCP types
export type MCPTransportType = 'stdio' | 'websocket' | 'streamableHttp'

export interface MCPServerConfig {
  transport?: MCPTransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  timeout?: number
  disabled?: boolean
  oauth?: OAuthConfig
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

// OAuth types
export interface OAuthConfig {
  serverMetadata?: OAuthServerMetadata
  clientId?: string
  clientSecret?: string
  clientMetadata?: OAuthClientMetadata
  tokens?: OAuthTokens
  scope?: string
  useDiscovery?: boolean
  useDynamicRegistration?: boolean
  redirectUri?: string
  pendingAuth?: {
    codeVerifier: string
    state: string
  }
}

export interface OAuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  jwks_uri?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  grant_types_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  code_challenge_methods_supported?: string[]
}

export interface OAuthClientMetadata {
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  scope?: string
  token_endpoint_auth_method?: string
}

export interface OAuthTokens {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  expires_at?: number
}

// MCP Tool types
export interface MCPTool {
  name: string
  description: string
  inputSchema: any
}

export interface MCPToolCall {
  name: string
  arguments: any
}

export interface MCPToolResult {
  content: Array<{
    type: 'text'
    text: string
  }>
  isError?: boolean
}

export interface LLMToolCallResponse {
  content?: string
  toolCalls?: MCPToolCall[]
  needsMoreWork?: boolean
}

// Server log types
export interface ServerLogEntry {
  timestamp: number
  message: string
}

// Conversation types
export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
  metadata?: Record<string, unknown>
}

export interface ConversationHistoryItem {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  lastMessage: string
  preview: string
}

// Profile types
export interface ProfileMcpServerConfig {
  disabledServers?: string[]
  disabledTools?: string[]
  allServersDisabledByDefault?: boolean
  enabledServers?: string[]
}

export interface ProfileModelConfig {
  mcpToolsProviderId?: string
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  currentModelPresetId?: string
}

export interface ProfileSkillsConfig {
  enabledSkills?: string[]
  disabledSkills?: string[]
}

export interface Profile {
  id: string
  name: string
  isDefault?: boolean
  guidelines?: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
  skillsConfig?: ProfileSkillsConfig
  createdAt: number
  updatedAt: number
}

export interface ProfilesData {
  profiles: Profile[]
  currentProfileId?: string
}

// Agent progress types
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
  acpProgress?: ACPDelegationProgress
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
    toolCalls?: any[]
    toolResults?: any[]
  }>
  pendingToolApproval?: {
    approvalId: string
    toolName: string
    arguments: any
  }
}

// ACP types
export interface ACPDelegationProgress {
  runId: string
  agentName: string
  task: string
  status: 'pending' | 'spawning' | 'running' | 'completed' | 'failed' | 'cancelled'
  progressMessage?: string
  startTime: number
  endTime?: number
}

// Session types
export interface SessionProfileSnapshot {
  profileId: string
  profileName: string
  guidelines?: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
  skillsConfig?: ProfileSkillsConfig
}

// Memory types
export interface AgentMemory {
  id: string
  content: string
  category: string
  importance: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
  updatedAt: number
  sessionId?: string
  conversationId?: string
}
