import type { CHAT_PROVIDER_ID, STT_PROVIDER_ID } from "."

export type RecordingHistoryItem = {
  id: string
  createdAt: number
  duration: number
  transcript: string
}

// MCP Server Configuration Types
export interface MCPServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
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
  shortcut?: "hold-ctrl" | "ctrl-slash"
  hideDockIcon?: boolean

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
  textInputShortcut?: "ctrl-t" | "ctrl-shift-t" | "alt-t"

  // MCP Tool Calling Configuration
  mcpToolsEnabled?: boolean
  mcpToolsShortcut?: "hold-ctrl-alt" | "ctrl-alt-slash"
  mcpToolsProviderId?: CHAT_PROVIDER_ID
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpToolsSystemPrompt?: string
  mcpAgentModeEnabled?: boolean
  mcpAutoPasteEnabled?: boolean
  mcpAutoPasteDelay?: number

  // MCP Server Configuration
  mcpConfig?: MCPConfig

  // Conversation Configuration
  conversationsEnabled?: boolean
  maxConversationsToKeep?: number
  autoSaveConversations?: boolean
}
