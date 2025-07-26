import { diagnosticsService } from '../diagnostics'
import { ERROR_MESSAGES, RECOVERY_SUGGESTIONS, RETRY_CONFIG } from '../../shared/constants'

/**
 * Standardized error handling utilities to reduce code duplication
 */

export interface ErrorContext {
  component: string
  operation: string
  metadata?: Record<string, any>
}

/**
 * Generic retry function with consistent error handling
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  maxAttempts: number = RETRY_CONFIG.DEFAULT_ATTEMPTS
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts
      
      if (isLastAttempt) {
        const errorMessage = `${context.operation} failed after ${maxAttempts} attempts`
        diagnosticsService.logError(context.component, errorMessage, error)
        throw error
      }
      
      // Log retry attempt
      diagnosticsService.logError(
        context.component, 
        `${context.operation} failed on attempt ${attempt}/${maxAttempts}, retrying...`, 
        error
      )
    }
  }
  
  throw new Error(ERROR_MESSAGES.UNEXPECTED_RETRY_ERROR)
}

/**
 * Standardized timeout wrapper
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = ERROR_MESSAGES.CONNECTION_TIMEOUT
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  
  return Promise.race([promise, timeoutPromise])
}

/**
 * Analyze error and provide recovery suggestions
 */
export function analyzeError(error: Error | string): {
  errorType: string
  suggestion: string
} {
  const errorMessage = typeof error === 'string' ? error : error.message
  const lowerMessage = errorMessage.toLowerCase()
  
  if (lowerMessage.includes('session not found')) {
    return {
      errorType: 'session_lost',
      suggestion: RECOVERY_SUGGESTIONS.SESSION_LOST
    }
  }
  
  if (lowerMessage.includes('timeout') || lowerMessage.includes('connection')) {
    return {
      errorType: 'connectivity',
      suggestion: RECOVERY_SUGGESTIONS.CONNECTIVITY
    }
  }
  
  if (lowerMessage.includes('permission') || lowerMessage.includes('access')) {
    return {
      errorType: 'permissions',
      suggestion: RECOVERY_SUGGESTIONS.PERMISSIONS
    }
  }
  
  if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
    return {
      errorType: 'resource_missing',
      suggestion: RECOVERY_SUGGESTIONS.RESOURCE_MISSING
    }
  }
  
  return {
    errorType: 'unknown',
    suggestion: 'Please check the error details and try again'
  }
}

/**
 * Format error for user display
 */
export function formatErrorForUser(
  toolName: string,
  error: Error | string,
  includeSuggestion: boolean = true
): string {
  const errorText = typeof error === 'string' ? error : error.message
  const { suggestion } = analyzeError(error)
  
  const baseMessage = `- ${toolName}: ${errorText}`
  
  if (includeSuggestion && suggestion) {
    return `${baseMessage} (Suggestion: ${suggestion})`
  }
  
  return baseMessage
}

/**
 * Standardized service result type
 */
export interface ServiceResult<T = any> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Wrap service operations with consistent error handling
 */
export async function wrapServiceOperation<T>(
  operation: () => Promise<T>,
  context: ErrorContext
): Promise<ServiceResult<T>> {
  try {
    const data = await operation()
    return { success: true, data }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    diagnosticsService.logError(context.component, `${context.operation} failed`, error)
    return { success: false, error: errorMessage }
  }
}

/**
 * Create a standardized error with context
 */
export function createContextualError(
  message: string,
  context: ErrorContext,
  originalError?: Error
): Error {
  const contextualMessage = `[${context.component}:${context.operation}] ${message}`
  const error = new Error(contextualMessage)
  
  if (originalError) {
    error.cause = originalError
    error.stack = originalError.stack
  }
  
  return error
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: Error | string): boolean {
  const errorMessage = typeof error === 'string' ? error : error.message
  const lowerMessage = errorMessage.toLowerCase()
  
  // Don't retry on these errors
  const nonRetryablePatterns = [
    'permission denied',
    'access denied',
    'unauthorized',
    'forbidden',
    'not found',
    'invalid credentials',
    'authentication failed'
  ]
  
  return !nonRetryablePatterns.some(pattern => lowerMessage.includes(pattern))
}
