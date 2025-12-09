/**
 * Connection Recovery Module for Mobile App
 * Handles automatic reconnection with exponential backoff for streaming connections.
 * Implements heartbeat/ping mechanism and provides user-friendly status updates.
 */

import { AppState, AppStateStatus } from 'react-native';

export type ConnectionStatus = 
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export type ConnectionRecoveryConfig = {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  heartbeatIntervalMs: number;
  connectionTimeoutMs: number;
};

export const DEFAULT_RECOVERY_CONFIG: ConnectionRecoveryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  heartbeatIntervalMs: 30000,
  connectionTimeoutMs: 30000,
};

export type RecoveryState = {
  status: ConnectionStatus;
  retryCount: number;
  lastError?: string;
  isAppActive: boolean;
};

export type OnStatusChange = (state: RecoveryState) => void;

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoff(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential backoff: delay = initial * 2^attempt
  const exponentialDelay = initialDelayMs * Math.pow(2, attempt);
  // Add jitter (±20%)
  const jitter = exponentialDelay * (0.8 + Math.random() * 0.4);
  return Math.min(jitter, maxDelayMs);
}

/**
 * Check if an error is retryable (network-related)
 */
export function isRetryableError(error: Error | string): boolean {
  const message = typeof error === 'string' ? error : error.message;
  const lowered = message.toLowerCase();
  
  const retryablePatterns = [
    'network',
    'timeout',
    'connection',
    'aborted',
    'sse connection',
    'fetch failed',
    'failed to fetch',
    'network request failed',
    'unable to resolve host',
    'socket',
    'econnrefused',
    'econnreset',
    'etimedout',
    'enetunreach',
    'internet',
  ];
  
  return retryablePatterns.some(pattern => lowered.includes(pattern));
}

/**
 * ConnectionRecoveryManager handles automatic reconnection logic
 */
export class ConnectionRecoveryManager {
  private config: ConnectionRecoveryConfig;
  private state: RecoveryState;
  private onStatusChange?: OnStatusChange;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private abortController: AbortController | null = null;
  private lastHeartbeat: number = Date.now();

  constructor(
    config: Partial<ConnectionRecoveryConfig> = {},
    onStatusChange?: OnStatusChange
  ) {
    this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
    this.onStatusChange = onStatusChange;
    this.state = {
      status: 'disconnected',
      retryCount: 0,
      isAppActive: AppState.currentState === 'active',
    };
    
    this.setupAppStateListener();
  }

  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange
    );
  }

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    const wasActive = this.state.isAppActive;
    const isNowActive = nextAppState === 'active';
    
    this.state.isAppActive = isNowActive;
    
    console.log('[ConnectionRecovery] App state changed:', {
      wasActive,
      isNowActive,
      currentStatus: this.state.status,
    });

    // If app returned to foreground and we were disconnected, trigger recovery
    if (!wasActive && isNowActive && this.state.status === 'disconnected') {
      console.log('[ConnectionRecovery] App returned to foreground, may need recovery');
      this.updateStatus('reconnecting');
    }
  };

  private updateStatus(status: ConnectionStatus, error?: string): void {
    this.state.status = status;
    if (error) this.state.lastError = error;
    
    console.log('[ConnectionRecovery] Status update:', {
      status,
      retryCount: this.state.retryCount,
      error,
    });
    
    this.onStatusChange?.({ ...this.state });
  }

  getState(): RecoveryState {
    return { ...this.state };
  }

  getAbortSignal(): AbortSignal {
    this.abortController = new AbortController();
    return this.abortController.signal;
  }

  /**
   * Start heartbeat monitoring for the connection
   */
  startHeartbeat(onHeartbeatMissed: () => void): void {
    this.stopHeartbeat();
    this.lastHeartbeat = Date.now();

    this.heartbeatTimer = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;

      // Only check heartbeat when app is active
      if (!this.state.isAppActive) return;

      if (timeSinceLastHeartbeat > this.config.connectionTimeoutMs) {
        console.log('[ConnectionRecovery] Heartbeat missed:', {
          timeSinceLastHeartbeat,
          threshold: this.config.connectionTimeoutMs,
        });
        onHeartbeatMissed();
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Record a heartbeat (call when data is received)
   */
  recordHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  /**
   * Stop heartbeat monitoring
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Mark connection as established
   */
  markConnected(): void {
    this.state.retryCount = 0;
    this.state.lastError = undefined;
    this.updateStatus('connected');
  }

  /**
   * Mark connection as disconnected
   */
  markDisconnected(error?: string): void {
    this.updateStatus('disconnected', error);
  }

  /**
   * Check if we should retry the connection
   */
  shouldRetry(): boolean {
    return this.state.retryCount < this.config.maxRetries && this.state.isAppActive;
  }

  /**
   * Increment retry count and get the delay before next retry
   */
  prepareRetry(): number {
    this.state.retryCount++;
    this.updateStatus('reconnecting');
    return calculateBackoff(
      this.state.retryCount - 1,
      this.config.initialDelayMs,
      this.config.maxDelayMs
    );
  }

  /**
   * Mark the connection as failed (no more retries)
   */
  markFailed(error: string): void {
    this.updateStatus('failed', error);
  }

  /**
   * Reset the recovery state for a new connection attempt
   */
  reset(): void {
    this.state.retryCount = 0;
    this.state.lastError = undefined;
    this.updateStatus('connecting');
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Abort any ongoing connection
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stopHeartbeat();
    this.abort();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }
}

/**
 * Create a delay promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format connection status for display
 */
export function formatConnectionStatus(state: RecoveryState): string {
  switch (state.status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'reconnecting':
      return `Reconnecting... (attempt ${state.retryCount})`;
    case 'disconnected':
      return 'Disconnected';
    case 'failed':
      return `Connection failed: ${state.lastError || 'Unknown error'}`;
    default:
      return 'Unknown';
  }
}

