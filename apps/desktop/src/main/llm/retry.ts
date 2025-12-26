/**
 * Generic retry utility with exponential backoff
 * Reusable by LLM providers, MCP, remote servers, etc.
 */

import { diagnosticsService } from "../diagnostics"
import { state } from "../state"
import type { RetryProgressCallback } from "./types"

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Number of retry attempts (default: 3) */
  retryCount?: number
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelay?: number
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelay?: number
  /** Callback for retry progress reporting */
  onRetryProgress?: RetryProgressCallback
  /** Custom function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean
  /** Custom function to extract retry-after header value */
  getRetryAfter?: (error: unknown) => number | undefined
  /** Log category for diagnostics (default: "retry") */
  logCategory?: string
  /** Whether to check global stop flag (default: true) */
  checkStopFlag?: boolean
}

/**
 * Enhanced error class for HTTP errors with status code and retry information
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public responseText: string,
    public retryAfter?: number,
  ) {
    super(HttpError.createUserFriendlyMessage(status, statusText, responseText, retryAfter))
    this.name = "HttpError"
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
        let errorDetail = ""
        try {
          const errorJson = JSON.parse(responseText)
          if (errorJson.error?.message) {
            errorDetail = errorJson.error.message
          }
        } catch {
          errorDetail = responseText
        }

        const lowerDetail = errorDetail.toLowerCase()
        if (lowerDetail.includes("model") || lowerDetail.includes("does not exist") || lowerDetail.includes("not found")) {
          return `Invalid model name. The specified model does not exist or is not available. Please check your model settings and ensure the model name is correct. Error details: ${errorDetail}`
        }

        if (lowerDetail.includes("tool choice is none") || lowerDetail.includes("tool_choice")) {
          return `The model attempted to use tools but tool calling is not enabled for this request. This can happen with certain prompts. Try rephrasing your request.`
        }

        return `Bad request. The API rejected the request. ${errorDetail ? `Error details: ${errorDetail}` : "Please check your configuration."}`
      }

      case 429: {
        const waitTime = retryAfter ? `${retryAfter} seconds` : "a moment"
        return `Rate limit exceeded. The API is temporarily unavailable due to too many requests. We'll automatically retry after waiting ${waitTime}. You don't need to do anything - just wait for the request to complete.`
      }

      case 401:
        return "Authentication failed. Please check your API key configuration."

      case 403:
        return "Access forbidden. Your API key may not have permission to access this resource."

      case 404:
        return "API endpoint not found. Please check your base URL configuration."

      case 408:
        return "Request timeout. The API took too long to respond."

      case 500:
        return "Internal server error. The API service is experiencing issues."

      case 502:
        return "Bad gateway. There may be a temporary issue with the API service."

      case 503:
        return "Service unavailable. The API service is temporarily down for maintenance."

      case 504:
        return "Gateway timeout. The API service is not responding."

      default: {
        try {
          const errorJson = JSON.parse(responseText)
          if (errorJson.error?.message) {
            return `API Error: ${errorJson.error.message}`
          }
        } catch {
          // If response is not JSON, use the raw response
        }

        return `HTTP ${status}: ${responseText || statusText}`
      }
    }
  }
}

/**
 * Check if an error is retryable based on status code and error type
 */
export function isRetryableError(error: unknown): boolean {
  // Abort should never be retried
  if (error instanceof Error) {
    if ((error as { name?: string }).name === "AbortError" || error.message.toLowerCase().includes("abort")) {
      return false
    }
  }

  if (error instanceof HttpError) {
    return error.status === 429 ||
           (error.status >= 500 && error.status < 600) ||
           error.status === 408 ||
           error.status === 502 ||
           error.status === 503 ||
           error.status === 504
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    return message.includes("network") ||
           message.includes("timeout") ||
           message.includes("connection") ||
           message.includes("fetch") ||
           message.includes("empty response") ||
           message.includes("empty content") ||
           message.includes("cloudflare") ||
           message.includes("gateway")
  }

  return false
}

/**
 * Calculate delay for exponential backoff with jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt)

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay)

  // Add jitter (±25% randomization) to avoid thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1)

  return Math.max(0, cappedDelay + jitter)
}

/**
 * Generic retry utility with exponential backoff
 *
 * Rate limit errors (429) will retry indefinitely until successful.
 * Other errors respect the retry count limit.
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetchData(),
 *   { retryCount: 3, baseDelay: 1000 }
 * )
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retryCount = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    onRetryProgress,
    isRetryable = isRetryableError,
    getRetryAfter,
    logCategory = "retry",
    checkStopFlag = true,
  } = options

  let lastError: unknown
  let attempt = 0

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
    if (checkStopFlag && state.shouldStopAgent) {
      clearRetryStatus()
      throw lastError instanceof Error ? lastError : new Error("Aborted by emergency stop")
    }

    try {
      const response = await fn()
      clearRetryStatus()
      return response
    } catch (error) {
      lastError = error

      // Do not retry on abort or if we've been asked to stop
      if ((error as { name?: string })?.name === "AbortError" || (checkStopFlag && state.shouldStopAgent)) {
        clearRetryStatus()
        throw error
      }

      // Check if error is retryable
      if (!isRetryable(error)) {
        diagnosticsService.logError(
          logCategory,
          "Non-retryable error",
          {
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof HttpError ? "HttpError" : error instanceof Error ? "Error" : typeof error,
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
        const retryAfterValue = getRetryAfter?.(error) ?? error.retryAfter
        if (retryAfterValue) {
          delay = retryAfterValue * 1000
          delay = Math.min(delay, maxDelay)
        }

        const waitTimeSeconds = Math.round(delay / 1000)

        diagnosticsService.logError(
          logCategory,
          `Rate limit encountered (429). Waiting ${waitTimeSeconds}s before retry (attempt ${attempt + 1})`,
          {
            status: error.status,
            retryAfter: retryAfterValue,
            delay,
            message: "Rate limits are temporary - will keep retrying until successful"
          }
        )

        if (onRetryProgress) {
          onRetryProgress({
            isRetrying: true,
            attempt: attempt + 1,
            maxAttempts: undefined,
            delaySeconds: waitTimeSeconds,
            reason: "Rate limit exceeded",
            startedAt: Date.now(),
          })
        }

        if (checkStopFlag && state.shouldStopAgent) {
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
          logCategory,
          "Call failed after all retries",
          {
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof HttpError ? "HttpError" : error instanceof Error ? "Error" : typeof error,
            status: error instanceof HttpError ? error.status : undefined,
            attempts: attempt + 1,
            maxRetries: retryCount + 1,
          },
        )
        clearRetryStatus()
        throw lastError
      }

      const delay = calculateBackoffDelay(attempt, baseDelay, maxDelay)

      diagnosticsService.logWarning(
        logCategory,
        `Call failed, retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retryCount + 1})`,
        {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof HttpError ? "HttpError" : error instanceof Error ? "Error" : typeof error,
          status: error instanceof HttpError ? error.status : undefined,
          delay,
          attempt: attempt + 1,
          maxRetries: retryCount + 1,
        }
      )

      const reason = error instanceof HttpError
        ? `HTTP ${error.status} error`
        : "Network error"

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

      if (checkStopFlag && state.shouldStopAgent) {
        clearRetryStatus()
        throw new Error("Aborted by emergency stop")
      }
      await new Promise(resolve => setTimeout(resolve, delay))
      attempt++
    }
  }
}

/**
 * Alias for withRetry for backwards compatibility
 * @deprecated Use withRetry instead
 */
export const apiCallWithRetry = withRetry
