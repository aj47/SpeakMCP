/**
 * Network utilities for handling connection recovery and retries
 * Provides graceful error handling when network requests fail due to app backgrounding or disconnections
 */

import { AppState, AppStateStatus, Platform } from 'react-native';
import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';

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
 * Connection state for tracking network status
 */
export interface ConnectionState {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  appState: AppStateStatus;
}

/**
 * Callback for connection state changes
 */
export type ConnectionStateCallback = (state: ConnectionState) => void;

/**
 * Connection monitor singleton
 */
class ConnectionMonitor {
  private static instance: ConnectionMonitor;
  private netInfoUnsubscribe: NetInfoSubscription | null = null;
  private appStateSubscription: any = null;
  private listeners: Set<ConnectionStateCallback> = new Set();
  private currentState: ConnectionState = {
    isConnected: true,
    isInternetReachable: null,
    appState: AppState.currentState,
  };

  private constructor() {
    this.initialize();
  }

  static getInstance(): ConnectionMonitor {
    if (!ConnectionMonitor.instance) {
      ConnectionMonitor.instance = new ConnectionMonitor();
    }
    return ConnectionMonitor.instance;
  }

  private initialize() {
    // Subscribe to network info changes
    this.netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      this.updateState({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable,
      });
    });

    // Subscribe to app state changes
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      this.updateState({ appState: nextAppState });
    });
  }

  private updateState(partial: Partial<ConnectionState>) {
    const newState = { ...this.currentState, ...partial };
    const changed = 
      newState.isConnected !== this.currentState.isConnected ||
      newState.isInternetReachable !== this.currentState.isInternetReachable ||
      newState.appState !== this.currentState.appState;
    
    this.currentState = newState;
    
    if (changed) {
      this.notifyListeners();
    }
  }

  private notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener(this.currentState);
      } catch (err) {
        console.error('[ConnectionMonitor] Listener error:', err);
      }
    });
  }

  getState(): ConnectionState {
    return { ...this.currentState };
  }

  subscribe(callback: ConnectionStateCallback): () => void {
    this.listeners.add(callback);
    // Immediately notify with current state
    callback(this.currentState);
    
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Check if connection is healthy (connected and app is active)
   */
  isHealthy(): boolean {
    return this.currentState.isConnected && 
           this.currentState.appState === 'active' &&
           this.currentState.isInternetReachable !== false;
  }

  cleanup() {
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    this.listeners.clear();
  }
}

/**
 * Get the connection monitor singleton
 */
export function getConnectionMonitor(): ConnectionMonitor {
  return ConnectionMonitor.getInstance();
}

/**
 * Check if an error is retryable (network failure, timeout, etc.)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    const retryablePatterns = [
      'network request failed',
      'network error',
      'failed to fetch',
      'aborted',
      'timeout',
      'socket hang up',
      'econnreset',
      'econnrefused',
      'enotfound',
      'sse connection error',
      'sse connection failed',
      'connection closed',
      'connection lost',
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
 * Wait for connection to be restored
 */
export async function waitForConnection(timeoutMs: number = 30000): Promise<boolean> {
  const monitor = getConnectionMonitor();

  // Already connected
  if (monitor.isHealthy()) {
    return true;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);

    const unsubscribe = monitor.subscribe((state) => {
      if (state.isConnected && state.appState === 'active' && state.isInternetReachable !== false) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(true);
      }
    });
  });
}

/**
 * Execute an async operation with retry logic
 */
export async function withRetry<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  config: RetryConfig = {},
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
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

/**
 * Streaming state for recovery
 */
export interface StreamingState {
  messageId: string;
  userMessage: string;
  partialContent: string;
  lastProgressUpdate?: any;
  startedAt: number;
  lastUpdateAt: number;
}

/**
 * In-memory storage for active streaming state (for recovery)
 */
const activeStreams = new Map<string, StreamingState>();

export function setStreamingState(state: StreamingState): void {
  activeStreams.set(state.messageId, state);
}

export function getStreamingState(messageId: string): StreamingState | undefined {
  return activeStreams.get(messageId);
}

export function clearStreamingState(messageId: string): void {
  activeStreams.delete(messageId);
}

export function getActiveStreamingStates(): StreamingState[] {
  return Array.from(activeStreams.values());
}

