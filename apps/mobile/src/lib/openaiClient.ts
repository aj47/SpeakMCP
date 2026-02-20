import type {
  ToolCall,
  ToolResult,
  ConversationHistoryMessage,
  ChatApiResponse
} from '@speakmcp/shared';
import { Platform } from 'react-native';
import EventSource from 'react-native-sse';
import {
  ConnectionRecoveryManager,
  ConnectionStatus,
  RecoveryState,
  StreamingCheckpoint,
  isRetryableError,
  delay,
  DEFAULT_RECOVERY_CONFIG,
  type ConnectionRecoveryConfig,
} from './connectionRecovery';

export type OpenAIConfig = {
  baseUrl: string;    // OpenAI-compatible API base URL e.g., https://api.openai.com/v1
  apiKey: string;
  model?: string;
  recoveryConfig?: Partial<ConnectionRecoveryConfig>;
};

export type OnConnectionStatusChange = (state: RecoveryState) => void;

export type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
};

export type ChatResponse = ChatApiResponse;

export type { ToolCall, ToolResult, ConversationHistoryMessage } from '@speakmcp/shared';
export type { StreamingCheckpoint } from './connectionRecovery';

export interface AgentProgressUpdate {
  sessionId: string;
  conversationId?: string;
  currentIteration: number;
  maxIterations: number;
  steps: AgentProgressStep[];
  isComplete: boolean;
  finalContent?: string;
  /**
   * User-facing response set via respond_to_user tool.
   * On voice interfaces: spoken aloud via TTS
   * On messaging channels (mobile, WhatsApp): sent as a message
   * Consumers should fall back to finalContent if this is not set.
   */
  userResponse?: string;
  /** @deprecated Use userResponse instead. Kept for backward compatibility with older backends. */
  spokenContent?: string;
  conversationHistory?: ConversationHistoryMessage[];
  streamingContent?: {
    text: string;
    isStreaming: boolean;
  };
}

export interface AgentProgressStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error' | 'pending_approval' | 'completion';
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  timestamp: number;
  content?: string;
  llmContent?: string;
  toolCall?: { name: string; arguments: any };
  toolResult?: { success: boolean; content: string; error?: string };
}

export type OnProgressCallback = (update: AgentProgressUpdate) => void;



export class OpenAIClient {
  private cfg: OpenAIConfig;
  private baseUrl: string;
  private recoveryManager: ConnectionRecoveryManager | null = null;
  private onConnectionStatusChange?: OnConnectionStatusChange;
  private activeEventSource: EventSource | null = null;
  private activeAbortController: AbortController | null = null;
  private activeXhr: XMLHttpRequest | null = null;

  constructor(cfg: OpenAIConfig) {
    this.cfg = { ...cfg, baseUrl: cfg.baseUrl?.trim?.() ?? '' };
    this.baseUrl = this.normalizeBaseUrl(this.cfg.baseUrl);
  }

  private normalizeBaseUrl(raw: string): string {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) {
      throw new Error('OpenAIClient requires a baseUrl');
    }
    return trimmed.replace(/\/+$/, '');
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      'Content-Type': 'application/json',
    } as const;
  }

  private getUrl(endpoint: string): string {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${this.baseUrl}${normalizedEndpoint}`;
  }

  setConnectionStatusCallback(callback: OnConnectionStatusChange): void {
    this.onConnectionStatusChange = callback;
  }

  getConnectionState(): RecoveryState | null {
    return this.recoveryManager?.getState() ?? null;
  }

  /**
   * Check if there's recoverable partial content from a failed request.
   * This can be used to show partial responses to the user even when the request failed.
   */
  hasRecoverableContent(): boolean {
    return this.recoveryManager?.hasRecoverableContent() ?? false;
  }

  /**
   * Get the partial content from a failed request.
   * Returns undefined if no partial content is available.
   */
  getPartialContent(): string | undefined {
    return this.recoveryManager?.getPartialContent();
  }

  /**
   * Get the conversation ID from a failed request for retry purposes.
   */
  getRecoveryConversationId(): string | undefined {
    return this.recoveryManager?.getRecoveryConversationId();
  }

  /**
   * Get the current streaming checkpoint (for debugging/monitoring).
   */
  getStreamingCheckpoint(): StreamingCheckpoint | null {
    return this.recoveryManager?.getCheckpoint() ?? null;
  }

  cleanup(): void {
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.activeEventSource?.close();
    this.activeEventSource = null;
    this.activeXhr?.abort();
    this.activeXhr = null;
    this.recoveryManager?.cleanup();
    this.recoveryManager = null;
  }

  async health(): Promise<boolean> {
    const url = this.getUrl('/models');
    try {
      const res = await fetch(url, { headers: this.authHeaders() });
      return res.ok;
    } catch (error) {
      console.error('[OpenAIClient] Health check error:', error);
      return false;
    }
  }

  async chat(
    messages: ChatMessage[],
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback,
    conversationId?: string
  ): Promise<ChatResponse> {
    const url = this.getUrl('/chat/completions');
    const body: Record<string, any> = { model: this.cfg.model, messages, stream: true };

    if (conversationId) {
      body.conversation_id = conversationId;
    }

    console.log('[OpenAIClient] Starting chat request');
    console.log('[OpenAIClient] URL:', url);
    console.log('[OpenAIClient] Platform:', Platform.OS);

    this.recoveryManager?.cleanup();
    this.recoveryManager = new ConnectionRecoveryManager(
      this.cfg.recoveryConfig,
      this.onConnectionStatusChange
    );

    return await this.chatWithRecovery(url, body, onToken, onProgress);
  }

  private async chatWithRecovery(
    url: string,
    body: Record<string, any>,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    const recovery = this.recoveryManager!;
    recovery.reset();

    // Initialize checkpoint for tracking streaming progress
    recovery.initCheckpoint();

    // Track conversationId received during streaming to preserve it across retries.
    // This prevents duplicate sessions when retrying after a partial success
    // (server created session, but network failed before client received full response).
    let lastReceivedConversationId: string | undefined;

    // Track accumulated content for checkpoint updates
    let accumulatedContent = '';

    // Wrap onToken to update checkpoint with streaming content
    const wrappedOnToken: ((token: string) => void) | undefined = onToken
      ? (token) => {
          // Handle both delta tokens and full-text updates.
          // When called via onProgress with streamingContent.text, token contains the full accumulated text.
          // When called via SSE delta events, token contains just the new delta.
          // Detect full-text updates: if token starts with current accumulatedContent and is longer,
          // or if token equals accumulatedContent (duplicate call), use replacement instead of append.
          if (token.startsWith(accumulatedContent)) {
            // Full-text update: replace instead of append
            accumulatedContent = token;
          } else {
            // Delta token: append
            accumulatedContent += token;
          }
          recovery.updateCheckpoint(accumulatedContent, lastReceivedConversationId);
          onToken(token);
        }
      : undefined;

    // Wrap onProgress to capture conversationId and update checkpoint
    const wrappedOnProgress: OnProgressCallback | undefined = onProgress
      ? (update) => {
          // Capture conversationId from progress updates if available
          if (update.conversationId && !lastReceivedConversationId) {
            lastReceivedConversationId = update.conversationId;
            console.log('[OpenAIClient] Captured conversationId from progress:', lastReceivedConversationId);
            // Update checkpoint when conversationId becomes available, even without content.
            // This ensures conversationId is preserved if the stream fails before any tokens arrive.
            recovery.updateCheckpoint(accumulatedContent, lastReceivedConversationId);
          }
          // Update checkpoint with streaming content from progress
          if (update.streamingContent?.text) {
            accumulatedContent = update.streamingContent.text;
            recovery.updateCheckpoint(accumulatedContent, lastReceivedConversationId);
          }
          onProgress(update);
        }
      : undefined;

    while (true) {
      // Update body with conversationId if we received one from a previous attempt.
      // This ensures retries continue the same conversation instead of creating a new one.
      // We always use the server-provided conversationId over any original value because:
      // 1. If body.conversation_id was empty, we need to set it
      // 2. If body.conversation_id was stale (server created a new one), we need to update it
      if (lastReceivedConversationId) {
        if (body.conversation_id !== lastReceivedConversationId) {
          console.log('[OpenAIClient] Updating conversationId for retry:', body.conversation_id || '(empty)', '->', lastReceivedConversationId);
        }
        body.conversation_id = lastReceivedConversationId;
      }

      try {
        let result: ChatResponse;
        if (Platform.OS === 'android') {
          // Android: Use XMLHttpRequest-based streaming due to known react-native-sse issues
          // See: https://github.com/binaryminds/react-native-sse/issues/61
          result = await this.streamSSEWithXHR(url, body, wrappedOnToken, wrappedOnProgress);
        } else if (Platform.OS === 'ios') {
          result = await this.streamSSEWithEventSource(url, body, wrappedOnToken, wrappedOnProgress);
        } else {
          result = await this.streamSSEWithFetch(url, body, wrappedOnToken, wrappedOnProgress);
        }

        // Capture conversationId from successful result for completeness
        if (result.conversationId && !lastReceivedConversationId) {
          lastReceivedConversationId = result.conversationId;
        }

        recovery.markConnected();
        recovery.clearCheckpoint(); // Clear checkpoint on success
        return result;
      } catch (error: any) {
        console.error('[OpenAIClient] Chat request failed:', error);
        const checkpoint = recovery.getCheckpoint();
        console.log('[OpenAIClient] Checkpoint at failure:', checkpoint ? {
          contentLength: checkpoint.content?.length ?? 0,
          hasConversationId: !!checkpoint.conversationId,
          lastUpdateTime: checkpoint.lastUpdateTime
        } : null);

        if (isRetryableError(error) && recovery.shouldRetry()) {
          const delayMs = recovery.prepareRetry();
          console.log(`[OpenAIClient] Retrying in ${delayMs}ms (attempt ${recovery.getState().retryCount})`);
          // Reset accumulated content for retry - server will provide full history
          accumulatedContent = '';
          await delay(delayMs);
          continue;
        }

        recovery.markFailed(error.message || 'Connection failed');
        throw error;
      }
    }
  }

  private streamSSEWithEventSource(
    url: string,
    body: object,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    return new Promise((resolve, reject) => {
      let finalContent = '';
      let conversationId: string | undefined;
      let conversationHistory: ConversationHistoryMessage[] | undefined;
      let hasResolved = false;
      const recovery = this.recoveryManager;

      console.log('[OpenAIClient] Creating EventSource for SSE streaming');

      // Android-specific SSE configuration:
      // - Accept-Encoding: identity prevents gzip compression which breaks SSE streaming on Android
      //   (Android's OkHttp sends gzip by default, causing the response to be buffered instead of streamed)
      // - timeout: 0 disables the library's internal timeout (we handle timeouts via heartbeat)
      // - timeoutBeforeConnection: reduced for faster initial connection
      // - debug: enabled for better error logging during development
      const isAndroid = Platform.OS === 'android';
      const es = new EventSource<'done'>(url, {
        headers: {
          ...this.authHeaders(),
          // Prevent gzip compression on Android which breaks SSE streaming
          ...(isAndroid && { 'Accept-Encoding': 'identity' }),
        },
        method: 'POST',
        body: JSON.stringify(body),
        pollingInterval: 0,
        // Disable internal timeout - we use heartbeat-based timeout instead
        timeout: 0,
        // Reduce initial connection delay for faster startup
        timeoutBeforeConnection: isAndroid ? 100 : 500,
        // Enable debug logging for troubleshooting
        debug: __DEV__,
      });
      this.activeEventSource = es;

      const cleanup = () => {
        recovery?.stopHeartbeat();
        try { es.close(); } catch {}
        this.activeEventSource = null;
      };

      const safeResolve = (result: ChatResponse) => {
        if (!hasResolved) {
          hasResolved = true;
          cleanup();
          resolve(result);
        }
      };

      const safeReject = (error: Error) => {
        if (!hasResolved) {
          hasResolved = true;
          cleanup();
          reject(error);
        }
      };

      es.addEventListener('open', () => {
        console.log('[OpenAIClient] SSE connection opened');
        recovery?.markConnected();

        recovery?.startHeartbeat(() => {
          console.log('[OpenAIClient] Heartbeat missed, connection may be stale');
          recovery?.markDisconnected('Connection timeout: no data received');
          safeReject(new Error('Connection timeout: no data received'));
        });
      });

      es.addEventListener('message', (event) => {
        if (!event.data) return;

        recovery?.recordHeartbeat();

        const data = event.data;

        if (data === '[DONE]' || data === '"[DONE]"') {
          console.log('[OpenAIClient] Received [DONE] signal');
          return;
        }

        try {
          const obj = JSON.parse(data);

          if (obj.type === 'progress' && obj.data) {
            const update = obj.data as AgentProgressUpdate;
            onProgress?.(update);
            if (update.streamingContent?.text) {
              onToken?.(update.streamingContent.text);
            }
            return;
          }

          if (obj.type === 'done' && obj.data) {
            console.log('[OpenAIClient] Received done event, data keys:', Object.keys(obj.data));
            if (obj.data.content !== undefined) {
              finalContent = obj.data.content;
            }
            if (obj.data.conversation_id) {
              conversationId = obj.data.conversation_id;
            }
            if (obj.data.conversation_history) {
              conversationHistory = obj.data.conversation_history;
              console.log('[OpenAIClient] conversation_history received:', conversationHistory?.length || 0, 'messages');
            } else {
              console.log('[OpenAIClient] WARNING: No conversation_history in done event');
            }
            return;
          }

          if (obj.type === 'error' && obj.data) {
            const errorMessage = obj.data.message || 'Server error';
            console.error('[OpenAIClient] Error event:', errorMessage);
            recovery?.markDisconnected(errorMessage);
            safeReject(new Error(errorMessage));
            return;
          }

          const delta = obj?.choices?.[0]?.delta;
          const token = delta?.content;
          if (typeof token === 'string' && token.length > 0) {
            onToken?.(token);
            finalContent += token;
          }
        } catch {}
      });

      es.addEventListener('error', (event) => {
        // Extract detailed error information for debugging
        const errorEvent = event as any;
        const errorDetails = {
          type: errorEvent?.type,
          message: errorEvent?.message,
          xhrStatus: errorEvent?.xhrStatus,
          xhrState: errorEvent?.xhrState,
          platform: Platform.OS,
        };
        console.error('[OpenAIClient] SSE error:', JSON.stringify(errorDetails, null, 2));

        const errorMessage = errorEvent?.message ||
          (errorEvent?.xhrStatus ? `HTTP ${errorEvent.xhrStatus}` : 'SSE connection error');
        recovery?.markDisconnected(errorMessage);

        if (event.type === 'error') {
          safeReject(new Error(errorMessage));
        } else {
          safeReject(new Error('SSE connection failed'));
        }
      });

      es.addEventListener('done', () => {
        console.log('[OpenAIClient] SSE done (server closed), content length:', finalContent.length);
        safeResolve({ content: finalContent, conversationId, conversationHistory });
      });

      es.addEventListener('close', () => {
        console.log('[OpenAIClient] SSE connection closed by client, content length:', finalContent.length);
        safeReject(new Error('Connection cancelled'));
      });
    });
  }

  /**
   * Android-specific SSE streaming using XMLHttpRequest.
   * This is a workaround for known issues with react-native-sse on Android:
   * - https://github.com/binaryminds/react-native-sse/issues/61
   * - https://github.com/binaryminds/react-native-sse/issues/74
   */
  private streamSSEWithXHR(
    url: string,
    body: object,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    return new Promise((resolve, reject) => {
      let finalContent = '';
      let conversationId: string | undefined;
      let conversationHistory: ConversationHistoryMessage[] | undefined;
      let hasResolved = false;
      let processedLength = 0;
      let buffer = ''; // Buffer for incomplete SSE events across progress calls
      let hasReceivedData = false; // Track if we've received first data for markConnected
      let abortReason: string | null = null; // Track abort reason to preserve original error
      const recovery = this.recoveryManager;

      console.log('[OpenAIClient] Creating XMLHttpRequest for Android SSE streaming');

      const xhr = new XMLHttpRequest();
      this.activeXhr = xhr;
      xhr.open('POST', url, true);

      // Set headers using authHeaders() for consistency with fetch/EventSource paths
      const headers = this.authHeaders();
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      // Prevent gzip compression which can cause buffering issues with SSE streaming
      xhr.setRequestHeader('Accept-Encoding', 'identity');

      const safeResolve = (result: ChatResponse) => {
        if (!hasResolved) {
          hasResolved = true;
          recovery?.stopHeartbeat();
          resolve(result);
        }
      };

      const safeReject = (error: Error) => {
        if (!hasResolved) {
          hasResolved = true;
          recovery?.stopHeartbeat();
          reject(error);
        }
      };

      recovery?.startHeartbeat(() => {
        console.log('[OpenAIClient] XHR heartbeat missed, aborting stalled stream');
        // Set abortReason before abort to preserve original error in onabort handler
        abortReason = 'Connection timeout: no data received';
        recovery?.markDisconnected(abortReason);
        xhr.abort();
        safeReject(new Error('Connection stalled - no data received'));
      });

      xhr.onprogress = () => {
        recovery?.recordHeartbeat();

        // Mark connected on first progress event to align with fetch/EventSource behavior
        if (!hasReceivedData) {
          hasReceivedData = true;
          recovery?.markConnected();
        }

        // Process new data since last progress event
        const newData = xhr.responseText.substring(processedLength);
        processedLength = xhr.responseText.length;

        if (!newData) return;

        // Prepend any buffered partial event from the previous progress call
        buffer += newData;

        // Split into SSE events and keep the last (potentially incomplete) segment
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || ''; // Save the last segment as it may be incomplete

        for (const event of events) {
          if (!event.trim()) continue;

          const result = this.processSSEEvent(event, onToken, onProgress);
          if (result) {
            // Handle SSE error events
            if (result.error) {
              abortReason = result.error.message; // Preserve error reason before abort
              recovery?.markDisconnected(result.error.message);
              // Abort the XHR to avoid leaving a lingering in-flight stream
              xhr.abort();
              this.activeXhr = null;
              safeReject(result.error);
              return;
            }
            if (result.content !== undefined) {
              // Use !== undefined instead of truthy check for conversationHistory
              // to correctly handle empty arrays (which should still replace finalContent)
              if (result.conversationHistory !== undefined) {
                finalContent = result.content;
              } else {
                finalContent += result.content;
              }
            }
            if (result.conversationId) conversationId = result.conversationId;
            if (result.conversationHistory !== undefined) conversationHistory = result.conversationHistory;
          }
        }
      };

      xhr.onload = () => {
        // Process any remaining buffered content
        if (buffer.trim()) {
          const result = this.processSSEEvent(buffer, onToken, onProgress);
          if (result) {
            // Handle SSE error events
            if (result.error) {
              this.activeXhr = null;
              recovery?.markDisconnected(result.error.message);
              safeReject(result.error);
              return;
            }
            if (result.content !== undefined) {
              // Use !== undefined instead of truthy check for conversationHistory
              // to correctly handle empty arrays (which should still replace finalContent)
              if (result.conversationHistory !== undefined) {
                finalContent = result.content;
              } else {
                finalContent += result.content;
              }
            }
            if (result.conversationId) conversationId = result.conversationId;
            if (result.conversationHistory !== undefined) conversationHistory = result.conversationHistory;
          }
        }

        this.activeXhr = null;
        console.log('[OpenAIClient] XHR completed, status:', xhr.status, 'content length:', finalContent.length);

        if (xhr.status >= 200 && xhr.status < 300) {
          recovery?.markConnected();
          safeResolve({ content: finalContent, conversationId, conversationHistory });
        } else {
          const errorMsg = `Chat failed: ${xhr.status} ${xhr.statusText}`;
          console.error('[OpenAIClient] XHR error:', errorMsg);
          recovery?.markDisconnected(errorMsg);
          safeReject(new Error(errorMsg));
        }
      };

      xhr.onerror = () => {
        this.activeXhr = null;
        const errorMsg = 'Network error during streaming';
        console.error('[OpenAIClient] XHR network error');
        recovery?.markDisconnected(errorMsg);
        safeReject(new Error(errorMsg));
      };

      xhr.ontimeout = () => {
        this.activeXhr = null;
        const errorMsg = 'Request timeout';
        console.error('[OpenAIClient] XHR timeout');
        recovery?.markDisconnected(errorMsg);
        safeReject(new Error(errorMsg));
      };

      xhr.onabort = () => {
        this.activeXhr = null;
        // Preserve the original abort reason if it was set (e.g., from SSE error detection)
        // Otherwise use 'Request cancelled' (non-retryable, since 'cancelled' is in nonRetryablePatterns)
        const errorMsg = abortReason || 'Request cancelled';
        console.log('[OpenAIClient] XHR cancelled, reason:', errorMsg);
        // Only mark disconnected if not already done (abortReason being set means we already did)
        if (!abortReason) {
          recovery?.markDisconnected(errorMsg);
        }
        safeReject(new Error(errorMsg));
      };

      // Send the request
      xhr.send(JSON.stringify(body));
    });
  }

  private async streamSSEWithFetch(
    url: string,
    body: object,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    const recovery = this.recoveryManager;
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    let heartbeatAborted = false;

    recovery?.startHeartbeat(() => {
      console.log('[OpenAIClient] Web heartbeat missed, aborting stalled stream');
      heartbeatAborted = true;
      abortController.abort();
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      console.log('[OpenAIClient] Response status:', res.status, res.statusText);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[OpenAIClient] Error response body:', text);
        throw new Error(`Chat failed: ${res.status} ${text}`);
      }

      recovery?.markConnected();
      recovery?.recordHeartbeat();

      let finalContent = '';
      let conversationId: string | undefined;
      let conversationHistory: ConversationHistoryMessage[] | undefined;

      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            recovery?.recordHeartbeat();

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || '';

            for (const event of events) {
              const result = this.processSSEEvent(event, onToken, onProgress);
              if (result) {
                // Handle SSE error events
                if (result.error) {
                  recovery?.markDisconnected(result.error.message);
                  throw result.error;
                }
                if (result.content !== undefined) {
                  // Use !== undefined for conversationHistory to correctly handle empty arrays
                  if (result.conversationHistory !== undefined) {
                    finalContent = result.content;
                  } else {
                    finalContent += result.content;
                  }
                }
                if (result.conversationId) conversationId = result.conversationId;
                if (result.conversationHistory !== undefined) conversationHistory = result.conversationHistory;
              }
            }
          }
        } catch (readError: any) {
          if (heartbeatAborted || readError.name === 'AbortError') {
            throw new Error('Connection timeout: no data received');
          }
          throw readError;
        }

        if (buffer.trim()) {
          const result = this.processSSEEvent(buffer, onToken, onProgress);
          if (result) {
            // Handle SSE error events
            if (result.error) {
              recovery?.markDisconnected(result.error.message);
              throw result.error;
            }
            if (result.content !== undefined) {
              // Use !== undefined for conversationHistory to correctly handle empty arrays
              if (result.conversationHistory !== undefined) {
                finalContent = result.content;
              } else {
                finalContent += result.content;
              }
            }
            if (result.conversationId) conversationId = result.conversationId;
            if (result.conversationHistory !== undefined) conversationHistory = result.conversationHistory;
          }
        }
      } else {
        const text = await res.text();
        const events = text.split(/\r?\n\r?\n/);
        for (const event of events) {
          const result = this.processSSEEvent(event, onToken, onProgress);
          if (result) {
            // Handle SSE error events
            if (result.error) {
              recovery?.markDisconnected(result.error.message);
              throw result.error;
            }
            if (result.content !== undefined) {
              // Use !== undefined for conversationHistory to correctly handle empty arrays
              if (result.conversationHistory !== undefined) {
                finalContent = result.content;
              } else {
                finalContent += result.content;
              }
            }
            if (result.conversationId) conversationId = result.conversationId;
            if (result.conversationHistory !== undefined) conversationHistory = result.conversationHistory;
          }
        }
      }

      console.log('[OpenAIClient] SSE complete, content length:', finalContent.length);
      return { content: finalContent, conversationId, conversationHistory };
    } catch (error: any) {
      if (heartbeatAborted || error.name === 'AbortError') {
        recovery?.markDisconnected('Connection timeout: no data received');
        throw new Error('Connection timeout: no data received');
      }
      throw error;
    } finally {
      recovery?.stopHeartbeat();
      this.activeAbortController = null;
    }
  }

  private processSSEEvent(
    event: string,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): { content?: string; conversationId?: string; conversationHistory?: ConversationHistoryMessage[]; error?: Error } | null {
    if (!event.trim()) return null;

    const lines = event.split(/\r?\n/).map(l => l.replace(/^data:\s?/, '').trim()).filter(Boolean);
    let result: { content?: string; conversationId?: string; conversationHistory?: ConversationHistoryMessage[]; error?: Error } | null = null;

    for (const line of lines) {
      if (line === '[DONE]' || line === '"[DONE]"') {
        continue;
      }

      try {
        const obj = JSON.parse(line);

        // Handle SpeakMCP-specific SSE event types
        if (obj.type === 'progress' && obj.data) {
          const update = obj.data as AgentProgressUpdate;
          onProgress?.(update);
          if (update.streamingContent?.text) {
            onToken?.(update.streamingContent.text);
          }
          continue;
        }

        if (obj.type === 'done' && obj.data) {
          result = {
            content: obj.data.content || '',
            conversationId: obj.data.conversation_id,
            conversationHistory: obj.data.conversation_history,
          };
          continue;
        }

        if (obj.type === 'error' && obj.data) {
          console.error('[OpenAIClient] Error event:', obj.data.message);
          // Return error in result so callers can handle it
          return { error: new Error(obj.data.message || 'Server error') };
        }

        const delta = obj?.choices?.[0]?.delta;
        const token = delta?.content;
        if (typeof token === 'string' && token.length > 0) {
          onToken?.(token);
          // Initialize result if null to avoid "Cannot spread null" error on first token
          result = { ...(result || {}), content: (result?.content || '') + token };
        }
      } catch {}
    }

    return result;
  }

  /**
   * Fetch conversation state from the server for recovery purposes.
   * This is used when the mobile app loses connection and needs to sync
   * with the server's conversation state.
   */
  async getConversation(conversationId: string): Promise<{
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant' | 'tool';
      content: string;
      timestamp: number;
      toolCalls?: any[];
      toolResults?: any[];
    }>;
    metadata?: any;
  } | null> {
    const url = this.getUrl(`/conversations/${conversationId}`);
    console.log('[OpenAIClient] Fetching conversation for recovery:', url);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders(),
      });

      if (res.status === 404) {
        console.log('[OpenAIClient] Conversation not found on server:', conversationId);
        return null;
      }

      if (!res.ok) {
        console.error('[OpenAIClient] Failed to fetch conversation:', res.status, res.statusText);
        return null;
      }

      const data = await res.json();
      console.log('[OpenAIClient] Fetched conversation:', data.id, 'with', data.messages?.length, 'messages');
      return data;
    } catch (error: any) {
      console.error('[OpenAIClient] Error fetching conversation:', error);
      return null;
    }
  }

  async killSwitch(): Promise<{ success: boolean; message?: string; error?: string; processesKilled?: number }> {
    const url = this.getUrl('/emergency-stop');
    console.log('[OpenAIClient] Triggering emergency stop:', url);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({}),
      });

      console.log('[OpenAIClient] Kill switch response:', res.status, res.statusText);

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error('[OpenAIClient] Kill switch error:', data);
        return {
          success: false,
          error: data?.error || `Kill switch failed: ${res.status}`,
        };
      }

      console.log('[OpenAIClient] Kill switch success:', data);
      return {
        success: true,
        message: data?.message || 'Emergency stop executed',
        processesKilled: data?.processesKilled,
      };
    } catch (error: any) {
      console.error('[OpenAIClient] Kill switch request failed:', error);
      return {
        success: false,
        error: error?.message || 'Failed to connect to server',
      };
    }
  }
}
