import { configStore } from "./config"
import { MCPTool, LLMToolCallResponse } from "./mcp-service"
import { diagnosticsService } from "./diagnostics"
import { isDebugLLM, logLLM } from "./debug"

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
  if (error instanceof HttpError) {
    // Retry on rate limits (429), server errors (5xx), and some client errors
    return error.status === 429 ||
           (error.status >= 500 && error.status < 600) ||
           error.status === 408 || // Request Timeout
           error.status === 502 || // Bad Gateway
           error.status === 503 || // Service Unavailable
           error.status === 504    // Gateway Timeout
  }

  // Retry on network errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return message.includes('network') ||
           message.includes('timeout') ||
           message.includes('connection') ||
           message.includes('fetch')
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
): Promise<T> {
  let lastError: unknown
  let attempt = 0

  while (true) {
    try {
      const response = await call()
      return response
    } catch (error) {
      lastError = error

      // Check if error is retryable
      if (!isRetryableError(error)) {
        diagnosticsService.logError(
          "llm-fetch",
          "Non-retryable API error",
          error,
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

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay))
        attempt++
        continue
      }

      // For other retryable errors, respect the retry limit
      if (attempt >= retryCount) {
        diagnosticsService.logError(
          "llm-fetch",
          "API call failed after all retries",
          lastError,
        )
        throw lastError
      }

      // Calculate delay for this attempt
      const delay = calculateBackoffDelay(attempt, baseDelay, maxDelay)

      diagnosticsService.logError(
        "llm-fetch",
        `API call failed, retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retryCount + 1})`,
        { error: error instanceof Error ? error.message : String(error), delay }
      )

      // Wait before retrying
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
        ? config.mcpToolsGroqModel || "llama-3.1-70b-versatile"
        : config.transcriptPostProcessingGroqModel || "llama-3.1-70b-versatile"
    case "gemini":
      return config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
    case "cerebras":
      return type === "mcp"
        ? config.mcpToolsCerebrasModel || "llama3.1-8b"
        : config.transcriptPostProcessingCerebrasModel || "llama3.1-8b"
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
      model.includes("gemma")
    )
  }

  // Cerebras models that support JSON mode (most Llama models do)
  if (providerId === "cerebras") {
    return model.includes("llama")
  }

  // Conservative default - assume no JSON mode support
  return false
}

/**
 * Make a fetch-based LLM call for OpenAI-compatible APIs
 */
async function makeOpenAICompatibleCall(
  messages: Array<{ role: string; content: string }>,
  providerId: string,
  useStructuredOutput: boolean = true,
): Promise<any> {
  const config = configStore.get()

  let baseURL: string
  let apiKey: string | undefined

  switch (providerId) {
    case "groq":
      baseURL = config.groqBaseUrl || "https://api.groq.com/openai/v1"
      apiKey = config.groqApiKey
      break
    case "cerebras":
      baseURL = config.cerebrasBaseUrl || "https://api.cerebras.ai/v1"
      apiKey = config.cerebrasApiKey
      break
    case "openai":
    default:
      baseURL = config.openaiBaseUrl || "https://api.openai.com/v1"
      apiKey = config.openaiApiKey
      break
  }

  if (!apiKey) {
    throw new Error(`API key is required for ${providerId}`)
  }

  const model = getModel(providerId, "mcp")

  const requestBody: any = {
    model,
    messages,
    temperature: 0,
    frequency_penalty: 0.5,
    seed: 1,
  }

  // Add structured output for supported models
  if (useStructuredOutput && supportsJsonMode(model, providerId)) {
    requestBody.response_format = { type: "json_object" }
  }

  // Estimate tokens (rough approximation: 4 chars per token)
    const estimatedTokens = Math.ceil(messages.reduce((sum, msg) => sum + msg.content.length, 0) / 4);

    return apiCallWithRetry(async () => {
    if (isDebugLLM()) {
      logLLM("=== OPENAI API REQUEST ===")
      logLLM("HTTP Request", {
        url: `${baseURL}/chat/completions`,
        model,
        messagesCount: messages.length,
        useStructuredOutput,
        estimatedTokens,
        totalPromptLength: messages.reduce((sum, msg) => sum + msg.content.length, 0),
        contextWarning: estimatedTokens > 8000 ? "WARNING: High token count, may exceed context limit" : null
      })
      logLLM("Request Body (truncated)", {
        ...requestBody,
        messages: requestBody.messages.map(msg => ({
          role: msg.role,
          content: msg.content.length > 200 ?
            msg.content.substring(0, 200) + "... [" + msg.content.length + " chars]" :
            msg.content
        }))
      })
    }
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

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
        logLLM("=== HTTP ERROR ===")
        logLLM("HTTP Error Details:", {
          status: response.status,
          statusText: response.statusText,
          errorText,
          retryAfter,
          estimatedTokens,
          model: requestBody.model
        })

        // Parse error for context length specifically
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.code === "context_length_exceeded") {
            logLLM("CONTEXT LENGTH ERROR DETECTED", {
              message: errorJson.error.message,
              suggestedActions: [
                "Reduce conversation history",
                "Use a model with larger context",
                "Split the request into smaller chunks"
              ]
            })
          }
        } catch (e) {
          // Keep original error if not JSON
        }
      }

      throw new HttpError(response.status, response.statusText, errorText, retryAfter)
    }

    const data = await response.json()

    if (data.error) {
      if (isDebugLLM()) {
        logLLM("API Error", data.error)
      }
      throw new Error(data.error.message)
    }

    if (isDebugLLM()) {
      logLLM("HTTP Response", data)
    }

    return data
  }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay)
}

/**
 * Make a fetch-based LLM call for Gemini API
 */
async function makeGeminiCall(
  messages: Array<{ role: string; content: string }>,
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
  }, config.apiRetryCount, config.apiRetryBaseDelay, config.apiRetryMaxDelay)
}

/**
 * Main function to make LLM calls using fetch
 */
export async function makeLLMCallWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
): Promise<LLMToolCallResponse> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || "openai"

  try {
    let response: any

    if (chatProviderId === "gemini") {
      response = await makeGeminiCall(messages)
    } else {
      // OpenAI, Groq, and Cerebras all use OpenAI-compatible APIs
      response = await makeOpenAICompatibleCall(messages, chatProviderId, true)
    }

    if (isDebugLLM()) {
      logLLM("Raw API response structure:", {
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length,
        firstChoiceExists: !!response.choices?.[0],
        hasMessage: !!response.choices?.[0]?.message,
        hasContent: !!response.choices?.[0]?.message?.content
      })
    }

    const content = response.choices[0]?.message.content?.trim()
    if (!content) {
      if (isDebugLLM()) {
        logLLM("Empty response details:", {
          response: response,
          choices: response.choices,
          firstChoice: response.choices?.[0],
          message: response.choices?.[0]?.message,
          content: response.choices?.[0]?.message?.content
        })
      }

      // Instead of throwing an error, return a response that indicates completion
      // This handles cases where the LLM returns empty content but the call was successful
      return { content: "", needsMoreWork: false }
    }

    // Try to extract JSON object from response
    const jsonObject = extractJsonObject(content)
    if (isDebugLLM()) {
      logLLM("Extracted JSON object", jsonObject)
      logLLM("JSON object has toolCalls:", !!jsonObject?.toolCalls)
      logLLM("JSON object has content:", !!jsonObject?.content)
    }
    if (jsonObject && (jsonObject.toolCalls || jsonObject.content)) {
      // If JSON lacks both toolCalls and needsMoreWork, default needsMoreWork to true (continue)
      const response = jsonObject as LLMToolCallResponse
      if (response.needsMoreWork === undefined && !response.toolCalls) {
        response.needsMoreWork = true
      }
      return response
    }

    // If no valid JSON found, treat as a final response
    // Plain text responses are typically final answers
    return { content, needsMoreWork: false }
  } catch (error) {
    diagnosticsService.logError("llm-fetch", "LLM call failed", error)
    throw error
  }
}

/**
 * Make a simple text completion call
 */
export async function makeTextCompletionWithFetch(
  prompt: string,
  providerId?: string,
): Promise<string> {
  const config = configStore.get()
  const chatProviderId =
    providerId || config.transcriptPostProcessingProviderId || "openai"

  const messages = [
    {
      role: "system",
      content: prompt,
    },
  ]

  try {
    let response: any

    if (chatProviderId === "gemini") {
      response = await makeGeminiCall(messages)
    } else {
      // OpenAI, Groq, and Cerebras all use OpenAI-compatible APIs
      response = await makeOpenAICompatibleCall(messages, chatProviderId, false)
    }

    return response.choices[0]?.message.content?.trim() || ""
  } catch (error) {
    diagnosticsService.logError("llm-fetch", "Text completion failed", error)
    throw error
  }
}
