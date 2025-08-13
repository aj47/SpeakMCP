import type { CHAT_PROVIDER_ID, STT_PROVIDER_ID } from "."

export type RecordingHistoryItem = {
  id: string
  createdAt: number
  duration: number
  transcript: string
}

// Multimodal Content Types
export interface ImageContent {
  type: "image"
  data: string // base64 encoded image data
  mimeType: string // e.g., "image/jpeg", "image/png"
  source: "screenshot" | "clipboard"
}

export interface TextContent {
  type: "text"
  text: string
}

export type MultimodalContent = TextContent | ImageContent

export interface MultimodalMessage {
  role: "user" | "assistant" | "system" | "tool"
  content: string | MultimodalContent[]
  toolCalls?: Array<{ name: string; arguments: any }>
  toolResults?: Array<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>
}

// MCP Server Configuration Types
export type MCPTransportType = "stdio" | "websocket" | "streamableHttp"

export interface MCPServerConfig {
  // Transport configuration
  transport?: MCPTransportType // defaults to "stdio" for backward compatibility

  // For stdio transport (local command-based servers)
  command?: string
  args?: string[]
  env?: Record<string, string>

  // For remote transports (websocket/streamableHttp)
  url?: string

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

  // Visual Context Configuration
  visualContextEnabled?: boolean
  screenshotEnabled?: boolean
  clipboardImageEnabled?: boolean
  screenshotShortcut?: "ctrl-shift-s" | "custom"
  customScreenshotShortcut?: string
  screenshotQuality?: number // 0.1 to 1.0 for JPEG compression
  maxImageSize?: number // Maximum image dimension in pixels
}
