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

export function isRetryableError(error: Error | string): boolean {
  const message = typeof error === 'string' ? error : error.message;
  const lowered = message.toLowerCase();

  // Non-retryable patterns - user-initiated cancellations should not trigger retry
  const nonRetryablePatterns = [
    'cancelled',
    'canceled',
    'user abort',
    'abortcontroller',
  ];

  if (nonRetryablePatterns.some(pattern => lowered.includes(pattern))) {
    return false;
  }

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

export class ConnectionRecoveryManager {
  private config: ConnectionRecoveryConfig;
  private state: RecoveryState;
  private onStatusChange?: OnStatusChange;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
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

  recordHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  markConnected(): void {
    this.state.retryCount = 0;
    this.state.lastError = undefined;
    this.updateStatus('connected');
  }

  markDisconnected(error?: string): void {
    this.updateStatus('disconnected', error);
  }

  shouldRetry(): boolean {
    return this.state.retryCount < this.config.maxRetries && this.state.isAppActive;
  }

  prepareRetry(): number {
    this.state.retryCount++;
    this.updateStatus('reconnecting');
    return calculateBackoff(
      this.state.retryCount - 1,
      this.config.initialDelayMs,
      this.config.maxDelayMs
    );
  }

  markFailed(error: string): void {
    this.updateStatus('failed', error);
  }

  reset(): void {
    this.state.retryCount = 0;
    this.state.lastError = undefined;
    this.updateStatus('connecting');
  }

  cleanup(): void {
    this.stopHeartbeat();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type ConnectionCheckResult = {
  success: boolean;
  error?: string;
  statusCode?: number;
  responseTime?: number;
};

/**
 * Check connectivity to a remote server by making a test request.
 * This is used to verify the connection before allowing users to proceed from settings.
 *
 * @param baseUrl - The API base URL to check (e.g., https://api.openai.com/v1)
 * @param apiKey - The API key to use for authentication
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns ConnectionCheckResult with success status and optional error
 */
export async function checkServerConnection(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number = 10000
): Promise<ConnectionCheckResult> {
  const startTime = Date.now();

  // Validate inputs
  if (!baseUrl || !baseUrl.trim()) {
    return { success: false, error: 'Base URL is required' };
  }

  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'API Key is required' };
  }

  // Normalize the base URL
  let normalizedUrl = baseUrl.trim();
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  // Remove trailing slash
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // Try the /models endpoint first (OpenAI-compatible)
  const modelsUrl = `${normalizedUrl}/models`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log('[ConnectionCheck] Checking connection to:', modelsUrl);

    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    console.log('[ConnectionCheck] Response:', {
      status: response.status,
      responseTime,
    });

    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
        responseTime,
      };
    }

    // Handle specific error codes
    if (response.status === 401) {
      return {
        success: false,
        error: 'Invalid API key. Please check your credentials.',
        statusCode: response.status,
        responseTime,
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'Access forbidden. Your API key may not have the required permissions.',
        statusCode: response.status,
        responseTime,
      };
    }

    if (response.status === 404) {
      // 404 might mean the endpoint doesn't exist but the server is reachable
      // This could be a valid SpeakMCP desktop server that doesn't have /models
      // Let's consider this as a success for connectivity purposes
      return {
        success: true,
        statusCode: response.status,
        responseTime,
      };
    }

    if (response.status >= 500) {
      return {
        success: false,
        error: `Server error (${response.status}). The server may be temporarily unavailable.`,
        statusCode: response.status,
        responseTime,
      };
    }

    // Try to get error message from response body
    let errorMessage = `Server returned status ${response.status}`;
    try {
      const errorBody = await response.json();
      if (errorBody?.error?.message) {
        errorMessage = errorBody.error.message;
      }
    } catch {
      // Ignore JSON parsing errors
    }

    return {
      success: false,
      error: errorMessage,
      statusCode: response.status,
      responseTime,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    console.error('[ConnectionCheck] Error:', error);

    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Connection timed out. Please check your network and server URL.',
        responseTime,
      };
    }

    // Parse common network errors
    const errorMessage = error.message?.toLowerCase() || '';

    if (errorMessage.includes('network') || errorMessage.includes('failed to fetch')) {
      return {
        success: false,
        error: 'Network error. Please check your internet connection.',
        responseTime,
      };
    }

    if (errorMessage.includes('unable to resolve host') || errorMessage.includes('dns')) {
      return {
        success: false,
        error: 'Could not resolve server address. Please check the URL.',
        responseTime,
      };
    }

    if (errorMessage.includes('connection refused') || errorMessage.includes('econnrefused')) {
      return {
        success: false,
        error: 'Connection refused. Is the server running?',
        responseTime,
      };
    }

    return {
      success: false,
      error: error.message || 'Unknown connection error',
      responseTime,
    };
  }
}

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

