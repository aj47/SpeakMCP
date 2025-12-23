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
  /** Partial content received before connection was lost (for message recovery) */
  partialContent?: string;
  /** Conversation ID for resuming after reconnection */
  conversationId?: string;
};

/**
 * Checkpoint for tracking streaming progress during a request.
 * Used to recover partial responses when network fails mid-stream.
 */
export type StreamingCheckpoint = {
  /** Partial content accumulated so far */
  content: string;
  /** Conversation ID from server (if received) */
  conversationId?: string;
  /** Timestamp of last received data */
  lastUpdateTime: number;
  /** Number of progress updates received */
  progressCount: number;
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
  private checkpoint: StreamingCheckpoint | null = null;

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
    // Preserve conversationId even when content is empty so manual retry can resume the same conversation.
    // This handles cases where the server sent a conversationId but the stream failed before any text arrived.
    if (this.checkpoint) {
      if (this.checkpoint.content) {
        this.state.partialContent = this.checkpoint.content;
      }
      if (this.checkpoint.conversationId) {
        this.state.conversationId = this.checkpoint.conversationId;
      }
    }
    this.updateStatus('failed', error);
  }

  reset(): void {
    this.state.retryCount = 0;
    this.state.lastError = undefined;
    this.state.partialContent = undefined;
    this.state.conversationId = undefined;
    this.checkpoint = null;
    this.updateStatus('connecting');
  }

  cleanup(): void {
    this.stopHeartbeat();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.checkpoint = null;
  }

  // Checkpoint management for message recovery

  /**
   * Initialize a new streaming checkpoint at the start of a request.
   */
  initCheckpoint(): void {
    this.checkpoint = {
      content: '',
      conversationId: undefined,
      lastUpdateTime: Date.now(),
      progressCount: 0,
    };
  }

  /**
   * Update the checkpoint with new streaming content.
   * Call this whenever new content is received during streaming.
   *
   * To prevent losing partial content from earlier attempts during flaky-network scenarios,
   * this method only updates the content field if:
   * 1. The new content is non-empty, OR
   * 2. The checkpoint has no existing content (e.g., at the start of a request)
   *
   * This ensures that if a later retry fails before any tokens arrive, we don't
   * overwrite the partial response captured from an earlier attempt.
   */
  updateCheckpoint(content: string, conversationId?: string): void {
    if (!this.checkpoint) {
      this.initCheckpoint();
    }
    // Only update content if new content is non-empty or checkpoint has no content yet.
    // This preserves partial content from earlier attempts when retries fail early.
    if (content || !this.checkpoint!.content) {
      this.checkpoint!.content = content;
    }
    this.checkpoint!.lastUpdateTime = Date.now();
    this.checkpoint!.progressCount++;
    if (conversationId) {
      this.checkpoint!.conversationId = conversationId;
    }
  }

  /**
   * Get the current checkpoint data.
   * Returns null if no checkpoint exists.
   */
  getCheckpoint(): StreamingCheckpoint | null {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  /**
   * Clear the checkpoint (call after successful completion).
   */
  clearCheckpoint(): void {
    this.checkpoint = null;
    this.state.partialContent = undefined;
    this.state.conversationId = undefined;
  }

  /**
   * Check if there's recoverable partial content from a failed request.
   */
  hasRecoverableContent(): boolean {
    return !!(this.state.partialContent && this.state.partialContent.length > 0);
  }

  /**
   * Get the partial content from a failed request (for display to user).
   */
  getPartialContent(): string | undefined {
    return this.state.partialContent;
  }

  /**
   * Get the conversation ID from a failed request (for retry).
   */
  getRecoveryConversationId(): string | undefined {
    return this.state.conversationId;
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
  normalizedUrl?: string;
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

  // Trim the API key for use in requests
  const trimmedApiKey = apiKey.trim();

  // Normalize the base URL
  let normalizedUrl = baseUrl.trim();

  // Check if scheme is already provided
  const hasScheme = normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://');

  // Determine if this is a local address (localhost, 127.x.x.x, 192.168.x.x, 10.x.x.x, etc.)
  const isLocalAddress = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(
    normalizedUrl.replace(/^https?:\/\//, '')
  );

  if (!hasScheme) {
    // Default to http:// for local addresses, https:// for external
    normalizedUrl = isLocalAddress ? `http://${normalizedUrl}` : `https://${normalizedUrl}`;
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
        'Authorization': `Bearer ${trimmedApiKey}`,
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
        normalizedUrl,
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
      // 404 indicates the /models endpoint doesn't exist at this URL
      // This usually means the base URL is incorrect (e.g., missing /v1)
      return {
        success: false,
        error: 'Endpoint not found. Please check your base URL (e.g., should end with /v1).',
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

