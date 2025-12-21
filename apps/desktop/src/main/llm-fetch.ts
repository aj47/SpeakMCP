import { configStore } from "./config"
import { LLMToolCallResponse } from "./mcp-service"
import { normalizeResponse } from "./structured-output"
import { diagnosticsService } from "./diagnostics"
import { isDebugLLM, logLLM } from "./debug"
import { state, llmRequestAbortManager, agentSessionStateManager } from "./state"
import OpenAI from "openai"

/**
 * Callback for reporting retry progress to the UI
 */
export type RetryProgressCallback = (info: {
  isRetrying: boolean
  attempt: number
  maxAttempts?: number  // undefined for rate limits (infinite retries)
  delaySeconds: number
  reason: string
  startedAt: number
}) => void

// Define the JSON schema for structured output
const toolCallResponseSchema: OpenAI.ResponseFormatJSONSchema["json_schema"] = {
  name: "LLMToolCallResponse",
  description:
    "Response format for LLM tool calls with optional tool execution and content",
  schema: {
    type: "object",
    properties: {
      toolCalls: {
        type: "array",
        description: "Array of tool calls to execute",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the tool to call",
            },
            arguments: {
              type: "object",
              description: "Arguments to pass to the tool",
              properties: {},
              additionalProperties: true,
            },
          },
          required: ["name", "arguments"],
          additionalProperties: false,
        },
      },
      content: {
        type: "string",
        description: "Text content of the response",
      },
      needsMoreWork: {
        type: "boolean",
        description: "Whether more work is needed (deprecated, use status)",
      },
      status: {
        type: "string",
        enum: ["working", "complete", "blocked"],
        description: "Task status: working (continue), complete (done), blocked (needs user input)",
      },
      toolExecutionMode: {
        type: "string",
        enum: ["parallel", "serial"],
        description: "Execution mode for tool calls: 'parallel' (default) executes all concurrently, 'serial' executes one at a time with 50ms delay to avoid race conditions",
      },
    },
    additionalProperties: false,
  },
  strict: true,
}

// JSON schema for completion verification
// Note: 'minimum' and 'maximum' are NOT supported by OpenAI's strict structured outputs.
// The constraint is documented in the description field instead.
const verificationResponseSchema: OpenAI.ResponseFormatJSONSchema["json_schema"] = {
  name: "CompletionVerification",
  description: "Strict verifier to determine if the user's request has been fully satisfied.",
  schema: {
    type: "object",
    properties: {
      isComplete: { type: "boolean", description: "True only if the user's original request has been fully satisfied." },
      confidence: { type: "number", description: "Confidence in the judgment, must be between 0 and 1 inclusive." },
      missingItems: { type: "array", items: { type: "string" }, description: "List of missing steps, outputs, or requirements, if any." },
      reason: { type: "string", description: "Brief explanation of the judgment." }
    },
    required: ["isComplete"],
    additionalProperties: false,
  },
  strict: true,
}

export type CompletionVerification = {
  isComplete: boolean
  confidence?: number
  missingItems?: string[]
  reason?: string
}


/**
 * Cache of model capabilities learned at runtime
 * Format: { "model-name": { supportsJsonSchema: boolean, supportsJsonObject: boolean } }
 */
const modelCapabilityCache = new Map<string, {
  supportsJsonSchema: boolean
  supportsJsonObject: boolean
  lastTested: number
}>()

/**
 * How long to cache model capability information (24 hours)
 */
const CAPABILITY_CACHE_TTL = 24 * 60 * 60 * 1000

/**
 * Record that a model failed with a specific structured output mode
 */
function recordStructuredOutputFailure(model: string, mode: 'json_schema' | 'json_object'): void {
  const cached = modelCapabilityCache.get(model) || {
    supportsJsonSchema: true,
    supportsJsonObject: true,
    lastTested: Date.now()
  }

  if (mode === 'json_schema') {
    cached.supportsJsonSchema = false
  } else if (mode === 'json_object') {
    cached.supportsJsonObject = false
  }

  cached.lastTested = Date.now()
  modelCapabilityCache.set(model, cached)

  if (isDebugLLM()) {
    logLLM(`📝 Recorded capability for ${model}:`, cached)
  }
}

/**
 * Record that a model succeeded with a specific structured output mode
 */
function recordStructuredOutputSuccess(model: string, mode: 'json_schema' | 'json_object'): void {
  const cached = modelCapabilityCache.get(model) || {
    supportsJsonSchema: true,
    supportsJsonObject: true,
    lastTested: Date.now()
  }

  if (mode === 'json_schema') {
    cached.supportsJsonSchema = true
  } else if (mode === 'json_object') {
    cached.supportsJsonObject = true
  }

  cached.lastTested = Date.now()
  modelCapabilityCache.set(model, cached)

  if (isDebugLLM()) {
    logLLM(`✅ Confirmed capability for ${model}:`, cached)
  }
}

/**
 * Check if a model is known to NOT support structured output with JSON schema
 * We use a hybrid approach:
 * 1. Check runtime cache first (learned from actual usage)
 * 2. Fall back to hardcoded list for known incompatible models
 */
function isKnownIncompatibleWithStructuredOutput(model: string): boolean {
  // Check runtime cache first
  const cached = modelCapabilityCache.get(model)
  if (cached && (Date.now() - cached.lastTested) < CAPABILITY_CACHE_TTL) {
    // Cache is fresh, use it
    return !cached.supportsJsonSchema
  }

  // Hardcoded list of models known to be incompatible
  // This serves as a fallback and initial seed
  const incompatibleModels: string[] = [
    // Google Gemini models through OpenRouter don't support JSON schema
    // They return empty or invalid responses when json_schema is requested
    "google/gemini",
    // Add other specific models here that are known to fail with JSON schema
  ]

  return incompatibleModels.some((incompatible: string) =>
    model.toLowerCase().includes(incompatible.toLowerCase())
  )
}

/**
 * Check if we should attempt structured output for a model
 * Returns true for all models except those known to be incompatible
 */
function shouldAttemptStructuredOutput(model: string): boolean {
  return !isKnownIncompatibleWithStructuredOutput(model)
}

/**
 * Check if we should attempt JSON Object mode for a model
 */
function shouldAttemptJsonObject(model: string): boolean {
  const cached = modelCapabilityCache.get(model)
  if (cached && (Date.now() - cached.lastTested) < CAPABILITY_CACHE_TTL) {
    return cached.supportsJsonObject
  }
  // Default to true - try it unless we know it doesn't work
  return true
}

/**
 * Extracts the first JSON object from a given string.
 * @param str - The string to search for a JSON object.
 * @returns The parsed JSON object, or null if no valid JSON object is found.
 */
function extractJsonObject(str: string): any | null {
  // Try to find JSON by looking for balanced braces
  let braceCount = 0
  let startIndex = -1

  for (let i = 0; i < str.length; i++) {
    const char = str[i]

    if (char === "{") {
      if (braceCount === 0) {
        startIndex = i
      }
      braceCount++
    } else if (char === "}") {
      braceCount--

      if (braceCount === 0 && startIndex !== -1) {
        // Found a complete JSON object
        const jsonStr = str.substring(startIndex, i + 1)
        try {
          return JSON.parse(jsonStr)
        } catch (e) {
          // Continue looking for the next JSON object
          startIndex = -1
        }
      }
    }
  }

  return null
}

/**
 * Enhanced error class for HTTP errors with status code and retry information
 */
class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public responseText: string,

    public retryAfter?: number,
  ) {
    super(HttpError.createUserFriendlyMessage(status, statusText, responseText, retryAfter))
    this.name = 'HttpError'
  }

  /**
   * Create user-friendly error messages for different HTTP status codes
   */
  private static createUserFriendlyMessage(
    status: number,
    statusText: string,
    responseText: string,
    retryAfter?: number
  ): string {
    switch (status) {
      case 400: {
        // Bad Request - often caused by invalid model names or malformed requests
        // Try to extract specific error message from response
        let errorDetail = ''
        try {
          const errorJson = JSON.parse(responseText)
          if (errorJson.error?.message) {
            errorDetail = errorJson.error.message
          }
        } catch (e) {
          errorDetail = responseText
        }

        // Check if it's a model-related error
        const lowerDetail = errorDetail.toLowerCase()
        if (lowerDetail.includes('model') || lowerDetail.includes('does not exist') || lowerDetail.includes('not found')) {
          return `Invalid model name. The specified model does not exist or is not available. Please check your model settings and ensure the model name is correct. Error details: ${errorDetail}`
        }

        return `Bad request. The API rejected the request. ${errorDetail ? `Error details: ${errorDetail}` : 'Please check your configuration.'}`
      }

      case 429:
        const waitTime = retryAfter ? `${retryAfter} seconds` : 'a moment'
        return `Rate limit exceeded. The API is temporarily unavailable due to too many requests. We'll automatically retry after waiting ${waitTime}. You don't need to do anything - just wait for the request to complete.`

      case 401:
        return 'Authentication failed. Please check your API key configuration.'

      case 403:
        return 'Access forbidden. Your API key may not have permission to access this resource.'

      case 404:
        return 'API endpoint not found. Please check your base URL configuration.'

      case 408:
        return 'Request timeout. The API took too long to respond.'

      case 500:
        return 'Internal server error. The API service is experiencing issues.'

      case 502:
        return 'Bad gateway. There may be a temporary issue with the API service.'

      case 503:
        return 'Service unavailable. The API service is temporarily down for maintenance.'

      case 504:
        return 'Gateway timeout. The API service is not responding.'

      default:
        // For other errors, try to extract meaningful information from the response
        try {
          const errorJson = JSON.parse(responseText)
          if (errorJson.error?.message) {
            return `API Error: ${errorJson.error.message}`
          }
        } catch (e) {
          // If response is not JSON, use the raw response
        }

        return `HTTP ${status}: ${responseText || statusText}`
    }
  }
}

/**
 * Check if an error is retryable based on status code and error type
 */
function isRetryableError(error: unknown): boolean {
  // Abort should never be retried
  if (error instanceof Error) {
    if ((error as any).name === "AbortError" || error.message.toLowerCase().includes("abort")) {
      return false
    }
  }

  if (error instanceof HttpError) {
    // Retry on rate limits (429), server errors (5xx), and some client errors
    return error.status === 429 ||
           (error.status >= 500 && error.status < 600) ||
           error.status === 408 || // Request Timeout
           error.status === 502 || // Bad Gateway
           error.status === 503 || // Service Unavailable
           error.status === 504    // Gateway Timeout
  }

  // Retry on network errors and empty response errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    return message.includes('network') ||
           message.includes('timeout') ||
           message.includes('connection') ||
           message.includes('fetch') ||
           message.includes('empty response') || // Empty LLM responses
           message.includes('empty content') ||  // Empty content in structured responses
           message.includes('cloudflare') ||     // Cloudflare errors (524, etc.)
           message.includes('gateway')           // Gateway errors
  }

  return false
}

/**
 * Calculate delay for exponential backoff with jitter
 */
function calculateBackoffDelay(attempt: number, baseDelay: number = 1000, maxDelay: number = 30000): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt)

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay)

  // Add jitter (±25% randomization) to avoid thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1)

  return Math.max(0, cappedDelay + jitter)
}

/**
 * Makes an API call with enhanced retry logic including exponential backoff for rate limits.
 * Rate limit errors (429) will retry indefinitely until successful.
 * Other errors respect the retry count limit.
 * @param call - The API call function to execute.
 * @param retryCount - The number of times to retry the API call if it fails (does not apply to rate limits).
 * @param baseDelay - Base delay in milliseconds for exponential backoff.
 * @param maxDelay - Maximum delay in milliseconds between retries.
 * @returns A promise that resolves with the response from the successful API call.
 */
async function apiCallWithRetry<T>(
  call: () => Promise<T>,
  retryCount: number = 3,
  baseDelay: number = 1000,
  maxDelay: number = 30000,
  onRetryProgress?: RetryProgressCallback,
): Promise<T> {
  let lastError: unknown
  let attempt = 0

  // Helper to clear retry status when done
  const clearRetryStatus = () => {
    if (onRetryProgress) {
      onRetryProgress({
        isRetrying: false,
        attempt: 0,
        delaySeconds: 0,
        reason: "",
        startedAt: 0,
      })
    }
  }

  while (true) {
    // If an emergency stop has been requested, abort immediately
    if (state.shouldStopAgent) {
      clearRetryStatus()
      throw lastError instanceof Error ? lastError : new Error("Aborted by emergency stop")
    }

    try {
      const response = await call()
      clearRetryStatus()
      return response
    } catch (error) {
      lastError = error

      // Do not retry on abort or if we've been asked to stop
      if ((error as any)?.name === "AbortError" || state.shouldStopAgent) {
        clearRetryStatus()
        throw error
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        diagnosticsService.logError(
          "llm-fetch",
          "Non-retryable API error",
          {
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof HttpError ? 'HttpError' : error instanceof Error ? 'Error' : typeof error,
            status: error instanceof HttpError ? error.status : undefined,
            stack: error instanceof Error ? error.stack : undefined,
          },
        )
        clearRetryStatus()
        throw error
      }

      // Handle rate limit errors (429) - no retry limit, keep trying indefinitely
      if (error instanceof HttpError && error.status === 429) {
        let delay = calculateBackoffDelay(attempt, baseDelay, maxDelay)

        // Use Retry-After header if provided
        if (error.retryAfter) {
          delay = error.retryAfter * 1000 // Convert seconds to milliseconds
          // Cap the retry-after delay to prevent extremely long waits
          delay = Math.min(delay, maxDelay)
        }

        const waitTimeSeconds = Math.round(delay / 1000)

        // Log for debugging
        diagnosticsService.logError(
          "llm-fetch",
          `Rate limit encountered (429). Waiting ${waitTimeSeconds}s before retry (attempt ${attempt + 1})`,
          {
            status: error.status,
            retryAfter: error.retryAfter,
            delay,
            message: "Rate limits are temporary - will keep retrying until successful"
          }
        )

        // User-friendly log output so users can see progress
        logLLM(`⏳ Rate limit hit - waiting ${waitTimeSeconds} seconds before retrying... (attempt ${attempt + 1})`)

        // Emit retry progress to UI
        if (onRetryProgress) {
          onRetryProgress({
            isRetrying: true,
            attempt: attempt + 1,
            maxAttempts: undefined, // Rate limits retry indefinitely
            delaySeconds: waitTimeSeconds,
            reason: "Rate limit exceeded",
            startedAt: Date.now(),
          })
        }

        // Wait before retrying unless we've been asked to stop
        if (state.shouldStopAgent) {
          clearRetryStatus()
          throw new Error("Aborted by emergency stop")
        }
        await new Promise(resolve => setTimeout(resolve, delay))
        attempt++
        continue
      }

      // For other retryable errors, respect the retry limit
      if (attempt >= retryCount) {
        diagnosticsService.logError(
          "llm-fetch",
          "API call failed after all retries",
          {
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof HttpError ? 'HttpError' : error instanceof Error ? 'Error' : typeof error,
            status: error instanceof HttpError ? error.status : undefined,
            attempts: attempt + 1,
            maxRetries: retryCount + 1,
          },
        )
        clearRetryStatus()
        throw lastError
      }

      // Calculate delay for this attempt
      const delay = calculateBackoffDelay(attempt, baseDelay, maxDelay)

      diagnosticsService.logWarning(
        "llm-fetch",
        `API call failed, retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retryCount + 1})`,
        {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof HttpError ? 'HttpError' : error instanceof Error ? 'Error' : typeof error,
          status: error instanceof HttpError ? error.status : undefined,
          delay,
          attempt: attempt + 1,
          maxRetries: retryCount + 1,
        }
      )

      // User-friendly log output so users can see retry progress
      const reason = error instanceof HttpError
        ? `HTTP ${error.status} error`
        : "Network error"
      if (error instanceof HttpError) {
        logLLM(`⏳ HTTP ${error.status} error - retrying in ${Math.round(delay / 1000)} seconds... (attempt ${attempt + 1}/${retryCount + 1})`)
      } else {
        logLLM(`⏳ Network error - retrying in ${Math.round(delay / 1000)} seconds... (attempt ${attempt + 1}/${retryCount + 1})`)
      }

      // Emit retry progress to UI
      if (onRetryProgress) {
        onRetryProgress({
          isRetrying: true,
          attempt: attempt + 1,
          maxAttempts: retryCount + 1,
          delaySeconds: Math.round(delay / 1000),
          reason,
          startedAt: Date.now(),
        })
      }

      // Wait before retrying unless we've been asked to stop
      if (state.shouldStopAgent) {
        clearRetryStatus()
        throw new Error("Aborted by emergency stop")
      }
      await new Promise(resolve => setTimeout(resolve, delay))
      attempt++
    }
  }
}

/**
 * Get the appropriate model for the provider
 */
function getModel(providerId: string, type: "mcp" | "transcript"): string {
  const config = configStore.get()

  switch (providerId) {
    case "openai":
      return type === "mcp"
        ? config.mcpToolsOpenaiModel || "gpt-4o-mini"
        : config.transcriptPostProcessingOpenaiModel || "gpt-4o-mini"
    case "groq":
      return type === "mcp"
        ? config.mcpToolsGroqModel || "llama-3.3-70b-versatile"
        : config.transcriptPostProcessingGroqModel || "llama-3.1-70b-versatile"
    case "gemini":
      return config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
    default:
      return "gpt-4o-mini"
  }
}

/**
 * Check if a model supports JSON mode
 */
function supportsJsonMode(model: string, providerId: string): boolean {
  // OpenAI models that support JSON mode
  if (providerId === "openai") {
    return model.includes("gpt-4") || model.includes("gpt-3.5-turbo")
  }

  // Groq models that support JSON mode
  if (providerId === "groq") {
    return (
      model.includes("llama") ||
      model.includes("mixtral") ||
      model.includes("gemma") ||
      model.includes("moonshotai/kimi-k2-instruct") ||
      model.includes("openai/gpt-oss")
    )
  }

  // Conservative default - assume no JSON mode support
  return false
}

/**
 * Helper: detect empty assistant content in an OpenAI-compatible response
 */
function isEmptyContentResponse(resp: any): boolean {
  try {
    const content = resp?.choices?.[0]?.message?.content
    return typeof content !== "string" || content.trim() === ""
  } catch {
    return true
  }
}

/**
 * Enrich request body with OpenRouter-specific fields when using OpenRouter API.
 * Adds the response-healing plugin to automatically fix malformed JSON responses.
 * See: https://openrouter.ai/docs/guides/features/plugins/response-healing
 */
function enrichRequestBodyForOpenRouter(baseURL: string, requestBody: Record<string, any>): Record<string, any> {
  if (!baseURL.toLowerCase().includes('openrouter.ai')) {
    return requestBody
  }
  const existingPlugins = Array.isArray(requestBody.plugins) ? requestBody.plugins : []
  if (existingPlugins.some((p: { id?: string } | null | undefined) => p?.id === "response-healing")) {
    return requestBody
  }
  return { ...requestBody, plugins: [...existingPlugins, { id: "response-healing" }] }
}

/**
 * Make a single API call attempt with specific response format
 */
async function makeAPICallAttempt(
  baseURL: string,
  apiKey: string,
  requestBody: any,
  estimatedTokens: number,
  sessionId?: string,
): Promise<any> {
  if (isDebugLLM()) {
    logLLM("=== OPENAI API REQUEST ===")
    logLLM("HTTP Request", {
      url: `${baseURL}/chat/completions`,
      model: requestBody.model,
      messagesCount: requestBody.messages.length,
      responseFormat: requestBody.response_format,
      estimatedTokens,
      totalPromptLength: (requestBody.messages as Array<{ role: string; content: string }>).reduce(
        (sum: number, msg: { role: string; content: string }) => sum + ((msg.content?.length) || 0),
        0,
      ),
      contextWarning: estimatedTokens > 8000 ? "WARNING: High token count, may exceed context limit" : null
    })
    logLLM("Request Body (truncated)", {
      ...requestBody,
      messages: (requestBody.messages as Array<{ role: string; content: string }>).map(
        (msg: { role: string; content: string }) => ({
          role: msg.role,
          content: msg.content.length > 200
            ? msg.content.substring(0, 200) + "... [" + msg.content.length + " chars]"
            : msg.content,
        }),
      )
    })
  }

  // Create abort controller and register it so emergency stop can cancel
  const controller = new AbortController()
  if (sessionId) {
    agentSessionStateManager.registerAbortController(sessionId, controller)
  } else {
    llmRequestAbortManager.register(controller)
  }
  try {
    // Check both global and session-specific stop flags
    if (state.shouldStopAgent || (sessionId && agentSessionStateManager.shouldStopSession(sessionId))) {
      controller.abort()
    }

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(enrichRequestBodyForOpenRouter(baseURL, requestBody)),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()

      if (isDebugLLM()) {
        logLLM("❌ HTTP Error Response", {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText.substring(0, 1000),
          headers: Object.fromEntries(response.headers.entries())
        })
      }

      // Check if this is a structured output related error
      // Only treat 4xx client errors as potential structured output errors
      // Server errors (5xx) should always be treated as retryable HTTP errors
      // Be more specific: only treat as structured output error if it mentions the specific features
      // Normalize to lowercase to handle provider capitalization differences
      const errorTextLower = errorText.toLowerCase()
      const isStructuredOutputError = response.status >= 400 && response.status < 500 &&
                                     (errorTextLower.includes("json_schema") ||
                                      errorTextLower.includes("response_format") ||
                                      errorTextLower.includes("json_validate_failed") ||
                                      errorTextLower.includes("failed to generate json") ||
                                      (errorTextLower.includes("schema") && errorTextLower.includes("not supported")) ||
                                      // Novita and other providers may return generic "model inference" errors
                                      // when they don't support structured output features
                                      (errorTextLower.includes("model inference") && errorTextLower.includes("error")) ||
                                      errorTextLower.includes("unknown error in the model") ||
                                      // Cerebras API returns this error when JSON schema format is incompatible
                                      (errorTextLower.includes("object fields require") && errorTextLower.includes("properties")))
      if (isStructuredOutputError) {
        if (isDebugLLM()) {
          logLLM("🔴 Detected as structured output error")
        }
        const error = new Error(errorText)
        ;(error as any).isStructuredOutputError = true

        // Try to extract failed_generation from the error response
        // This contains the LLM's actual response when JSON validation fails
        try {
          const errorJson = JSON.parse(errorText)
          if (errorJson?.error?.failed_generation) {
            ;(error as any).failedGeneration = errorJson.error.failed_generation
            if (isDebugLLM()) {
              logLLM("📝 Extracted failed_generation content")
            }
          }
        } catch {
          // Error text is not JSON, ignore
        }

        throw error
      }

      throw new HttpError(response.status, response.statusText, errorText)
    }

    const data = await response.json()

    // Log empty content cases - this is anomalous behavior
    const messageContent = data.choices?.[0]?.message?.content
    const hasToolCalls = !!data.choices?.[0]?.message?.tool_calls?.length
    const isEmptyContent = !hasToolCalls && (!messageContent ||
      (typeof messageContent === 'string' && messageContent.trim() === '') ||
      (Array.isArray(messageContent) && messageContent.length === 0))

    if (isEmptyContent) {
      const diagnostic = {
        model: requestBody.model,
        provider: baseURL,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: data.usage,
        messagesCount: requestBody.messages?.length,
        lastMessageRole: requestBody.messages?.at(-1)?.role,
      }
      diagnosticsService.logError("llm-fetch", "Empty content from LLM API", diagnostic)
    }

    if (isDebugLLM()) {
      const choice = data.choices?.[0]
      logLLM("✅ Response received", {
        hasContent: !!choice?.message?.content,
        contentLength: choice?.message?.content?.length || 0,
        hasToolCalls: !!choice?.message?.tool_calls?.length,
        finishReason: choice?.finish_reason,
        usage: data.usage,
      })
    }

    if (data.error) {
      if (isDebugLLM()) {
        logLLM("API Error", data.error)
      }
      const errorMessage = data.error.message || String(data.error)
      const errorMessageLower = errorMessage.toLowerCase()
      const error = new Error(errorMessage)
      ;(error as any).isStructuredOutputError = errorMessageLower.includes("json_schema") ||
                                               errorMessageLower.includes("response_format") ||
                                               errorMessageLower.includes("json_validate_failed") ||
                                               // Novita and other providers may return generic errors
                                               errorMessageLower.includes("model inference") ||
                                               errorMessageLower.includes("unknown error in the model")

      // Extract failed_generation content if available (LLM response when JSON formatting fails)
      if (data.error.failed_generation) {
        ;(error as any).failedGeneration = data.error.failed_generation
      }

      // Log structured output errors for debugging
      if ((error as any).isStructuredOutputError && isDebugLLM()) {
        logLLM("⚠️ JSON Schema error", {
          model: requestBody.model,
          error: errorMessage,
          hasFailedGeneration: !!data.error.failed_generation
        })
      }

      throw error
    }

    if (isDebugLLM()) {
      logLLM("HTTP Response (full)", {
        dataKeys: Object.keys(data),
        data: JSON.stringify(data).substring(0, 2000) + "..."
      })
    }

    return data
  } finally {
    if (sessionId) {
      agentSessionStateManager.unregisterAbortController(sessionId, controller)
    } else {
      llmRequestAbortManager.unregister(controller)
    }
  }
}

/**
 * Make a fetch-based LLM call for OpenAI-compatible APIs with structured output fallback
 */
async function makeOpenAICompatibleCall(
  messages: Array<{ role: string; content: string }>,
  providerId: string,
  useStructuredOutput: boolean = true,
  sessionId?: string,
  onRetryProgress?: RetryProgressCallback,
): Promise<any> {
  const config = configStore.get()

  const baseURL =
    providerId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

  const apiKey = providerId === "groq" ? config.groqApiKey : config.openaiApiKey

  if (!apiKey) {
    throw new Error(`API key is required for ${providerId}`)
  }

  const model = getModel(providerId, "mcp")
  const estimatedTokens = Math.ceil(messages.reduce((sum, msg) => sum + msg.content.length, 0) / 4)

  const baseRequestBody = {
    model,
    messages,
    temperature: 0,
    seed: 1,
  }

  if (!useStructuredOutput) {
    // No structured output requested, make simple call
    return apiCallWithRetry(async () => {
      return makeAPICallAttempt(baseURL, apiKey, baseRequestBody, estimatedTokens, sessionId)
    }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay, onRetryProgress)
  }

  // Try structured output with fallback
  return apiCallWithRetry(async () => {
    // First attempt: JSON Schema mode (if model should support it)
    if (shouldAttemptStructuredOutput(model)) {
      try {
        const requestBodyWithSchema = {
          ...baseRequestBody,
          response_format: {
            type: "json_schema",
            json_schema: toolCallResponseSchema,
          }
        }

        if (isDebugLLM()) {
          logLLM("Attempting JSON Schema mode for model:", model)
        }

        {
          const data = await makeAPICallAttempt(baseURL, apiKey, requestBodyWithSchema, estimatedTokens, sessionId)
          if (isEmptyContentResponse(data)) {
            if (isDebugLLM()) {
              logLLM("Empty content from JSON Schema response; falling back to JSON/Object or plain text")
            }
            const err = new Error("Empty content in structured (json_schema) response") as any
            ;(err as any).isStructuredOutputError = true
            // Record that this model doesn't support JSON Schema
            recordStructuredOutputFailure(model, 'json_schema')
            throw err
          }
          // Success! Record that this model supports JSON Schema
          recordStructuredOutputSuccess(model, 'json_schema')
          return data
        }
      } catch (error: any) {
        if (error.isStructuredOutputError) {
          // If we have failed_generation content, try one retry with JSON wrapping
          if (error.failedGeneration) {
            try {
              const retryMessages = [
                ...messages,
                { role: "assistant", content: error.failedGeneration },
                { role: "user", content: `Return your previous response as valid JSON: {"content": "...", "status": "complete"}. Escape quotes properly.` }
              ]

              const retryData = await makeAPICallAttempt(baseURL, apiKey, {
                ...baseRequestBody,
                messages: retryMessages,
                response_format: { type: "json_schema", json_schema: toolCallResponseSchema }
              }, estimatedTokens, sessionId)

              if (!isEmptyContentResponse(retryData)) {
                recordStructuredOutputSuccess(model, 'json_schema')
                return retryData
              }
            } catch {
              // Continue to fallback modes
            }
          }

          if (isDebugLLM()) {
            logLLM("⚠️ JSON Schema failed for", model, "- falling back")
          }
          // Record that this model doesn't support JSON Schema
          recordStructuredOutputFailure(model, 'json_schema')
          // Fall through to JSON Object mode
        } else {
          // Non-structured-output error, re-throw
          if (isDebugLLM()) {
            logLLM("❌ Non-structured-output error, re-throwing:", error.message)
          }
          throw error
        }
      }
    }

    // Second attempt: JSON Object mode (if model supports it)
    if (supportsJsonMode(model, providerId) && shouldAttemptJsonObject(model)) {
      try {
        const requestBodyWithJson = {
          ...baseRequestBody,
          response_format: { type: "json_object" }
        }

        if (isDebugLLM()) {
          logLLM("Attempting JSON Object mode for model:", model)
        }

        {
          const data = await makeAPICallAttempt(baseURL, apiKey, requestBodyWithJson, estimatedTokens, sessionId)
          if (isEmptyContentResponse(data)) {
            if (isDebugLLM()) {
              logLLM("Empty content from JSON Object response; falling back to plain text")
            }
            const err = new Error("Empty content in structured (json_object) response") as any
            ;(err as any).isStructuredOutputError = true
            // Record that this model doesn't support JSON Object mode
            recordStructuredOutputFailure(model, 'json_object')
            throw err
          }
          // Success! Record that this model supports JSON Object mode
          recordStructuredOutputSuccess(model, 'json_object')
          return data
        }
      } catch (error: any) {
        if (error.isStructuredOutputError) {
          if (isDebugLLM()) {
            logLLM("⚠️ JSON Object mode FAILED for model", model, "- falling back to plain text")
            logLLM("Error details:", {
              message: error.message,
              stack: error.stack?.split('\n').slice(0, 3).join('\n')
            })
          }
          // Record that this model doesn't support JSON Object mode
          recordStructuredOutputFailure(model, 'json_object')
          // Fall through to plain text
        } else {
          // Non-structured-output error, re-throw
          if (isDebugLLM()) {
            logLLM("❌ Non-structured-output error, re-throwing:", error.message)
          }
          throw error
        }
      }
    }

    // Final attempt: Plain text mode
    if (isDebugLLM()) {
      logLLM("Using plain text mode for model:", model)
    }

    return await makeAPICallAttempt(baseURL, apiKey, baseRequestBody, estimatedTokens, sessionId)
  }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay, onRetryProgress)

}

/**
 * Make a fetch-based LLM call for Gemini API
 */
async function makeGeminiCall(
  messages: Array<{ role: string; content: string }>,
  sessionId?: string,
  onRetryProgress?: RetryProgressCallback,
): Promise<any> {
  const config = configStore.get()

  if (!config.geminiApiKey) {
    throw new Error("Gemini API key is required")
  }

  const model = getModel("gemini", "mcp")
  const baseURL =
    config.geminiBaseUrl || "https://generativelanguage.googleapis.com"

  // Convert messages to Gemini format
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")

  return apiCallWithRetry(async () => {
    if (isDebugLLM()) {
      logLLM("Gemini HTTP Request", {
        url: `${baseURL}/v1beta/models/${model}:generateContent`,
        model,
      })
      logLLM("Gemini Request Body", { prompt })
    }

    const controller = new AbortController()
    if (sessionId) {
      agentSessionStateManager.registerAbortController(sessionId, controller)
    } else {
      llmRequestAbortManager.register(controller)
    }
    try {
      // Check both global and session-specific stop flags
      if (state.shouldStopAgent || (sessionId && agentSessionStateManager.shouldStopSession(sessionId))) {
        controller.abort()
      }

      const response = await fetch(
        `${baseURL}/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0,
            },
          }),
          signal: controller.signal,
        },
      )

    if (!response.ok) {
      const errorText = await response.text()

      // Extract Retry-After header for rate limiting
      let retryAfter: number | undefined
      const retryAfterHeader = response.headers.get('retry-after')
      if (retryAfterHeader) {
        const parsed = parseInt(retryAfterHeader, 10)
        if (!isNaN(parsed)) {
          retryAfter = parsed
        }
      }

      if (isDebugLLM()) {
        logLLM("Gemini HTTP Error", {
          status: response.status,
          statusText: response.statusText,
          errorText,
          retryAfter
        })
      }

      throw new HttpError(response.status, response.statusText, errorText, retryAfter)
    }

    const data = await response.json()

    if (data.error) {
      if (isDebugLLM()) {
        logLLM("Gemini API Error", data.error)
      }
      throw new Error(data.error.message)
    }

    // Extract text from Gemini response format
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      throw new Error("No text content in Gemini response")
    }

    if (isDebugLLM()) {
      logLLM("Gemini HTTP Response", data)
    }

    // Return in OpenAI-compatible format
    return {
      choices: [
        {
          message: {
            content: text.trim(),
          },
        },
      ],
    }
    } finally {
      if (sessionId) {
        agentSessionStateManager.unregisterAbortController(sessionId, controller)
      } else {
        llmRequestAbortManager.unregister(controller)
      }
    }
  }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay, onRetryProgress)
}

/**
 * Helper function that performs the actual LLM call logic
 * This is wrapped by makeLLMCallWithFetch with retry logic
 */
async function makeLLMCallAttempt(
  messages: Array<{ role: string; content: string }>,
  chatProviderId: string,
  onRetryProgress?: RetryProgressCallback,
  sessionId?: string,
): Promise<LLMToolCallResponse> {
  if (isDebugLLM()) {
    logLLM("🚀 Starting LLM call attempt", {
      provider: chatProviderId,
      messagesCount: messages.length,
      lastMessagePreview: messages[messages.length - 1]?.content?.substring(0, 100) + "..."
    })
  }

  let response: any

  if (chatProviderId === "gemini") {
    response = await makeGeminiCall(messages, sessionId, onRetryProgress)
  } else {
    response = await makeOpenAICompatibleCall(messages, chatProviderId, true, sessionId, onRetryProgress)
  }

  if (isDebugLLM()) {
    logLLM("Raw API response structure:", {
      hasChoices: !!response.choices,
      choicesLength: response.choices?.length,
      firstChoiceExists: !!response.choices?.[0],
      hasMessage: !!response.choices?.[0]?.message,
      hasContent: !!response.choices?.[0]?.message?.content,
      fullResponse: JSON.stringify(response, null, 2).substring(0, 1000) + "..." // First 1000 chars
    })
  }

  const messageObj = response.choices?.[0]?.message || {}
  let content: string | undefined = (messageObj.content ?? "").trim()

  if (isDebugLLM()) {
    logLLM("📝 Message content extracted:", {
      contentLength: content?.length || 0,
      contentPreview: content?.substring(0, 200) || "(empty)",
      messageObjKeys: Object.keys(messageObj),
      messageObj: messageObj
    })
  }

  if (!content) {
    if (isDebugLLM()) {
      logLLM("⚠️ EMPTY CONTENT - checking reasoning fallback", {
        responseSummary: {
          hasChoices: !!response.choices,
          hasMessage: !!messageObj,
          content: messageObj?.content,
          contentType: typeof messageObj?.content,
          hasReasoning: !!(messageObj as any)?.reasoning,
        }
      })
    }

    // Some providers (e.g., OpenRouter with certain models) return useful output in a non-standard 'reasoning' field
    const rawReasoning = (messageObj as any)?.reasoning
    const reasoningText = typeof rawReasoning === "string"
      ? rawReasoning
      : (rawReasoning && typeof rawReasoning === "object" && typeof rawReasoning.text === "string")
        ? rawReasoning.text
        : ""

    if (reasoningText) {
      // First, try to extract structured JSON from reasoning
      const jsonFromReasoning = extractJsonObject(reasoningText)
      if (jsonFromReasoning && (jsonFromReasoning.toolCalls || jsonFromReasoning.content)) {
        if (isDebugLLM()) {
          logLLM("Parsed structured output from reasoning fallback")
        }
        let resp = normalizeResponse(jsonFromReasoning as LLMToolCallResponse)
        if (resp.needsMoreWork === undefined && !resp.toolCalls) {
          resp = normalizeResponse({ ...resp, status: "working" })
        }
        return resp
      }

      // Otherwise, treat reasoning text as plain content
      if (reasoningText.trim()) {
        if (isDebugLLM()) logLLM("Using reasoning text as content fallback")
        content = reasoningText.trim()
      }
    }

    if (!content) {
      const emptyResponseDetails = {
        hasResponse: !!response,
        hasChoices: !!response?.choices,
        choicesLength: response?.choices?.length,
        firstChoice: response?.choices?.[0],
        hasMessage: !!response?.choices?.[0]?.message,
        messageContent: response?.choices?.[0]?.message?.content,
        messageContentType: typeof response?.choices?.[0]?.message?.content,
        hasReasoning: !!(response?.choices?.[0]?.message as any)?.reasoning,
      }

      if (isDebugLLM()) {
        logLLM("Empty response details:", emptyResponseDetails)
      }

      diagnosticsService.logError(
        "llm-fetch",
        "LLM returned empty response",
        emptyResponseDetails
      )

      // Empty responses should be treated as errors requiring retry, not completion
      // This prevents workflows from terminating prematurely when LLM fails to respond
      throw new Error("LLM returned empty response - this indicates a model or API issue that should be retried")
    }
  }

  // Try to extract JSON object from response
  const jsonObject = extractJsonObject(content)
  if (isDebugLLM()) {
    logLLM("🔍 JSON Extraction Result:", {
      hasJsonObject: !!jsonObject,
      jsonObjectKeys: jsonObject ? Object.keys(jsonObject) : [],
      hasToolCalls: !!jsonObject?.toolCalls,
      hasContent: !!jsonObject?.content,
      toolCallsCount: jsonObject?.toolCalls?.length || 0,
      extractedObject: jsonObject
    })
  }
  if (jsonObject && (jsonObject.toolCalls || jsonObject.content)) {
    // Normalize status field to needsMoreWork for backward compatibility
    let response = normalizeResponse(jsonObject as LLMToolCallResponse)
    // If JSON lacks both toolCalls and needsMoreWork/status, default to working
    if (response.needsMoreWork === undefined && !response.toolCalls) {
      response = normalizeResponse({ ...response, status: "working" })
    }
    // Safety: If marked complete but has tool-call markers, override to working
    const toolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i
    const text = (response.content || "").replace(/<\|[^|]*\|>/g, "").trim()
    if (response.needsMoreWork === false && (!response.toolCalls || response.toolCalls.length === 0) && toolMarkers.test(text)) {
      response = normalizeResponse({ ...response, status: "working" })
    }

    if (isDebugLLM()) {
      logLLM("✅ Returning structured JSON response", {
        hasContent: !!response.content,
        hasToolCalls: !!response.toolCalls,
        toolCallsCount: response.toolCalls?.length || 0,
        status: response.status,
        needsMoreWork: response.needsMoreWork
      })
    }

    return response
  }

  // If no valid JSON found, decide conservatively based on content
  // If content contains tool-call markers, do NOT mark complete: keep status=working so the agent can iterate.
  const hasToolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i.test(content || "")
  const cleaned = (content || "").replace(/<\|[^|]*\|>/g, "").trim()
  if (hasToolMarkers) {
    if (isDebugLLM()) {
      logLLM("✅ Returning plain text with tool markers (status=working)")
    }
    return normalizeResponse({ content: cleaned, status: "working" })
  }

  // For plain text responses without JSON structure, return with status undefined.
  // normalizeResponse will leave needsMoreWork undefined when status is undefined.
  // This allows the agent loop to decide whether the response is acceptable or
  // if it needs to nudge the LLM for a properly formatted response.
  // This prevents poor-quality plain text responses from being automatically accepted.
  // Fix for https://github.com/aj47/SpeakMCP/issues/443 - agent loop will now
  // always nudge for proper JSON format when needsMoreWork is undefined.
  if (isDebugLLM()) {
    logLLM("✅ Returning plain text response (needsMoreWork=undefined - agent will nudge for JSON)", {
      contentLength: (cleaned || content)?.length || 0
    })
  }
  return normalizeResponse({ content: cleaned || content })
}

/**
 * Main function to make LLM calls using fetch with automatic retry on empty responses
 */
export async function makeLLMCallWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
  onRetryProgress?: RetryProgressCallback,
  sessionId?: string,
): Promise<LLMToolCallResponse> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || "openai"

  try {
    // Wrap the LLM call with retry logic to handle empty responses
    return await apiCallWithRetry(
      async () => makeLLMCallAttempt(messages, chatProviderId, onRetryProgress, sessionId),
      config.apiRetryCount,
      config.apiRetryBaseDelay,
      config.apiRetryMaxDelay,
      onRetryProgress
    )
  } catch (error: any) {
    // Use failed_generation content as fallback if available
    if (error?.failedGeneration) {
      return normalizeResponse({ content: error.failedGeneration, status: "complete" })
    }
    diagnosticsService.logError("llm-fetch", "LLM call failed after all retries", error)
    throw error
  }
}

/**
 * Callback for streaming content updates
 */
export type StreamingCallback = (chunk: string, accumulated: string) => void

/**
 * Make a streaming LLM call that invokes a callback for each chunk of text received.
 * Falls back to non-streaming if the provider doesn't support streaming.
 */
export async function makeLLMCallWithStreaming(
  messages: Array<{ role: string; content: string }>,
  onChunk: StreamingCallback,
  providerId?: string,
  sessionId?: string,
  externalAbortController?: AbortController,
): Promise<LLMToolCallResponse> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || "openai"

  // Gemini doesn't support streaming in the same way, fall back to non-streaming
  if (chatProviderId === "gemini") {
    const result = await makeLLMCallWithFetch(messages, chatProviderId, undefined, sessionId)
    if (result.content) {
      onChunk(result.content, result.content)
    }
    return result
  }

  const baseURL =
    chatProviderId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

  const apiKey = chatProviderId === "groq" ? config.groqApiKey : config.openaiApiKey

  if (!apiKey) {
    throw new Error(`API key is required for ${chatProviderId}`)
  }

  const model = getModel(chatProviderId, "mcp")

  // Use external abort controller if provided, otherwise create our own
  const abortController = externalAbortController || new AbortController()
  const shouldManageAbortController = !externalAbortController
  if (shouldManageAbortController) {
    if (sessionId) {
      agentSessionStateManager.registerAbortController(sessionId, abortController)
    } else {
      llmRequestAbortManager.register(abortController)
    }
  }

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(enrichRequestBodyForOpenRouter(baseURL, {
        model,
        messages,
        temperature: 0,
        stream: true,
      })),
      signal: abortController.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API request failed: ${response.status} ${errorText}`)
    }

    if (!response.body) {
      throw new Error("Response body is null")
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let accumulated = ""
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || "" // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === "data: [DONE]") continue
        if (!trimmed.startsWith("data: ")) continue

        try {
          const json = JSON.parse(trimmed.slice(6))
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            accumulated += delta
            onChunk(delta, accumulated)
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    // Flush the decoder to get any remaining bytes and process residual buffer
    buffer += decoder.decode(new Uint8Array(), { stream: false })
    if (buffer.trim() && buffer.trim() !== "data: [DONE]" && buffer.trim().startsWith("data: ")) {
      try {
        const json = JSON.parse(buffer.trim().slice(6))
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          accumulated += delta
          onChunk(delta, accumulated)
        }
      } catch {
        // Skip malformed JSON chunks
      }
    }

    // Parse the final accumulated content as a response
    // For streaming, we typically get plain text, so wrap it
    // Use normalizeResponse for consistency - status undefined leaves needsMoreWork undefined
    return normalizeResponse({
      content: accumulated,
      toolCalls: undefined,
    })
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw error
    }
    diagnosticsService.logError("llm-fetch", "Streaming LLM call failed", error)
    throw error
  } finally {
    // Clean up abort controller only if we created it ourselves
    if (shouldManageAbortController) {
      if (sessionId) {
        agentSessionStateManager.unregisterAbortController(sessionId, abortController)
      } else {
        llmRequestAbortManager.unregister(abortController)
      }
    }
  }
}

/**
 * Make a simple text completion call
 */
export async function makeTextCompletionWithFetch(
  prompt: string,
  providerId?: string,
  sessionId?: string,
): Promise<string> {
  const config = configStore.get()
  const chatProviderId =
    providerId || config.transcriptPostProcessingProviderId || "openai"

  const messages = [
    {
      role: "user",
      content: prompt,
    },
  ]

  try {
    let response: any

    if (chatProviderId === "gemini") {
      response = await makeGeminiCall(messages, sessionId)
    } else {
      response = await makeOpenAICompatibleCall(messages, chatProviderId, false, sessionId)
    }

    return response.choices[0]?.message.content?.trim() || ""
  } catch (error) {
    diagnosticsService.logError("llm-fetch", "Text completion failed", error)
    throw error
  }
}


/**
 * Verify completion using LLM with schema-first approach and fallbacks
 */
export async function verifyCompletionWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
): Promise<CompletionVerification> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || "openai"

  // Helper to parse content into CompletionVerification
  const parseVerification = (content: string): CompletionVerification => {
    const json = extractJsonObject(content) || (() => {
      try {
        return JSON.parse(content)
      } catch {
        return null
      }
    })()

    if (json && typeof json.isComplete === "boolean") {
      return json as CompletionVerification
    }

    // Conservative default: not complete when uncertain
    diagnosticsService.logError(
      "llm-fetch",
      "Failed to parse verifier output",
      {
        contentLength: content?.length || 0,
        contentPreview: content?.substring(0, 200) || "(empty)",
        extractedJson: json,
      }
    )

    return { isComplete: false, reason: "Unparseable verifier output" }
  }

  try {
    if (chatProviderId === "gemini") {
      // Gemini: call and parse text
      const response = await makeGeminiCall(messages)
      const content = response?.candidates?.[0]?.content?.parts?.[0]?.text ||
                      response?.choices?.[0]?.message?.content || ""
      return parseVerification(content || "")
    }

    // OpenAI-compatible: attempt JSON Schema first, then json_object, then plain text
    const baseURL = chatProviderId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"
    const apiKey = chatProviderId === "groq" ? config.groqApiKey : config.openaiApiKey
    if (!apiKey) throw new Error(`API key is required for ${chatProviderId}`)

    const model = getModel(chatProviderId, "mcp")
    const estimatedTokens = Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4)

    const baseRequestBody = { model, messages, temperature: 0, seed: 1 }

    const response = await apiCallWithRetry(async () => {
      // Try JSON Schema
      if (shouldAttemptStructuredOutput(model)) {
        try {
          const body = { ...baseRequestBody, response_format: { type: "json_schema", json_schema: verificationResponseSchema } }
          return await makeAPICallAttempt(baseURL, apiKey!, body, estimatedTokens)
        } catch (error: any) {
          if (!(error?.isStructuredOutputError)) throw error
        }
      }
      // Try JSON Object
      if (supportsJsonMode(model, chatProviderId)) {
        try {
          const body = { ...baseRequestBody, response_format: { type: "json_object" } }
          return await makeAPICallAttempt(baseURL, apiKey!, body, estimatedTokens)
        } catch (error: any) {
          if (!(error?.isStructuredOutputError)) throw error
        }
      }
      // Fallback plain text
      return await makeAPICallAttempt(baseURL, apiKey!, baseRequestBody, estimatedTokens)
    }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay)

    const content = response.choices?.[0]?.message?.content?.trim() || ""
    return parseVerification(content)
  } catch (error) {
    diagnosticsService.logError("llm-fetch", "Verification call failed", error)
    // Conservative: not complete when error
    return { isComplete: false, reason: (error as any)?.message || "Verification failed" }
  }
}
