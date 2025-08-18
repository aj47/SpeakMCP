import type { CHAT_PROVIDER_ID, STT_PROVIDER_ID } from "."

export type RecordingHistoryItem = {
  id: string
  createdAt: number
  duration: number
  transcript: string
}

// MCP Server Configuration Types
export type MCPTransportType = "stdio" | "websocket" | "streamableHttp"

// OAuth 2.1 Configuration Types
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
  expires_at?: number // Calculated expiration timestamp
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

export interface OAuthConfig {
  // Server metadata (discovered or manually configured)
  serverMetadata?: OAuthServerMetadata

  // Client registration info (from dynamic registration or manual config)
  clientId?: string
  clientSecret?: string
  clientMetadata?: OAuthClientMetadata

  // Stored tokens
  tokens?: OAuthTokens

  // Configuration options
  scope?: string
  useDiscovery?: boolean // Whether to use .well-known/oauth-authorization-server
  useDynamicRegistration?: boolean // Whether to use RFC7591 dynamic client registration

  // Pending authorization state (used during OAuth flow)
  pendingAuth?: {
    codeVerifier: string
    state: string
  }
}

export interface MCPServerConfig {
  // Transport configuration
  transport?: MCPTransportType // defaults to "stdio" for backward compatibility

  // For stdio transport (local command-based servers)
  command?: string
  args?: string[]
  env?: Record<string, string>

  // For remote transports (websocket/streamableHttp)
  url?: string

  // Custom HTTP headers for streamableHttp transport
  headers?: Record<string, string>

  // OAuth configuration for protected servers
  oauth?: OAuthConfig

  // Common configuration
  timeout?: number
  disabled?: boolean
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

// Agent Mode Progress Tracking Types
export interface AgentProgressStep {
  id: string
  type: "thinking" | "tool_call" | "tool_result" | "completion"
  title: string
  description?: string
  status: "pending" | "in_progress" | "completed" | "error"
  timestamp: number
  llmContent?: string // Store actual LLM response content for thinking steps
  toolCall?: {
    name: string
    arguments: any
  }
  toolResult?: {
    success: boolean
    content: string
    error?: string
  }
}

export interface AgentProgressUpdate {
  currentIteration: number
  maxIterations: number
  steps: AgentProgressStep[]
  isComplete: boolean
  finalContent?: string
  conversationHistory?: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: Array<{ name: string; arguments: any }>
    toolResults?: Array<{ success: boolean; content: string; error?: string }>
    timestamp?: number
  }>
}

// Conversation Types
export interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "tool"
  content: string
  timestamp: number
  toolCalls?: Array<{
    name: string
    arguments: any
  }>
  toolResults?: Array<{
    success: boolean
    content: string
    error?: string
  }>
}

export interface ConversationMetadata {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  lastMessage?: string
  tags?: string[]
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
  metadata?: {
    totalTokens?: number
    model?: string
    provider?: string
    agentMode?: boolean
  }
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

export type Config = {
  shortcut?: "hold-ctrl" | "ctrl-slash" | "custom"
  customShortcut?: string
  hideDockIcon?: boolean

  // Theme Configuration
  themePreference?: "system" | "light" | "dark"

  sttProviderId?: STT_PROVIDER_ID

  openaiApiKey?: string
  openaiBaseUrl?: string

  groqApiKey?: string
  groqBaseUrl?: string
  groqSttPrompt?: string

  geminiApiKey?: string
  geminiBaseUrl?: string

  // Speech-to-Text Language Configuration
  sttLanguage?: string
  openaiSttLanguage?: string
  groqSttLanguage?: string

  transcriptPostProcessingEnabled?: boolean
  transcriptPostProcessingProviderId?: CHAT_PROVIDER_ID
  transcriptPostProcessingPrompt?: string
  transcriptPostProcessingOpenaiModel?: string
  transcriptPostProcessingGroqModel?: string
  transcriptPostProcessingGeminiModel?: string

  // Text Input Configuration
  textInputEnabled?: boolean
  textInputShortcut?: "ctrl-t" | "ctrl-shift-t" | "alt-t" | "custom"
  customTextInputShortcut?: string

  // Agent Kill Switch Configuration
  agentKillSwitchEnabled?: boolean
  agentKillSwitchHotkey?:
    | "ctrl-shift-escape"
    | "ctrl-alt-q"
    | "ctrl-shift-q"
    | "custom"
  customAgentKillSwitchHotkey?: string

  // MCP Tool Calling Configuration
  mcpToolsEnabled?: boolean
  mcpToolsShortcut?: "hold-ctrl-alt" | "ctrl-alt-slash" | "custom"
  customMcpToolsShortcut?: string
  mcpToolsProviderId?: CHAT_PROVIDER_ID
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpToolsSystemPrompt?: string
  mcpAgentModeEnabled?: boolean
  // When enabled, require manual user approval before each tool call executes
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpAutoPasteEnabled?: boolean
  mcpAutoPasteDelay?: number
  mcpMaxIterations?: number

  // MCP Toggle Shortcuts
  mcpToggleShortcut?: "ctrl-shift-m" | "ctrl-alt-t" | "custom" | "disabled"
  customMcpToggleShortcut?: string

  // MCP Server Configuration
  mcpConfig?: MCPConfig

  // Persisted MCP runtime state: servers the user explicitly stopped (do not auto-start)
  mcpRuntimeDisabledServers?: string[]

  // Conversation Configuration
  conversationsEnabled?: boolean
  maxConversationsToKeep?: number
  autoSaveConversations?: boolean

  // Panel Position Configuration
  panelPosition?:
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right"
    | "custom"
  panelCustomPosition?: { x: number; y: number }
  panelDragEnabled?: boolean
  panelCustomSize?: { width: number; height: number }
}
