/**
 * LLM-specific types for the provider abstraction layer
 */

import type { LLMToolCallResponse, MCPToolCall } from "../mcp-service"

/**
 * Callback for reporting retry progress to the UI
 */
export type RetryProgressCallback = (info: {
  isRetrying: boolean
  attempt: number
  maxAttempts?: number // undefined for rate limits (infinite retries)
  delaySeconds: number
  reason: string
  startedAt: number
}) => void

/**
 * Callback for streaming content updates
 */
export type StreamingCallback = (chunk: string, accumulated: string) => void

/**
 * Result of completion verification
 */
export interface CompletionVerification {
  isComplete: boolean
  confidence?: number
  missingItems?: string[]
  reason?: string
}

/**
 * Options for making an LLM call
 */
export interface LLMCallOptions {
  /** Use structured output (JSON schema) if available */
  useStructuredOutput?: boolean
  /** Session ID for abort controller registration */
  sessionId?: string
  /** Callback for retry progress reporting */
  onRetryProgress?: RetryProgressCallback
  /** Callback for streaming content updates */
  onStreamingUpdate?: StreamingCallback
}

/**
 * Model capability information learned at runtime
 */
export interface ModelCapabilities {
  supportsJsonSchema: boolean
  supportsJsonObject: boolean
  lastTested: number
}

/**
 * LLM message format
 */
export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

/**
 * Configuration options for LLM providers
 */
export interface LLMProviderConfig {
  apiKey: string
  baseUrl?: string
  model: string
  temperature?: number
  seed?: number
}

/**
 * Response format types
 */
export type ResponseFormatType = "json_schema" | "json_object" | "text"

/**
 * JSON schema for structured output
 */
export interface JsonSchemaFormat {
  type: "json_schema"
  json_schema: {
    name: string
    description?: string
    schema: Record<string, unknown>
    strict?: boolean
  }
}

/**
 * JSON object response format
 */
export interface JsonObjectFormat {
  type: "json_object"
}

/**
 * Text response format (default)
 */
export interface TextFormat {
  type: "text"
}

export type ResponseFormat = JsonSchemaFormat | JsonObjectFormat | TextFormat

/**
 * Raw API response from LLM providers (OpenAI-compatible format)
 */
export interface RawLLMResponse {
  id?: string
  object?: string
  created?: number
  model?: string
  choices: Array<{
    index?: number
    message: {
      role: string
      content: string | null
      tool_calls?: Array<{
        id: string
        type: string
        function: {
          name: string
          arguments: string
        }
      }>
      reasoning?: string | { text: string }
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  error?: {
    message: string
    type?: string
    code?: string
    failed_generation?: string
  }
}

/**
 * Re-export types from mcp-service for convenience
 */
export type { LLMToolCallResponse, MCPToolCall }
