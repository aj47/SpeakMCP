/**
 * LLM Module - Unified Public API
 *
 * This module provides a clean abstraction layer for LLM interactions:
 * - Provider abstraction (OpenAI, Groq, Gemini)
 * - Retry logic with exponential backoff
 * - Structured output handling
 * - Agent utilities (context extraction, tool execution)
 *
 * Usage:
 * ```ts
 * import { createProviderFromConfig, makeLLMCallWithFetch } from "./llm"
 *
 * // Using provider directly
 * const provider = createProviderFromConfig("mcp")
 * const response = await provider.makeCall(messages)
 *
 * // Using legacy API (backwards compatible)
 * const result = await makeLLMCallWithFetch(messages)
 * ```
 */

// Re-export types
export type {
  LLMMessage,
  LLMCallOptions,
  LLMToolCallResponse,
  MCPToolCall,
  CompletionVerification,
  ModelCapabilities,
  RetryProgressCallback,
  StreamingCallback,
  ResponseFormat,
  RawLLMResponse,
} from "./types"

// Re-export retry utilities
export {
  withRetry,
  apiCallWithRetry,
  HttpError,
  isRetryableError,
  calculateBackoffDelay,
  type RetryOptions,
} from "./retry"

// Re-export provider factory and types
export {
  createProvider,
  createProviderFromConfig,
  getAvailableProviders,
  isValidProviderId,
  type ProviderId,
  type LLMProvider,
  type LLMProviderConstructorConfig,
  // Provider implementations
  OpenAIProvider,
  GroqProvider,
  GeminiProvider,
  // Utilities
  extractJsonObject,
  recordStructuredOutputFailure,
  recordStructuredOutputSuccess,
  TOOL_CALL_RESPONSE_SCHEMA,
  VERIFICATION_RESPONSE_SCHEMA,
} from "./providers"

// Re-export structured output utilities
export {
  makeStructuredToolCall,
  makeStructuredContextExtraction,
  makeTextCompletion,
  parseToolCallResponse,
  parseContextExtractionResponse,
  LLMToolCallSchema,
  ContextExtractionSchema,
  CONTEXT_EXTRACTION_SCHEMA,
  type ContextExtractionResponse,
} from "./structured-output"

// Re-export agent utilities
export {
  // Context extraction
  extractContextFromHistory,
  extractRecentContext,
  analyzeToolErrors,
  formatConversationForProgress,
  isToolCallPlaceholder,
  detectRepeatedResponse,
  type ConversationEntry,
  type ExtractedContext,
  // Tool execution
  executeToolWithRetries,
  executeToolsInParallel,
  executeToolsSequentially,
  toolRequiresSequentialExecution,
  batchRequiresSequentialExecution,
  buildToolErrorSummary,
  SEQUENTIAL_EXECUTION_TOOL_PATTERNS,
  type ToolExecutionResult,
} from "./agent"

// ============================================================================
// Legacy API - Backwards compatible exports from llm-fetch.ts
// ============================================================================

import { configStore } from "../config"
import { createProviderFromConfig } from "./providers"
import type { LLMMessage, LLMCallOptions, LLMToolCallResponse, RetryProgressCallback, StreamingCallback, CompletionVerification } from "./types"

/**
 * Main function to make LLM calls using fetch with automatic retry on empty responses
 * @deprecated Use createProviderFromConfig().makeCall() instead
 */
export async function makeLLMCallWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
  onRetryProgress?: RetryProgressCallback,
  sessionId?: string,
): Promise<LLMToolCallResponse> {
  const config = configStore.get()
  const effectiveProviderId = providerId || config.mcpToolsProviderId || "openai"

  // Create provider with the specified ID
  const provider = createProviderFromConfig("mcp")

  // Convert messages to LLMMessage format
  const llmMessages: LLMMessage[] = messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }))

  const options: LLMCallOptions = {
    useStructuredOutput: true,
    sessionId,
    onRetryProgress,
  }

  return provider.makeCall(llmMessages, options)
}

/**
 * Make a streaming LLM call
 * @deprecated Use createProviderFromConfig().makeStreamingCall() instead
 */
export async function makeLLMCallWithStreaming(
  messages: Array<{ role: string; content: string }>,
  onChunk: StreamingCallback,
  providerId?: string,
  sessionId?: string,
  externalAbortController?: AbortController,
): Promise<LLMToolCallResponse> {
  const provider = createProviderFromConfig("mcp")

  const llmMessages: LLMMessage[] = messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }))

  return provider.makeStreamingCall(llmMessages, onChunk, { sessionId })
}

/**
 * Make a simple text completion call
 * @deprecated Use createProviderFromConfig().makeTextCompletion() instead
 */
export async function makeTextCompletionWithFetch(
  prompt: string,
  providerId?: string,
  sessionId?: string,
): Promise<string> {
  const provider = createProviderFromConfig("transcript")
  return provider.makeTextCompletion(prompt, { sessionId })
}

/**
 * Verify completion using LLM
 * @deprecated Use createProviderFromConfig().verifyCompletion() instead
 */
export async function verifyCompletionWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
): Promise<CompletionVerification> {
  const provider = createProviderFromConfig("mcp")

  const llmMessages: LLMMessage[] = messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }))

  return provider.verifyCompletion(llmMessages)
}
