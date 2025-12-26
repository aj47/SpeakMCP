/**
 * Shared types for MCP service modules
 */

export interface MCPTool {
  name: string
  description: string
  inputSchema: any
}

export interface MCPToolCall {
  name: string
  arguments: any
}

export interface MCPToolResult {
  content: Array<{
    type: "text"
    text: string
  }>
  isError?: boolean
}

export interface LLMToolCallResponse {
  content?: string
  toolCalls?: MCPToolCall[]
  needsMoreWork?: boolean
}
