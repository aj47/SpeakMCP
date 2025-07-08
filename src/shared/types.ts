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

// Authentication Types
export interface User {
  id: string
  email: string
  name?: string
  avatar_url?: string
  created_at: number
  updated_at: number
}

export interface AuthState {
  user: User | null
  token: string | null
}

export type Config = {
  shortcut?: "hold-ctrl" | "ctrl-slash"
  hideDockIcon?: boolean

  // STT Configuration (simplified for proxy usage)
  groqSttPrompt?: string

  // Transcript Post-Processing Configuration (simplified for proxy usage)
  transcriptPostProcessingEnabled?: boolean
  transcriptPostProcessingPrompt?: string

  // MCP Tool Calling Configuration (simplified for proxy usage)
  mcpToolsEnabled?: boolean
  mcpToolsShortcut?: "hold-ctrl-alt" | "ctrl-alt-slash"
  mcpToolsSystemPrompt?: string

  // MCP Server Configuration
  mcpConfig?: MCPConfig

  // Authentication
  authToken?: string
  user?: User
}
