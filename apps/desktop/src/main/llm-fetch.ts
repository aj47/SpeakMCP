/**
 * LLM Fetch Module - Vercel AI SDK Implementation
 *
 * This module provides LLM functionality using Vercel AI SDK for:
 * - Tool calling with automatic structured output
 * - Streaming responses
 * - Provider flexibility (OpenAI, Groq, Gemini, Anthropic)
 * - Automatic retry with exponential backoff
 *
 * Migrated from custom fetch-based implementation to use @ai-sdk packages.
 */

import { generateText, streamText, tool as aiTool } from "ai"
import { jsonSchema } from "ai"
import {
  createLanguageModel,
  getCurrentProviderId,
  getTranscriptProviderId,
  type ProviderType,
} from "./ai-sdk-provider"
import { configStore } from "./config"
import type { LLMToolCallResponse, MCPTool } from "./mcp-service"
import { diagnosticsService } from "./diagnostics"
import { isDebugLLM, logLLM } from "./debug"
import { state, agentSessionStateManager, llmRequestAbortManager } from "./state"

/**
 * Sanitize tool name for provider compatibility.
 * Some providers (OpenAI, Groq) reject tool names containing ':'.
 * MCP tool names often include server prefixes like "server:tool_name".
 * We replace ':' with '__COLON__' to avoid collisions with tool names that
 * legitimately contain '__' (double underscore).
 */
function sanitizeToolName(name: string): string {
  return name.replace(/:/g, "__COLON__")
}

/**
 * Restore original tool name from sanitized version using the provided map.
 * Falls back to simple replacement if no map is provided (for JSON response parsing).
 */
function restoreToolName(sanitizedName: string, toolNameMap?: Map<string, string>): string {
  // If we have a map, use it for exact lookup (preferred method)
  if (toolNameMap && toolNameMap.has(sanitizedName)) {
    return toolNameMap.get(sanitizedName)!
  }
  // Fallback: reverse the sanitization for JSON responses where we don't have the map
  return sanitizedName.replace(/__COLON__/g, ":")
}

/**
 * Result of converting MCP tools to AI SDK format
 */
interface ConvertedTools {
  tools: Record<string, ReturnType<typeof aiTool>>
  /** Map from sanitized name back to original MCP tool name */
  nameMap: Map<string, string>
}

/**
 * Convert MCP tools to AI SDK tool format
 * Uses dynamicTool pattern since MCP tool schemas are JSON Schema, not Zod
 * Returns both the tools and a map for restoring original names
 */
function convertMCPToolsToAISDKTools(mcpTools: MCPTool[]): ConvertedTools {
  const tools: Record<string, ReturnType<typeof aiTool>> = {}
  const nameMap = new Map<string, string>()

  for (const mcpTool of mcpTools) {
    // Sanitize tool name to avoid provider compatibility issues
    // (OpenAI/Groq reject tool names containing ':')
    const sanitizedName = sanitizeToolName(mcpTool.name)

    // Check for collision (two different tool names sanitizing to the same key)
    if (nameMap.has(sanitizedName) && nameMap.get(sanitizedName) !== mcpTool.name) {
      logLLM(`⚠️ Tool name collision detected: "${mcpTool.name}" and "${nameMap.get(sanitizedName)}" both sanitize to "${sanitizedName}"`)
    }

    // Store the mapping from sanitized name to original name
    nameMap.set(sanitizedName, mcpTool.name)

    // Create AI SDK tool with JSON schema (not Zod)
    tools[sanitizedName] = aiTool({
      description: mcpTool.description || `Tool: ${mcpTool.name}`,
      inputSchema: jsonSchema(mcpTool.inputSchema || { type: "object", properties: {} }),
      // No execute function - we handle execution separately via MCP
    })
  }

  return { tools, nameMap }
}

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

export type CompletionVerification = {
  isComplete: boolean
  confidence?: number
  missingItems?: string[]
  reason?: string
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000
): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt)
  const cappedDelay = Math.min(exponentialDelay, maxDelay)
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1)
  return Math.max(0, cappedDelay + jitter)
}

/**
 * Check if an error is retryable.
 * Uses AI SDK structured error fields (statusCode, isRetryable) when available,
 * with fallback to message-based detection for consistency across providers.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Abort errors should never be retried
    if (
      error.name === "AbortError" ||
      error.message.toLowerCase().includes("abort")
    ) {
      return false
    }

    // Check for AI SDK structured error fields (AI_APICallError, etc.)
    // These errors have statusCode and isRetryable properties
    const errorWithStatus = error as { statusCode?: number; isRetryable?: boolean; status?: number }
    
    // If the error has an explicit isRetryable flag, use it
    if (typeof errorWithStatus.isRetryable === "boolean") {
      return errorWithStatus.isRetryable
    }
    
    // Check for statusCode or status field (AI SDK errors use statusCode)
    const statusCode = errorWithStatus.statusCode ?? errorWithStatus.status
    if (typeof statusCode === "number") {
      // Rate limits (429) are always retryable
      if (statusCode === 429) {
        return true
      }
      // Server errors (5xx) are retryable
      if (statusCode >= 500 && statusCode < 600) {
        return true
      }
      // Timeout errors
      if (statusCode === 408 || statusCode === 504) {
        return true
      }
      // Client errors (4xx except 429, 408) are not retryable
      if (statusCode >= 400 && statusCode < 500) {
        return false
      }
    }

    // Fallback: message-based detection for errors without structured fields
    const message = error.message.toLowerCase()
    return (
      message.includes("rate limit") ||
      message.includes("429") ||
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504") ||
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("connection") ||
      message.includes("empty response") ||
      message.includes("empty content")
    )
  }
  return false
}

/**
 * Execute an async function with retry logic
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    baseDelay?: number
    maxDelay?: number
    onRetryProgress?: RetryProgressCallback
    sessionId?: string
  } = {}
): Promise<T> {
  const config = configStore.get()
  const maxRetries = options.maxRetries ?? config.apiRetryCount ?? 3
  const baseDelay = options.baseDelay ?? config.apiRetryBaseDelay ?? 1000
  const maxDelay = options.maxDelay ?? config.apiRetryMaxDelay ?? 30000

  let lastError: unknown
  let attempt = 0

  const clearRetryStatus = () => {
    if (options.onRetryProgress) {
      options.onRetryProgress({
        isRetrying: false,
        attempt: 0,
        delaySeconds: 0,
        reason: "",
        startedAt: 0,
      })
    }
  }

  while (true) {
    // Check for emergency stop
    if (state.shouldStopAgent) {
      clearRetryStatus()
      throw lastError instanceof Error
        ? lastError
        : new Error("Aborted by emergency stop")
    }

    // Check for session-specific stop
    if (
      options.sessionId &&
      agentSessionStateManager.shouldStopSession(options.sessionId)
    ) {
      clearRetryStatus()
      throw new Error("Session stopped by kill switch")
    }

    try {
      const result = await fn()
      clearRetryStatus()
      return result
    } catch (error) {
      lastError = error

      // Don't retry aborts
      if ((error as any)?.name === "AbortError" || state.shouldStopAgent) {
        clearRetryStatus()
        throw error
      }

      // Check if retryable
      if (!isRetryableError(error)) {
        diagnosticsService.logError(
          "llm-fetch",
          "Non-retryable API error",
          error
        )
        clearRetryStatus()
        throw error
      }

      // Check for rate limit (429) using structured error fields when available
      let isRateLimit = false
      if (error instanceof Error) {
        // Check for AI SDK structured error fields (AI_APICallError, etc.)
        const errorWithStatus = error as { statusCode?: number; status?: number }
        const statusCode = errorWithStatus.statusCode ?? errorWithStatus.status
        
        if (typeof statusCode === "number" && statusCode === 429) {
          isRateLimit = true
        } else {
          // Fallback to message-based detection for errors without structured fields
          const message = error.message.toLowerCase()
          isRateLimit = message.includes("429") || message.includes("rate limit")
        }
      }

      // Rate limits retry indefinitely, other errors respect the limit
      if (!isRateLimit && attempt >= maxRetries) {
        diagnosticsService.logError(
          "llm-fetch",
          "API call failed after all retries",
          { attempts: attempt + 1, error }
        )
        clearRetryStatus()
        throw lastError
      }

      const delay = calculateBackoffDelay(attempt, baseDelay, maxDelay)
      const waitTimeSeconds = Math.round(delay / 1000)

      logLLM(
        `⏳ ${isRateLimit ? "Rate limit" : "Error"} - waiting ${waitTimeSeconds}s before retry (attempt ${attempt + 1})`
      )

      if (options.onRetryProgress) {
        options.onRetryProgress({
          isRetrying: true,
          attempt: attempt + 1,
          maxAttempts: isRateLimit ? undefined : maxRetries + 1,
          delaySeconds: waitTimeSeconds,
          reason: isRateLimit ? "Rate limit exceeded" : "Request failed",
          startedAt: Date.now(),
        })
      }

      // Wait before retry
      if (state.shouldStopAgent) {
        clearRetryStatus()
        throw new Error("Aborted by emergency stop")
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
      attempt++
    }
  }
}

/**
 * Convert messages to AI SDK format, extracting system messages separately
 * This is needed for compatibility with Anthropic/Claude APIs which expect
 * system prompts as a separate parameter, not in the messages array
 */
function convertMessages(messages: Array<{ role: string; content: string }>): {
  system: string | undefined
  messages: Array<{ role: "user" | "assistant"; content: string }>
} {
  const systemMessages: string[] = []
  const otherMessages: Array<{ role: "user" | "assistant"; content: string }> =
    []

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(msg.content)
    } else {
      otherMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })
    }
  }

  return {
    system: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined,
    messages: otherMessages,
  }
}

/**
 * Create and register an abort controller for session management
 */
function createSessionAbortController(sessionId?: string): AbortController {
  const controller = new AbortController()
  if (sessionId) {
    agentSessionStateManager.registerAbortController(sessionId, controller)
  } else {
    llmRequestAbortManager.register(controller)
  }
  return controller
}

/**
 * Unregister an abort controller from session management
 */
function unregisterSessionAbortController(controller: AbortController, sessionId?: string): void {
  if (sessionId) {
    agentSessionStateManager.unregisterAbortController(sessionId, controller)
  } else {
    llmRequestAbortManager.unregister(controller)
  }
}

/**
 * Extract JSON object from a string response
 */
function extractJsonObject(str: string): any | null {
  let braceCount = 0
  let startIndex = -1

  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    if (char === "{") {
      if (braceCount === 0) startIndex = i
      braceCount++
    } else if (char === "}") {
      braceCount--
      if (braceCount === 0 && startIndex !== -1) {
        const jsonStr = str.substring(startIndex, i + 1)
        try {
          return JSON.parse(jsonStr)
        } catch {
          startIndex = -1
        }
      }
    }
  }
  return null
}

/**
 * Main function to make LLM calls using AI SDK with automatic retry
 * Now supports native AI SDK tool calling when tools are provided
 */
export async function makeLLMCallWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
  onRetryProgress?: RetryProgressCallback,
  sessionId?: string,
  tools?: MCPTool[]
): Promise<LLMToolCallResponse> {
  const effectiveProviderId = (providerId ||
    getCurrentProviderId()) as ProviderType

  return withRetry(
    async () => {
      const model = createLanguageModel(effectiveProviderId)
      const { system, messages: convertedMessages } = convertMessages(messages)
      const abortController = createSessionAbortController(sessionId)

      try {
        // Check for stop signal before starting
        if (
          state.shouldStopAgent ||
          (sessionId && agentSessionStateManager.shouldStopSession(sessionId))
        ) {
          abortController.abort()
        }

        // Convert MCP tools to AI SDK format if provided
        const convertedTools = tools && tools.length > 0
          ? convertMCPToolsToAISDKTools(tools)
          : undefined

        if (isDebugLLM()) {
          logLLM("🚀 AI SDK generateText call", {
            provider: effectiveProviderId,
            messagesCount: messages.length,
            hasSystem: !!system,
            hasTools: !!convertedTools,
            toolCount: tools?.length || 0,
          })
        }

        const result = await generateText({
          model,
          system,
          messages: convertedMessages,
          abortSignal: abortController.signal,
          tools: convertedTools?.tools,
          // Allow the model to choose whether to use tools or respond with text
          toolChoice: convertedTools?.tools ? "auto" : undefined,
        })

        const text = result.text?.trim() || ""

        // Check for native AI SDK tool calls first
        if (result.toolCalls && result.toolCalls.length > 0) {
          if (isDebugLLM()) {
            logLLM("✅ AI SDK native tool calls received", {
              toolCallCount: result.toolCalls.length,
              toolNames: result.toolCalls.map(tc => tc.toolName),
              textContent: text.substring(0, 100),
            })
          }

          // Convert AI SDK tool calls to our MCPToolCall format
          // Restore original tool names using the nameMap for accurate lookup
          const toolCalls = result.toolCalls.map(tc => ({
            name: restoreToolName(tc.toolName, convertedTools?.nameMap),
            arguments: tc.input,
          }))

          return {
            content: text || undefined,
            toolCalls,
            needsMoreWork: true, // Tool calls always need more work
          }
        }

        // No tool calls - process as text response
        if (!text && !result.toolCalls?.length) {
          throw new Error("LLM returned empty response")
        }

        if (isDebugLLM()) {
          logLLM("✅ AI SDK text response received", {
            textLength: text.length,
            textPreview: text.substring(0, 200),
          })
        }

        // Try to parse JSON from the response (fallback for models that respond with JSON)
        const jsonObject = extractJsonObject(text)
        if (jsonObject && (jsonObject.toolCalls || jsonObject.content)) {
          const response = jsonObject as LLMToolCallResponse
          if (response.needsMoreWork === undefined && !response.toolCalls) {
            response.needsMoreWork = true
          }
          // Restore original tool names using nameMap if available, otherwise fallback to pattern replacement
          if (response.toolCalls) {
            response.toolCalls = response.toolCalls.map(tc => ({
              ...tc,
              name: restoreToolName(tc.name, convertedTools?.nameMap),
            }))
          }
          return response
        }

        // Check for tool markers in plain text response
        const hasToolMarkers =
          /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i.test(text)
        const cleaned = text.replace(/<\|[^|]*\|>/g, "").trim()

        if (hasToolMarkers) {
          return { content: cleaned, needsMoreWork: true }
        }

        // Return as plain text with needsMoreWork undefined
        // This allows the agent loop to decide whether to continue or nudge for proper format
        // (see llm.ts handling around issue #443)
        return {
          content: cleaned || text,
          needsMoreWork: undefined,
        }
      } finally {
        unregisterSessionAbortController(abortController, sessionId)
      }
    },
    { onRetryProgress, sessionId }
  )
}

/**
 * Make a streaming LLM call using AI SDK
 */
export async function makeLLMCallWithStreaming(
  messages: Array<{ role: string; content: string }>,
  onChunk: StreamingCallback,
  providerId?: string,
  sessionId?: string,
  externalAbortController?: AbortController
): Promise<LLMToolCallResponse> {
  const effectiveProviderId = (providerId ||
    getCurrentProviderId()) as ProviderType
  const model = createLanguageModel(effectiveProviderId)
  const { system, messages: convertedMessages } = convertMessages(messages)

  // Use external controller if provided, otherwise create and register one
  // This ensures stopSession() / emergency stop can abort in-flight streams
  const abortController = externalAbortController || createSessionAbortController(sessionId)
  const isInternalController = !externalAbortController

  try {
    if (isDebugLLM()) {
      logLLM("🚀 AI SDK streamText call", {
        provider: effectiveProviderId,
        messagesCount: messages.length,
        hasSystem: !!system,
      })
    }

    const result = streamText({
      model,
      system,
      messages: convertedMessages,
      abortSignal: abortController.signal,
    })

    let accumulated = ""

    for await (const chunk of result.textStream) {
      accumulated += chunk
      onChunk(chunk, accumulated)

      // Check for stop signal
      if (
        state.shouldStopAgent ||
        (sessionId && agentSessionStateManager.shouldStopSession(sessionId))
      ) {
        abortController.abort()
        break
      }
    }

    return {
      content: accumulated,
      needsMoreWork: undefined,
      toolCalls: undefined,
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw error
    }
    diagnosticsService.logError("llm-fetch", "Streaming LLM call failed", error)
    throw error
  } finally {
    // Only unregister if we created the controller internally
    if (isInternalController) {
      unregisterSessionAbortController(abortController, sessionId)
    }
  }
}

/**
 * Make a simple text completion call using AI SDK
 * Used for transcript post-processing and similar text completion tasks.
 * Includes automatic retry with exponential backoff for transient failures.
 */
export async function makeTextCompletionWithFetch(
  prompt: string,
  providerId?: string,
  sessionId?: string,
  onRetryProgress?: RetryProgressCallback
): Promise<string> {
  // Use transcript provider as default since this is primarily used for transcript post-processing
  const effectiveProviderId = (providerId ||
    getTranscriptProviderId()) as ProviderType

  return withRetry(
    async () => {
      const abortController = createSessionAbortController(sessionId)

      try {
        // Check for stop signal before starting
        if (
          state.shouldStopAgent ||
          (sessionId && agentSessionStateManager.shouldStopSession(sessionId))
        ) {
          abortController.abort()
        }

        const model = createLanguageModel(effectiveProviderId, "transcript")

        if (isDebugLLM()) {
          logLLM("🚀 AI SDK text completion call", {
            provider: effectiveProviderId,
            promptLength: prompt.length,
          })
        }

        const result = await generateText({
          model,
          prompt,
          abortSignal: abortController.signal,
        })

        return result.text?.trim() || ""
      } catch (error) {
        diagnosticsService.logError("llm-fetch", "Text completion failed", error)
        throw error
      } finally {
        unregisterSessionAbortController(abortController, sessionId)
      }
    },
    { onRetryProgress, sessionId }
  )
}

/**
 * Verify completion using AI SDK
 * Includes automatic retry with exponential backoff for transient failures.
 */
export async function verifyCompletionWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
  sessionId?: string,
  onRetryProgress?: RetryProgressCallback
): Promise<CompletionVerification> {
  const effectiveProviderId = (providerId ||
    getCurrentProviderId()) as ProviderType

  return withRetry(
    async () => {
      const abortController = createSessionAbortController(sessionId)

      try {
        // Check for stop signal before starting
        if (
          state.shouldStopAgent ||
          (sessionId && agentSessionStateManager.shouldStopSession(sessionId))
        ) {
          abortController.abort()
        }

        const model = createLanguageModel(effectiveProviderId)
        const { system, messages: convertedMessages } = convertMessages(messages)

        if (isDebugLLM()) {
          logLLM("🚀 AI SDK verification call", {
            provider: effectiveProviderId,
            messagesCount: messages.length,
            hasSystem: !!system,
          })
        }

        const result = await generateText({
          model,
          system,
          messages: convertedMessages,
          abortSignal: abortController.signal,
        })

        const text = result.text?.trim() || ""
        const jsonObject = extractJsonObject(text)

        if (jsonObject && typeof jsonObject.isComplete === "boolean") {
          return jsonObject as CompletionVerification
        }

        // Conservative default
        return { isComplete: false, reason: "Failed to parse verification response" }
      } catch (error) {
        diagnosticsService.logError("llm-fetch", "Verification call failed", error)
        return {
          isComplete: false,
          reason: (error as any)?.message || "Verification failed",
        }
      } finally {
        unregisterSessionAbortController(abortController, sessionId)
      }
    },
    { onRetryProgress, sessionId }
  )
}
