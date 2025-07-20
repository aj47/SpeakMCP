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

// Agent Chain Types
export interface AgentChainStep {
  id: string
  timestamp: number
  type: 'llm_decision' | 'tool_execution' | 'analysis' | 'completion' | 'error'
  description: string
  toolCall?: {
    name: string
    arguments: any
  }
  result?: {
    content: string
    isError?: boolean
  }
  llmResponse?: {
    content?: string
    reasoning?: string
  }
}

export interface AgentChainExecution {
  id: string
  goal: string
  startTime: number
  endTime?: number
  status: 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
  steps: AgentChainStep[]
  currentStep?: string
  totalSteps: number
  maxIterations: number
  timeoutMs: number
}

export interface AgentChainConfig {
  enabled: boolean
  maxIterations: number
  timeoutMs: number
  systemPrompt: string
  enableProgressTracking: boolean
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

  // MCP Server Configuration
  mcpConfig?: MCPConfig

  // Agent Chain Configuration
  agentChainConfig?: AgentChainConfig
}
