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

// Agent Execution Types
export interface AgentStep {
  id: string
  type: 'llm_call' | 'tool_execution' | 'completion'
  status: 'pending' | 'running' | 'completed' | 'failed'
  timestamp: number
  description: string
  llmResponse?: string
  toolCalls?: Array<{
    name: string
    arguments: any
    result?: {
      content: Array<{ type: "text"; text: string }>
      isError?: boolean
    }
  }>
  error?: string
}

export interface AgentProgress {
  currentStep: number
  totalSteps: number
  currentStepDescription: string
  estimatedTimeRemaining?: number
}

export interface AgentExecutionState {
  id: string
  goal: string
  status: 'initializing' | 'running' | 'completed' | 'failed' | 'cancelled'
  startTime: number
  endTime?: number
  steps: AgentStep[]
  progress: AgentProgress
  conversationHistory: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    toolCalls?: any[]
    toolCallId?: string
  }>
  finalResult?: string
  error?: string
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

  // Agent Chaining Configuration
  agentChainingEnabled?: boolean
  agentChainingShortcut?: "hold-ctrl-shift" | "ctrl-shift-slash"
  agentChainingProviderId?: CHAT_PROVIDER_ID
  agentChainingOpenaiModel?: string
  agentChainingGroqModel?: string
  agentChainingGeminiModel?: string
  agentChainingSystemPrompt?: string
  agentChainingMaxSteps?: number
  agentChainingTimeoutMinutes?: number

  // MCP Server Configuration
  mcpConfig?: MCPConfig
}
