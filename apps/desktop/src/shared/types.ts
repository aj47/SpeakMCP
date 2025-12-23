import type { CHAT_PROVIDER_ID, STT_PROVIDER_ID, TTS_PROVIDER_ID, OPENAI_COMPATIBLE_PRESET_ID } from "."
import type { ToolCall, ToolResult } from '@speakmcp/shared'

export type { ToolCall, ToolResult, BaseChatMessage, ConversationHistoryMessage, ChatApiResponse } from '@speakmcp/shared'

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
  // Optional override for redirect URI (e.g., when the provider disallows custom schemes)
  redirectUri?: string

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

export interface ServerLogEntry {
  timestamp: number
  message: string
}

// Agent Mode Progress Tracking Types
export interface AgentProgressStep {
  id: string
  type: "thinking" | "tool_call" | "tool_result" | "completion" | "tool_approval"
  title: string
  description?: string
  status: "pending" | "in_progress" | "completed" | "error" | "awaiting_approval"
  timestamp: number
  llmContent?: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  approvalRequest?: {
    approvalId: string
    toolName: string
    arguments: any
  }
}

export interface AgentProgressUpdate {
  sessionId: string
  conversationId?: string
  conversationTitle?: string
  currentIteration: number
  maxIterations: number
  steps: AgentProgressStep[]
  isComplete: boolean
  isSnoozed?: boolean
  finalContent?: string
  conversationHistory?: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: ToolCall[]
    toolResults?: ToolResult[]
    timestamp?: number
  }>
  sessionStartIndex?: number
  pendingToolApproval?: {
    approvalId: string
    toolName: string
    arguments: any
  }
  retryInfo?: {
    isRetrying: boolean
    attempt: number
    maxAttempts?: number
    delaySeconds: number
    reason: string
    startedAt: number
  }
  streamingContent?: {
    text: string
    isStreaming: boolean
  }
  contextInfo?: {
    estTokens: number
    maxTokens: number
  }
  modelInfo?: {
    provider: string
    model: string
  }
  /** Profile name associated with this session (from profile snapshot) */
  profileName?: string
}

// Message Queue Types
export interface QueuedMessage {
  id: string
  conversationId: string
  text: string
  createdAt: number
  status: "pending" | "processing" | "cancelled" | "failed"
  errorMessage?: string
  addedToHistory?: boolean
}

export interface MessageQueue {
  conversationId: string
  messages: QueuedMessage[]
}

// Conversation Types
export interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "tool"
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
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

export type ProfileMcpServerConfig = {
  disabledServers?: string[]
  disabledTools?: string[]
  // When true, newly-added MCP servers (added after profile creation) are also disabled by default
  // This ensures strict opt-in behavior for profiles created with "all MCPs disabled"
  allServersDisabledByDefault?: boolean
  // When allServersDisabledByDefault is true, this list contains servers that are explicitly ENABLED
  // (i.e., servers the user has opted-in to use for this profile)
  enabledServers?: string[]
}

export type ProfileModelConfig = {
  // Agent/MCP Tools settings
  mcpToolsProviderId?: "openai" | "groq" | "gemini"
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  currentModelPresetId?: string
  // STT Provider settings
  sttProviderId?: "openai" | "groq"
  // Transcript Post-Processing settings
  transcriptPostProcessingProviderId?: "openai" | "groq" | "gemini"
  transcriptPostProcessingOpenaiModel?: string
  transcriptPostProcessingGroqModel?: string
  transcriptPostProcessingGeminiModel?: string
  // TTS Provider settings
  ttsProviderId?: "openai" | "groq" | "gemini"
}

// Profile Management Types
export type Profile = {
  id: string
  name: string
  guidelines: string
  createdAt: number
  updatedAt: number
  isDefault?: boolean
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
  systemPrompt?: string
}

export type ProfilesData = {
  profiles: Profile[]
  currentProfileId?: string
}

/**
 * Snapshot of profile settings captured at session creation time.
 * This ensures session isolation - changes to the global profile don't affect running sessions.
 */
export type SessionProfileSnapshot = {
  profileId: string
  profileName: string
  guidelines: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
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
}

export type Config = {
  shortcut?: "hold-ctrl" | "ctrl-slash" | "custom"
  customShortcut?: string
  customShortcutMode?: "hold" | "toggle" // Mode for custom recording shortcut
  hideDockIcon?: boolean
  launchAtLogin?: boolean

  // Onboarding Configuration
  onboardingCompleted?: boolean

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

  modelPresets?: ModelPreset[]
  currentModelPresetId?: string

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
  groqTtsVoice?: string

  // Gemini TTS Configuration
  geminiTtsModel?: "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts"
  geminiTtsVoice?: string
  geminiTtsLanguage?: string

  // TTS Text Preprocessing Configuration
  ttsPreprocessingEnabled?: boolean
  ttsRemoveCodeBlocks?: boolean
  ttsRemoveUrls?: boolean
  ttsConvertMarkdown?: boolean
  // LLM-based TTS Preprocessing (for more natural speech output)
  ttsUseLLMPreprocessing?: boolean
  ttsLLMPreprocessingProviderId?: CHAT_PROVIDER_ID

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

  // Settings Window Hotkey Configuration
  settingsHotkeyEnabled?: boolean
  settingsHotkey?: "ctrl-shift-s" | "ctrl-comma" | "ctrl-shift-comma" | "custom"
  customSettingsHotkey?: string

  // Agent Kill Switch Configuration
  agentKillSwitchEnabled?: boolean
  agentKillSwitchHotkey?:
    | "ctrl-shift-escape"
    | "ctrl-alt-q"
    | "ctrl-shift-q"
    | "custom"
  customAgentKillSwitchHotkey?: string

  // MCP Tool Calling Configuration
  /** @deprecated MCP tools are now always enabled. This field is kept for backwards compatibility but ignored. */
  mcpToolsEnabled?: boolean
  mcpToolsShortcut?: "hold-ctrl-alt" | "ctrl-alt-slash" | "custom"
  customMcpToolsShortcut?: string
  customMcpToolsShortcutMode?: "hold" | "toggle" // Mode for custom MCP tools shortcut
  mcpToolsProviderId?: CHAT_PROVIDER_ID
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpToolsSystemPrompt?: string
  mcpCustomSystemPrompt?: string
  mcpCurrentProfileId?: string
  /** @deprecated Agent mode is now always enabled. This field is kept for backwards compatibility but ignored. */
  mcpAgentModeEnabled?: boolean
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpAutoPasteEnabled?: boolean
  mcpAutoPasteDelay?: number
  mcpMaxIterations?: number

  // MCP Server Configuration
  mcpConfig?: MCPConfig

  mcpRuntimeDisabledServers?: string[]

  mcpDisabledTools?: string[]

  // UI State Persistence - Collapsed/Expanded sections in Settings
  mcpToolsCollapsedServers?: string[]  // Server names that are collapsed in the Tools section
  mcpServersCollapsedServers?: string[]  // Server names that are collapsed in the Servers section

  // Conversation Configuration
  conversationsEnabled?: boolean
  maxConversationsToKeep?: number
  autoSaveConversations?: boolean

  // Provider Section Collapse Configuration
  providerSectionCollapsedGroq?: boolean
  providerSectionCollapsedGemini?: boolean

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
  panelNormalModeSize?: { width: number; height: number }
  panelAgentModeSize?: { width: number; height: number }
  panelTextInputModeSize?: { width: number; height: number }

  // Floating Panel Auto-Show Configuration
  // When false, the floating panel will not automatically appear during agent sessions
  // Users can still manually access the panel via hotkeys, tray menu, or UI
  floatingPanelAutoShow?: boolean

  // API Retry Configuration
  apiRetryCount?: number
  apiRetryBaseDelay?: number
  apiRetryMaxDelay?: number

  // Context Reduction Configuration
  mcpContextReductionEnabled?: boolean
  mcpContextTargetRatio?: number
  mcpContextLastNMessages?: number
  mcpContextSummarizeCharThreshold?: number
  mcpMaxContextTokensOverride?: number

  // Tool Response Processing Configuration
  mcpToolResponseProcessingEnabled?: boolean
  mcpToolResponseLargeThreshold?: number
  mcpToolResponseCriticalThreshold?: number
  mcpToolResponseChunkSize?: number
  mcpToolResponseProgressUpdates?: boolean

  // Completion Verification Configuration
  mcpVerifyCompletionEnabled?: boolean
  mcpVerifyContextMaxItems?: number
  mcpVerifyRetryCount?: number

  // Final Summary Configuration
  mcpFinalSummaryEnabled?: boolean

  // Parallel Tool Execution Configuration
  mcpParallelToolExecution?: boolean

  // Message Queue Configuration - when enabled, users can queue messages while agent is processing
  mcpMessageQueueEnabled?: boolean



	  // Remote Server Configuration
	  remoteServerEnabled?: boolean
	  remoteServerPort?: number
	  remoteServerBindAddress?: "127.0.0.1" | "0.0.0.0"
	  remoteServerApiKey?: string
	  remoteServerLogLevel?: "error" | "info" | "debug"
	  remoteServerCorsOrigins?: string[]
	  remoteServerAutoShowPanel?: boolean // Auto-show floating panel when receiving remote messages

  // Stream Status Watcher Configuration
  streamStatusWatcherEnabled?: boolean
  streamStatusFilePath?: string

}


// MCP Elicitation Types (Protocol 2025-11-25)
export interface ElicitationFormField {
  type: "string" | "number" | "boolean" | "enum"
  title?: string
  description?: string
  default?: string | number | boolean
  // String-specific
  minLength?: number
  maxLength?: number
  format?: "email" | "uri" | "date" | "date-time"
  // Number-specific
  minimum?: number
  maximum?: number
  // Enum-specific
  enum?: string[]
  enumNames?: string[]
}

export interface ElicitationFormSchema {
  type: "object"
  properties: Record<string, ElicitationFormField>
  required?: string[]
}

export interface ElicitationFormRequest {
  mode: "form"
  serverName: string
  message: string
  requestedSchema: ElicitationFormSchema
  requestId: string
}

export interface ElicitationUrlRequest {
  mode: "url"
  serverName: string
  message: string
  url: string
  elicitationId: string
  requestId: string
}

export type ElicitationRequest = ElicitationFormRequest | ElicitationUrlRequest

export interface ElicitationResult {
  action: "accept" | "decline" | "cancel"
  content?: Record<string, string | number | boolean | string[]>
}

// MCP Sampling Types (Protocol 2025-11-25)
export interface SamplingMessageContent {
  type: "text" | "image" | "audio"
  text?: string
  data?: string
  mimeType?: string
}

export interface SamplingMessage {
  role: "user" | "assistant"
  content: SamplingMessageContent | SamplingMessageContent[]
}

export interface SamplingRequest {
  serverName: string
  requestId: string
  messages: SamplingMessage[]
  systemPrompt?: string
  maxTokens: number
  temperature?: number
  modelPreferences?: {
    hints?: Array<{ name?: string }>
    costPriority?: number
    speedPriority?: number
    intelligencePriority?: number
  }
}

export interface SamplingResult {
  approved: boolean
  model?: string
  content?: SamplingMessageContent
  stopReason?: string
}
