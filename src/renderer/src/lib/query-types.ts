// Type definitions for React Query results and API responses

// Define the structure for MCP server status
export interface McpServerStatus {
  [serverName: string]: {
    connected: boolean
    toolCount: number
    error?: string
    runtimeEnabled?: boolean
    configDisabled?: boolean
  }
}

// Define the structure for initialization status
export interface InitializationStatus {
  isInitializing: boolean
  progress: {
    current: number
    total: number
    currentServer?: string
  }
}

// Define the structure for tools
export interface DetailedTool {
  name: string
  description: string
  parameters: any
  enabled: boolean
}

// Define the structure for config
export interface Config {
  hideDockIcon?: boolean
  themePreference?: string
  shortcut?: string
  customShortcut?: string
  textInputEnabled?: boolean
  textInputShortcut?: string
  customTextInputShortcut?: string
  groqSttPrompt?: string
  transcriptPostProcessingEnabled?: boolean
  transcriptPostProcessingPrompt?: string
  panelPosition?: string
  panelDragEnabled?: boolean
  mcpToolsEnabled?: boolean
  mcpToolsShortcut?: string
  customMcpToolsShortcut?: string
  mcpToolsSystemPrompt?: string
  mcpAgentModeEnabled?: boolean
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpMaxIterations?: number
  agentKillSwitchEnabled?: boolean
  agentKillSwitchHotkey?: string
  customAgentKillSwitchHotkey?: string
  mcpAutoPasteEnabled?: boolean
  mcpAutoPasteDelay?: number
  mcpToolsProviderId?: string
  sttProviderId?: string
  transcriptPostProcessingProviderId?: string
  openaiApiKey?: string
  openaiBaseUrl?: string
  mcpToolsOpenaiModel?: string
  transcriptPostProcessingOpenaiModel?: string
  groqApiKey?: string
  groqBaseUrl?: string
  mcpToolsGroqModel?: string
  transcriptPostProcessingGroqModel?: string
  geminiApiKey?: string
  geminiBaseUrl?: string
  mcpToolsGeminiModel?: string
  transcriptPostProcessingGeminiModel?: string
}

// Define the structure for conversation
export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: any[]
}

// Define the structure for conversation history item
export interface ConversationHistoryItem {
  id: string
  title: string
  updatedAt: string
  messages: any[]
}

// Safe type casting utilities
export const safeCast = {
  string: (value: any, fallback = ''): string => 
    typeof value === 'string' ? value : fallback,
  
  number: (value: any, fallback = 0): number => 
    typeof value === 'number' ? value : fallback,
  
  boolean: (value: any, fallback = false): boolean => 
    typeof value === 'boolean' ? value : fallback,
  
  array: <T>(value: any, fallback: T[] = []): T[] => 
    Array.isArray(value) ? (value as T[]) : fallback,
  
  object: <T extends Record<string, unknown>>(
    value: any,
    defaultValue: T,
  ): T => 
    typeof value === 'object' && value !== null ? (value as T) : defaultValue,
}
