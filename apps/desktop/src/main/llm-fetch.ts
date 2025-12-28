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

import { generateText, streamText } from "ai"
import {
  createLanguageModel,
  getCurrentProviderId,
  type ProviderType,
} from "./ai-sdk-provider"
import { configStore } from "./config"
import type { LLMToolCallResponse } from "./mcp-service"
import { diagnosticsService } from "./diagnostics"
import { isDebugLLM, logLLM } from "./debug"
import { state, agentSessionStateManager, llmRequestAbortManager } from "./state"

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
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    if (
      error.name === "AbortError" ||
      error.message.toLowerCase().includes("abort")
    ) {
      return false
    }
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

      // Check for rate limit (429)
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") ||
          error.message.toLowerCase().includes("rate limit"))

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
 * Convert messages to AI SDK format
 */
function convertMessages(
  messages: Array<{ role: string; content: string }>
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  return messages.map((msg) => ({
    role: msg.role as "user" | "assistant" | "system",
    content: msg.content,
  }))
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
 */
export async function makeLLMCallWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
  onRetryProgress?: RetryProgressCallback,
  sessionId?: string
): Promise<LLMToolCallResponse> {
  const effectiveProviderId = (providerId ||
    getCurrentProviderId()) as ProviderType

  return withRetry(
    async () => {
      const model = createLanguageModel(effectiveProviderId)
      const convertedMessages = convertMessages(messages)
      const abortController = createSessionAbortController(sessionId)

      try {
        // Check for stop signal before starting
        if (
          state.shouldStopAgent ||
          (sessionId && agentSessionStateManager.shouldStopSession(sessionId))
        ) {
          abortController.abort()
        }

        if (isDebugLLM()) {
          logLLM("🚀 AI SDK generateText call", {
            provider: effectiveProviderId,
            messagesCount: messages.length,
          })
        }

        const result = await generateText({
          model,
          messages: convertedMessages,
          abortSignal: abortController.signal,
        })

        const text = result.text?.trim() || ""

        if (!text) {
          throw new Error("LLM returned empty response")
        }

        if (isDebugLLM()) {
          logLLM("✅ AI SDK response received", {
            textLength: text.length,
            textPreview: text.substring(0, 200),
          })
        }

        // Try to parse JSON from the response
        const jsonObject = extractJsonObject(text)
        if (jsonObject && (jsonObject.toolCalls || jsonObject.content)) {
          const response = jsonObject as LLMToolCallResponse
          if (response.needsMoreWork === undefined && !response.toolCalls) {
            response.needsMoreWork = true
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

        // Return as plain text
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
  const convertedMessages = convertMessages(messages)

  const abortController = externalAbortController || new AbortController()

  try {
    if (isDebugLLM()) {
      logLLM("🚀 AI SDK streamText call", {
        provider: effectiveProviderId,
        messagesCount: messages.length,
      })
    }

    const result = streamText({
      model,
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
  }
}

/**
 * Make a simple text completion call using AI SDK
 */
export async function makeTextCompletionWithFetch(
  prompt: string,
  providerId?: string,
  sessionId?: string
): Promise<string> {
  const effectiveProviderId = (providerId ||
    getCurrentProviderId()) as ProviderType
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
}

/**
 * Verify completion using AI SDK
 */
export async function verifyCompletionWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
  sessionId?: string
): Promise<CompletionVerification> {
  const effectiveProviderId = (providerId ||
    getCurrentProviderId()) as ProviderType
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
    const convertedMessages = convertMessages(messages)

    if (isDebugLLM()) {
      logLLM("🚀 AI SDK verification call", {
        provider: effectiveProviderId,
        messagesCount: messages.length,
      })
    }

    const result = await generateText({
      model,
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
}
