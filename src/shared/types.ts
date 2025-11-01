import type { CHAT_PROVIDER_ID, STT_PROVIDER_ID, TTS_PROVIDER_ID, OPENAI_COMPATIBLE_PRESET_ID } from "."

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

// Server log entry interface
export interface ServerLogEntry {
  timestamp: number
  message: string
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
  conversationId?: string // Add conversation ID to the progress update
  conversationHistory?: Array<{
    role: "user" | "assistant" | "tool"
    content: MessageContent
    toolCalls?: Array<{ name: string; arguments: any }>
    toolResults?: Array<{ success: boolean; content: string; error?: string }>
    timestamp?: number
  }>
}

// Multimodal Content Types
export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }

export type MessageContent = string | MessageContentPart[]

// Conversation Types
export interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "tool"
  content: MessageContent
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

// Profile Management Types
export type Profile = {
  id: string
  name: string
  guidelines: string
  createdAt: number
  updatedAt: number
  isDefault?: boolean
}

export type ProfilesData = {
  profiles: Profile[]
  currentProfileId?: string
}

export type Config = {
  shortcut?: "hold-ctrl" | "ctrl-slash" | "custom"
  customShortcut?: string
  customShortcutMode?: "hold" | "toggle" // Mode for custom recording shortcut
  hideDockIcon?: boolean
  launchAtLogin?: boolean


  // Toggle Voice Dictation Configuration
  toggleVoiceDictationEnabled?: boolean
  toggleVoiceDictationHotkey?: "fn" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "custom"
  customToggleVoiceDictationHotkey?: string

  // Theme Configuration
  themePreference?: "system" | "light" | "dark"

  sttProviderId?: STT_PROVIDER_ID

  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiCompatiblePreset?: OPENAI_COMPATIBLE_PRESET_ID

  groqApiKey?: string
  groqBaseUrl?: string
  groqSttPrompt?: string

  geminiApiKey?: string
  geminiBaseUrl?: string

  // Speech-to-Text Language Configuration
  sttLanguage?: string
  openaiSttLanguage?: string
  groqSttLanguage?: string

  // Text-to-Speech Configuration
  ttsEnabled?: boolean
  ttsAutoPlay?: boolean
  ttsProviderId?: TTS_PROVIDER_ID

  // OpenAI TTS Configuration
  openaiTtsModel?: "tts-1" | "tts-1-hd"
  openaiTtsVoice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"
  openaiTtsSpeed?: number // 0.25 to 4.0
  openaiTtsResponseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm"

  // Groq TTS Configuration
  groqTtsModel?: "playai-tts" | "playai-tts-arabic"
  groqTtsVoice?: string // Will be populated with available voices

  // Gemini TTS Configuration
  geminiTtsModel?: "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts"
  geminiTtsVoice?: string // Will be populated with available voices
  geminiTtsLanguage?: string // Language code for TTS

  // TTS Text Preprocessing Configuration
  ttsPreprocessingEnabled?: boolean
  ttsRemoveCodeBlocks?: boolean
  ttsRemoveUrls?: boolean
  ttsConvertMarkdown?: boolean

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
  customMcpToolsShortcutMode?: "hold" | "toggle" // Mode for custom MCP tools shortcut
  mcpToolsProviderId?: CHAT_PROVIDER_ID
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpToolsSystemPrompt?: string
  mcpCurrentProfileId?: string // Current active profile ID
  mcpAgentModeEnabled?: boolean
  // When enabled, require manual user approval before each tool call executes
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpAutoPasteEnabled?: boolean
  mcpAutoPasteDelay?: number
  mcpMaxIterations?: number

  // MCP Server Configuration
  mcpConfig?: MCPConfig

  // Persisted MCP runtime state: servers the user explicitly stopped (do not auto-start)
  mcpRuntimeDisabledServers?: string[]

  // Persisted MCP tool state: tools the user explicitly disabled
  mcpDisabledTools?: string[]

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
  // Mode-specific panel sizes for persistence
  panelNormalModeSize?: { width: number; height: number }
  panelAgentModeSize?: { width: number; height: number }
  panelTextInputModeSize?: { width: number; height: number }

  // API Retry Configuration
  apiRetryCount?: number // Number of retry attempts (default: 3)
  apiRetryBaseDelay?: number // Base delay in milliseconds (default: 1000)
  apiRetryMaxDelay?: number // Maximum delay in milliseconds (default: 30000)

  // Context Reduction Configuration
  mcpContextReductionEnabled?: boolean
  mcpContextTargetRatio?: number
  mcpContextLastNMessages?: number
  mcpContextSummarizeCharThreshold?: number
  mcpMaxContextTokensOverride?: number

  // Completion Verification Configuration
  mcpVerifyCompletionEnabled?: boolean
  mcpVerifyContextMaxItems?: number
  mcpVerifyRetryCount?: number



	  // Remote Server Configuration
	  remoteServerEnabled?: boolean
	  remoteServerPort?: number
	  remoteServerBindAddress?: "127.0.0.1" | "0.0.0.0"
	  remoteServerApiKey?: string
	  remoteServerLogLevel?: "error" | "info" | "debug"
	  remoteServerCorsOrigins?: string[]

  // Stream Status Watcher Configuration
  streamStatusWatcherEnabled?: boolean
  streamStatusFilePath?: string

  // Screenshot Configuration
  screenshotEnabled?: boolean
  screenshotQuality?: number // 0.0 to 1.0 for JPEG quality
  screenshotFormat?: "png" | "jpeg"
  screenshotMaxWidth?: number // Max width for resizing
  screenshotMaxHeight?: number // Max height for resizing

}
