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

  // MCP Tool Calling Configuration
  mcpToolsEnabled?: boolean
  mcpToolsShortcut?: "hold-ctrl-alt" | "ctrl-alt-slash"
  mcpToolsProviderId?: CHAT_PROVIDER_ID
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpToolsSystemPrompt?: string
  mcpAgentModeEnabled?: boolean

  // MCP Server Configuration
  mcpConfig?: MCPConfig
}
