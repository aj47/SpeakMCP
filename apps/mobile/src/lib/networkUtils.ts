/**
 * Network utilities for handling retries and app state changes
 * Provides graceful error handling when network requests fail due to app backgrounding
 */

import { AppState, AppStateStatus, Platform } from 'react-native';

export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Error class for network failures that can be retried
 */
export class RetryableNetworkError extends Error {
  public readonly isRetryable: boolean = true;
  public readonly originalError: Error;

  constructor(message: string, originalError: Error) {
    super(message);
    this.name = 'RetryableNetworkError';
    this.originalError = originalError;
  }
}

/**
 * Check if an error is retryable (network failure, timeout, etc.)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();
    
    // Common network error patterns
    const retryablePatterns = [
      'network request failed',
      'network error',
      'failed to fetch',
      'aborted',
      'aborterror',
      'timeout',
      'socket hang up',
      'econnreset',
      'econnrefused',
      'enotfound',
      'sse connection error',
      'sse connection failed',
    ];
    
    return retryablePatterns.some(pattern => 
      message.includes(pattern) || name.includes(pattern)
    );
  }
  return false;
}

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // Add up to 30% jitter
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Wait for a specified duration
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create an AbortController that aborts when the app goes to background
 * Returns the controller and a cleanup function
 */
export function createAppStateAwareAbortController(): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  
  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      console.log('[NetworkUtils] App went to background, aborting in-flight request');
      controller.abort();
    }
  };

  const subscription = AppState.addEventListener('change', handleAppStateChange);

  return {
    controller,
    cleanup: () => {
      subscription.remove();
    },
  };
}

/**
 * Execute an async operation with retry logic
 */
export async function withRetry<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  config: RetryConfig = {},
  onRetry?: (attempt: number, error: Error) => void,
  signal?: AbortSignal
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation(signal);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry if not a retryable error or we've exhausted retries
      if (!isRetryableError(error) || attempt >= maxRetries) {
        throw lastError;
      }

      // Notify about retry
      onRetry?.(attempt + 1, lastError);
      
      // Wait before retrying
      const delayMs = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);
      console.log(`[NetworkUtils] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delayMs)}ms`);
      await delay(delayMs);
    }
  }

  throw lastError || new Error('Unknown error during retry');
}

