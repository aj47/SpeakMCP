import { configStore } from "./config"
import { LLMToolCallResponse } from "./mcp-service"
import { diagnosticsService } from "./diagnostics"
import { isDebugLLM, logLLM } from "./debug"
import { state, llmRequestAbortManager, agentSessionStateManager } from "./state"
import OpenAI from "openai"

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
        description: "Whether more work is needed after this response",
      },
    },
    additionalProperties: false,
  },
  strict: true,
}

// JSON schema for completion verification
const verificationResponseSchema: OpenAI.ResponseFormatJSONSchema["json_schema"] = {
  name: "CompletionVerification",
  description: "Strict verifier to determine if the user's request has been fully satisfied.",
  schema: {
    type: "object",
    properties: {
      isComplete: { type: "boolean", description: "True only if the user's original request has been fully satisfied." },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence in the judgment (0-1)." },
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
  public errorCode?: string // Error code from API response (e.g., "json_validate_failed")

  constructor(
    public status: number,
    public statusText: string,
    public responseText: string,
    public retryAfter?: number,
    errorCode?: string,
  ) {
    super(HttpError.createUserFriendlyMessage(status, statusText, responseText, retryAfter, errorCode))
    this.name = 'HttpError'
    this.errorCode = errorCode
  }

  /**
   * Create user-friendly error messages for different HTTP status codes
   */
  private static createUserFriendlyMessage(
    status: number,
    statusText: string,
    responseText: string,
    retryAfter?: number,
    errorCode?: string
  ): string {
    // Handle specific error codes
    if (errorCode === 'json_validate_failed') {
      return `LLM failed to generate valid JSON. This is a temporary issue with the model's response format. We'll automatically retry with exponential backoff.`
    }

    switch (status) {
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
    // Retry on json_validate_failed errors - these are temporary LLM response format issues
    if (error.errorCode === 'json_validate_failed') {
      return true
    }

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
 * @param sessionId - Optional session ID for emitting retry progress updates.
 * @returns A promise that resolves with the response from the successful API call.
 */
async function apiCallWithRetry<T>(
  call: () => Promise<T>,
  retryCount: number = 3,
  baseDelay: number = 1000,
  maxDelay: number = 30000,
  sessionId?: string,
): Promise<T> {
  let lastError: unknown
  let attempt = 0

  while (true) {
    // If an emergency stop has been requested, abort immediately
    if (state.shouldStopAgent) {
      throw lastError instanceof Error ? lastError : new Error("Aborted by emergency stop")
    }

    try {
      const response = await call()
      return response
    } catch (error) {
      lastError = error

      // Do not retry on abort or if we've been asked to stop
      if ((error as any)?.name === "AbortError" || state.shouldStopAgent) {
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

        // User-friendly console output so users can see progress
        console.log(`⏳ Rate limit hit - waiting ${waitTimeSeconds} seconds before retrying... (attempt ${attempt + 1})`)

        // Wait before retrying unless we've been asked to stop
        if (state.shouldStopAgent) {
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

      // User-friendly console output so users can see retry progress
      if (error instanceof HttpError) {
        console.log(`⏳ HTTP ${error.status} error - retrying in ${Math.round(delay / 1000)} seconds... (attempt ${attempt + 1}/${retryCount + 1})`)
      } else {
        console.log(`⏳ Network error - retrying in ${Math.round(delay / 1000)} seconds... (attempt ${attempt + 1}/${retryCount + 1})`)
      }

      // Emit retry progress update if session ID is provided
      if (sessionId) {
        const retryCallback = agentSessionStateManager.getRetryProgressCallback(sessionId)
        if (retryCallback) {
          retryCallback({
            isRetrying: true,
            currentAttempt: attempt + 1,
            maxAttempts: retryCount + 1,
            delayMs: delay,
            errorMessage: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Wait before retrying unless we've been asked to stop
      if (state.shouldStopAgent) {
        throw new Error("Aborted by emergency stop")
      }
      await new Promise(resolve => setTimeout(resolve, delay))

      // Clear retry progress after delay
      if (sessionId) {
        const retryCallback = agentSessionStateManager.getRetryProgressCallback(sessionId)
        if (retryCallback) {
          retryCallback({
            isRetrying: false,
            currentAttempt: 0,
            maxAttempts: 0,
            delayMs: 0,
            errorMessage: '',
          })
        }
      }

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
      body: JSON.stringify(requestBody),
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

      // Try to extract error code from JSON response
      let errorCode: string | undefined
      try {
        const errorJson = JSON.parse(errorText)
        errorCode = errorJson.error?.code
      } catch (e) {
        // Not JSON or no error code, continue without it
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
                                      (errorTextLower.includes("schema") && errorTextLower.includes("not supported")) ||
                                      // Novita and other providers may return generic "model inference" errors
                                      // when they don't support structured output features
                                      (errorTextLower.includes("model inference") && errorTextLower.includes("error")) ||
                                      errorTextLower.includes("unknown error in the model"))
      if (isStructuredOutputError) {
        if (isDebugLLM()) {
          logLLM("🔴 Detected as structured output error")
        }
        const error = new Error(errorText)
        ;(error as any).isStructuredOutputError = true
        throw error
      }

      // Log if this is a json_validate_failed error (will be retried)
      if (errorCode === 'json_validate_failed' && isDebugLLM()) {
        logLLM("❌ json_validate_failed error detected, will be retried with exponential backoff")
      }

      throw new HttpError(response.status, response.statusText, errorText, undefined, errorCode)
    }

    const data = await response.json()

    if (isDebugLLM()) {
      logLLM("✅ HTTP 200 Response received", {
        hasError: !!data.error,
        hasChoices: !!data.choices,
        choicesCount: data.choices?.length,
        firstChoicePreview: data.choices?.[0] ? {
          hasMessage: !!data.choices[0].message,
          hasContent: !!data.choices[0].message?.content,
          contentType: typeof data.choices[0].message?.content,
          contentLength: data.choices[0].message?.content?.length || 0
        } : null
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
                                               // Novita and other providers may return generic errors
                                               errorMessageLower.includes("model inference") ||
                                               errorMessageLower.includes("unknown error in the model")

      // Enhanced debugging for structured output errors
      if ((error as any).isStructuredOutputError) {
        logLLM("⚠️ STRUCTURED OUTPUT ERROR DETECTED", {
          model: requestBody.model,
          errorMessage,
          responseFormat: requestBody.response_format,
          fullError: data.error
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
    frequency_penalty: 0.5,
    seed: 1,
  }

  if (!useStructuredOutput) {
    // No structured output requested, make simple call
    return apiCallWithRetry(async () => {
      return makeAPICallAttempt(baseURL, apiKey, baseRequestBody, estimatedTokens, sessionId)
    }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay, sessionId)
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
          if (isDebugLLM()) {
            logLLM("⚠️ JSON Schema mode FAILED for model", model, "- falling back to JSON Object mode")
            logLLM("Error details:", {
              message: error.message,
              stack: error.stack?.split('\n').slice(0, 3).join('\n')
            })
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
  }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay, sessionId)

}

/**
 * Make a fetch-based LLM call for Gemini API
 */
async function makeGeminiCall(
  messages: Array<{ role: string; content: string }>,
  sessionId?: string,
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

      // Try to extract error code from JSON response
      let errorCode: string | undefined
      try {
        const errorJson = JSON.parse(errorText)
        errorCode = errorJson.error?.code
      } catch (e) {
        // Not JSON or no error code, continue without it
      }

      if (isDebugLLM()) {
        logLLM("Gemini HTTP Error", {
          status: response.status,
          statusText: response.statusText,
          errorText,
          retryAfter,
          errorCode
        })
      }

      throw new HttpError(response.status, response.statusText, errorText, retryAfter, errorCode)
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
  }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay, sessionId)
}

/**
 * Helper function that performs the actual LLM call logic
 * This is wrapped by makeLLMCallWithFetch with retry logic
 */
async function makeLLMCallAttempt(
  messages: Array<{ role: string; content: string }>,
  chatProviderId: string,
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
    response = await makeGeminiCall(messages)
  } else {
    response = await makeOpenAICompatibleCall(messages, chatProviderId, true)
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
        const resp = jsonFromReasoning as LLMToolCallResponse
        if (resp.needsMoreWork === undefined && !resp.toolCalls) resp.needsMoreWork = true
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
    // If JSON lacks both toolCalls and needsMoreWork, default needsMoreWork to true (continue)
    const response = jsonObject as LLMToolCallResponse
    if (response.needsMoreWork === undefined && !response.toolCalls) {
      response.needsMoreWork = true
    }
    // Safety: If JSON says no more work but there are no toolCalls and the content
    // contains tool-call markers, override to needsMoreWork=true
    const toolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i
    const text = (response.content || "").replace(/<\|[^|]*\|>/g, "").trim()
    if (response.needsMoreWork === false && (!response.toolCalls || response.toolCalls.length === 0) && toolMarkers.test(text)) {
      response.needsMoreWork = true
    }

    if (isDebugLLM()) {
      logLLM("✅ Returning structured JSON response", {
        hasContent: !!response.content,
        hasToolCalls: !!response.toolCalls,
        toolCallsCount: response.toolCalls?.length || 0,
        needsMoreWork: response.needsMoreWork
      })
    }

    return response
  }

  // If no valid JSON found, decide conservatively based on content
  // If content contains tool-call markers, do NOT mark complete: keep needsMoreWork=true so the agent can iterate.
  const hasToolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i.test(content || "")
  const cleaned = (content || "").replace(/<\|[^|]*\|>/g, "").trim()
  if (hasToolMarkers) {
    if (isDebugLLM()) {
      logLLM("✅ Returning plain text with tool markers (needsMoreWork=true)")
    }
    return { content: cleaned, needsMoreWork: true }
  }
  // Otherwise, treat plain text as a final response
  if (isDebugLLM()) {
    logLLM("✅ Returning final plain text response (needsMoreWork=false)", {
      contentLength: (cleaned || content)?.length || 0
    })
  }
  return { content: cleaned || content, needsMoreWork: false }
}

/**
 * Main function to make LLM calls using fetch with automatic retry on empty responses
 */
export async function makeLLMCallWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
  sessionId?: string,
): Promise<LLMToolCallResponse> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || "openai"

  try {
    // Wrap the LLM call with retry logic to handle empty responses
    return await apiCallWithRetry(
      async () => makeLLMCallAttempt(messages, chatProviderId),
      config.apiRetryCount,
      config.apiRetryBaseDelay,
      config.apiRetryMaxDelay,
      sessionId
    )
  } catch (error) {
    diagnosticsService.logError("llm-fetch", "LLM call failed after all retries", error)
    throw error
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
