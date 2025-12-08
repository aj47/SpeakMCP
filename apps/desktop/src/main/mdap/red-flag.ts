/**
 * MDAP Red-Flagging System
 * Detects suspicious responses that indicate pathological LLM behavior
 * and triggers resampling to reduce correlated errors
 */

import { RedFlagResult, MDAPConfig, DEFAULT_MDAP_CONFIG } from './types'
import { logApp } from '../debug'

/**
 * Red flag detection patterns
 */
const RED_FLAG_PATTERNS = {
  // Format violations
  formatViolations: [
    /^\s*$/, // Empty response
    /^(?:I|As an AI|I'm sorry|I cannot|I don't|I am not able)/i, // Refusal patterns
    /^(undefined|null|NaN|error)$/i, // Error values
    /^\[object/i, // JavaScript object string
  ],

  // Hallucination indicators
  hallucinationPatterns: [
    /I (?:believe|think|assume|guess) (?:that )?(?:the answer|it)/i,
    /(?:probably|maybe|perhaps|might be|could be) (?:around|about|approximately)/i,
    /I'm not (?:sure|certain) but/i,
    /Let me (?:guess|estimate|speculate)/i,
  ],

  // Repetition patterns (sign of model getting stuck)
  repetitionPatterns: [
    /(\b\w+\b)(?:\s+\1){3,}/i, // Same word repeated 4+ times
    /(.{20,})\1{2,}/i, // Same phrase repeated 3+ times
  ],

  // Incomplete response patterns
  incompletePatterns: [
    /\.\.\.$/, // Ends with ellipsis
    /(?:continue|to be continued|more to come)$/i,
    /^(?:step \d+|part \d+)$/i, // Only shows step number
  ],
}

/**
 * Checks a response for red flags
 */
export function checkRedFlags(
  response: string,
  config: Partial<MDAPConfig> = {}
): RedFlagResult {
  const fullConfig = { ...DEFAULT_MDAP_CONFIG, ...config }

  // Check response length (token count approximation)
  const estimatedTokens = Math.ceil(response.length / 4)
  if (estimatedTokens > fullConfig.maxResponseTokens) {
    logApp(`[MDAP Red-Flag] Response too long: ${estimatedTokens} tokens`)
    return {
      isRedFlagged: true,
      reason: 'response_too_long',
      details: `Response has ~${estimatedTokens} tokens, exceeds limit of ${fullConfig.maxResponseTokens}`,
    }
  }

  // Check for format violations
  if (fullConfig.enableFormatValidation) {
    for (const pattern of RED_FLAG_PATTERNS.formatViolations) {
      if (pattern.test(response.trim())) {
        logApp(`[MDAP Red-Flag] Format violation detected`)
        return {
          isRedFlagged: true,
          reason: 'format_violation',
          details: `Response matches format violation pattern`,
        }
      }
    }
  }

  // Check for hallucination indicators
  for (const pattern of RED_FLAG_PATTERNS.hallucinationPatterns) {
    if (pattern.test(response)) {
      logApp(`[MDAP Red-Flag] Hallucination indicator detected`)
      return {
        isRedFlagged: true,
        reason: 'hallucination_detected',
        details: `Response contains uncertainty/guessing language`,
      }
    }
  }

  // Check for repetition (model getting stuck)
  for (const pattern of RED_FLAG_PATTERNS.repetitionPatterns) {
    if (pattern.test(response)) {
      logApp(`[MDAP Red-Flag] Repetition pattern detected`)
      return {
        isRedFlagged: true,
        reason: 'repetition_detected',
        details: `Response contains excessive repetition`,
      }
    }
  }

  // Check for incomplete responses
  for (const pattern of RED_FLAG_PATTERNS.incompletePatterns) {
    if (pattern.test(response.trim())) {
      logApp(`[MDAP Red-Flag] Incomplete response detected`)
      return {
        isRedFlagged: true,
        reason: 'format_violation',
        details: `Response appears incomplete`,
      }
    }
  }

  return {
    isRedFlagged: false,
  }
}

/**
 * Analyzes a batch of responses to detect correlated errors
 * Returns true if the batch shows signs of systematic failure
 */
export function detectCorrelatedErrors(
  responses: Array<{ response: string; isRedFlagged: boolean }>
): {
  hasCorrelatedErrors: boolean
  correlationType?: string
  recommendation?: string
} {
  if (responses.length < 2) {
    return { hasCorrelatedErrors: false }
  }

  const flaggedCount = responses.filter(r => r.isRedFlagged).length
  const flaggedRatio = flaggedCount / responses.length

  // High ratio of red-flagged responses indicates systematic issues
  if (flaggedRatio > 0.7) {
    return {
      hasCorrelatedErrors: true,
      correlationType: 'high_failure_rate',
      recommendation: 'Consider reformulating the subtask or using a different model',
    }
  }

  // Check if all non-flagged responses are identical (suspicious)
  const validResponses = responses
    .filter(r => !r.isRedFlagged)
    .map(r => r.response.trim().toLowerCase())

  if (validResponses.length > 1) {
    const uniqueResponses = new Set(validResponses)
    if (uniqueResponses.size === 1) {
      // All identical - could be correct, but also could be systematic error
      return {
        hasCorrelatedErrors: false, // Not necessarily an error
        correlationType: 'unanimous_agreement',
        recommendation: 'All responses agree - likely correct',
      }
    }
  }

  // Check for similar error messages
  const errorMessages = responses
    .filter(r => r.isRedFlagged)
    .map(r => extractErrorType(r.response))

  const errorCounts = new Map<string, number>()
  for (const error of errorMessages) {
    errorCounts.set(error, (errorCounts.get(error) || 0) + 1)
  }

  // If same error type appears multiple times
  for (const [errorType, count] of errorCounts) {
    if (count >= 2 && count / errorMessages.length > 0.5) {
      return {
        hasCorrelatedErrors: true,
        correlationType: `repeated_error:${errorType}`,
        recommendation: `Systematic ${errorType} errors - consider adjusting the prompt`,
      }
    }
  }

  return { hasCorrelatedErrors: false }
}

/**
 * Extracts error type from response for correlation analysis
 */
function extractErrorType(response: string): string {
  const lower = response.toLowerCase()

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout'
  }
  if (lower.includes('permission') || lower.includes('access denied')) {
    return 'permission'
  }
  if (lower.includes('not found') || lower.includes('does not exist')) {
    return 'not_found'
  }
  if (lower.includes('invalid') || lower.includes('malformed')) {
    return 'invalid_input'
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'rate_limit'
  }
  if (/^\s*$/.test(response)) {
    return 'empty_response'
  }

  return 'unknown'
}

/**
 * Scores the quality of a response for voting purposes
 * Higher scores indicate more trustworthy responses
 */
export function scoreResponseQuality(response: string): number {
  let score = 100 // Start at max

  // Penalize very short responses
  if (response.length < 10) {
    score -= 30
  }

  // Penalize very long responses (more room for error)
  if (response.length > 2000) {
    score -= 10
  }

  // Penalize uncertainty language
  if (/\b(maybe|perhaps|might|could|probably|possibly)\b/i.test(response)) {
    score -= 15
  }

  // Penalize self-referential language
  if (/\b(I think|I believe|in my opinion)\b/i.test(response)) {
    score -= 10
  }

  // Reward structured responses
  if (/^\s*\{[\s\S]*\}\s*$/.test(response)) {
    score += 10 // Valid JSON structure
  }

  // Reward concise, direct answers
  if (response.length > 20 && response.length < 500) {
    score += 5
  }

  // Penalize error-like patterns
  if (/error|exception|failed|unable to/i.test(response)) {
    score -= 20
  }

  return Math.max(0, Math.min(100, score))
}

/**
 * Determines if a response should be retried based on red flag analysis
 */
export function shouldRetry(
  redFlagResult: RedFlagResult,
  retryCount: number,
  maxRetries: number = 3
): boolean {
  if (!redFlagResult.isRedFlagged) {
    return false
  }

  if (retryCount >= maxRetries) {
    return false
  }

  // Some red flags are more retryable than others
  switch (redFlagResult.reason) {
    case 'response_too_long':
      return true // Often works on retry with different sampling
    case 'format_violation':
      return retryCount < 2 // Try twice
    case 'hallucination_detected':
      return false // Unlikely to improve on retry
    case 'repetition_detected':
      return true // Can break out of repetition
    default:
      return true
  }
}
