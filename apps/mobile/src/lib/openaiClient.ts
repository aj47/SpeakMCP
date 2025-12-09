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
  isRetryableError,
  delay,
  DEFAULT_RECOVERY_CONFIG,
  type ConnectionRecoveryConfig,
} from './connectionRecovery';

export type OpenAIConfig = {
  baseUrl: string;    // OpenAI-compatible API base URL e.g., https://api.openai.com/v1
  apiKey: string;
  model?: string; // model name for /v1/chat/completions
  recoveryConfig?: Partial<ConnectionRecoveryConfig>;
};

/**
 * Callback for connection status updates
 */
export type OnConnectionStatusChange = (state: RecoveryState) => void;

export type ChatMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant';
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
};

/**
 * Response from a chat request including conversation history with tool data
 * Using shared ChatApiResponse type from @speakmcp/shared
 */
export type ChatResponse = ChatApiResponse;

// Re-export shared types for convenience
export type { ToolCall, ToolResult, ConversationHistoryMessage } from '@speakmcp/shared';

/**
 * Agent progress update from the server (SSE streaming)
 */
export interface AgentProgressUpdate {
  sessionId: string;
  conversationId?: string;
  currentIteration: number;
  maxIterations: number;
  steps: AgentProgressStep[];
  isComplete: boolean;
  finalContent?: string;
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
  content?: string; // LLM content for thinking steps
  llmContent?: string; // Alternative field name used by server
  toolCall?: { name: string; arguments: any };
  toolResult?: { success: boolean; content: string; error?: string };
}

/**
 * Callback for receiving agent progress updates in real-time
 */
export type OnProgressCallback = (update: AgentProgressUpdate) => void;



export class OpenAIClient {
  private cfg: OpenAIConfig;
  private baseUrl: string;
  private recoveryManager: ConnectionRecoveryManager | null = null;
  private onConnectionStatusChange?: OnConnectionStatusChange;

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

  /**
   * Set a callback for connection status updates
   */
  setConnectionStatusCallback(callback: OnConnectionStatusChange): void {
    this.onConnectionStatusChange = callback;
  }

  /**
   * Get current connection recovery state
   */
  getConnectionState(): RecoveryState | null {
    return this.recoveryManager?.getState() ?? null;
  }

  /**
   * Cleanup connection recovery resources
   */
  cleanup(): void {
    this.recoveryManager?.cleanup();
    this.recoveryManager = null;
  }

  /** Health check for the API */
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

  /**
   * POST OpenAI-compatible API: /v1/chat/completions
   * Supports SpeakMCP server SSE streaming with real-time agent progress updates.
   * Uses react-native-sse for native platforms (Android/iOS), fetch with ReadableStream for web.
   * Now includes automatic connection recovery for mid-stream disconnections.
   *
   * @param messages - Chat messages to send
   * @param onToken - Optional callback for streaming text tokens (legacy, for text-only streaming)
   * @param onProgress - Optional callback for agent progress updates (tool calls, results, etc.)
   * @returns ChatResponse with content and conversation history
   */
  async chat(
    messages: ChatMessage[],
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    const url = this.getUrl('/chat/completions');
    const body = { model: this.cfg.model, messages, stream: true };

    console.log('[OpenAIClient] Starting chat request');
    console.log('[OpenAIClient] URL:', url);
    console.log('[OpenAIClient] Platform:', Platform.OS);

    // Initialize recovery manager for this request
    this.recoveryManager = new ConnectionRecoveryManager(
      this.cfg.recoveryConfig,
      this.onConnectionStatusChange
    );

    try {
      return await this.chatWithRecovery(url, body, messages, onToken, onProgress);
    } finally {
      // Don't cleanup here - let the caller decide when to cleanup
    }
  }

  /**
   * Execute chat with automatic connection recovery
   */
  private async chatWithRecovery(
    url: string,
    body: object,
    messages: ChatMessage[],
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    const recovery = this.recoveryManager!;
    recovery.reset();

    while (true) {
      try {
        // Use react-native-sse for native platforms (Android/iOS) for real streaming
        // Use fetch with ReadableStream for web
        let result: ChatResponse;
        if (Platform.OS === 'android' || Platform.OS === 'ios') {
          result = await this.streamSSEWithEventSource(url, body, onToken, onProgress);
        } else {
          result = await this.streamSSEWithFetch(url, body, onToken, onProgress);
        }

        recovery.markConnected();
        return result;
      } catch (error: any) {
        console.error('[OpenAIClient] Chat request failed:', error);

        // Check if this is a retryable error and we should retry
        if (isRetryableError(error) && recovery.shouldRetry()) {
          const delayMs = recovery.prepareRetry();
          console.log(`[OpenAIClient] Retrying in ${delayMs}ms (attempt ${recovery.getState().retryCount})`);
          await delay(delayMs);
          continue;
        }

        // Non-retryable error or max retries reached
        recovery.markFailed(error.message || 'Connection failed');
        throw error;
      }
    }
  }

  /**
   * Stream SSE using react-native-sse EventSource for true real-time streaming on native platforms.
   * This uses XMLHttpRequest internally which supports streaming on Android/iOS.
   * Includes heartbeat monitoring for connection health.
   */
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

      // Use custom event type 'done' which is emitted by react-native-sse when server closes connection
      const es = new EventSource<'done'>(url, {
        headers: {
          ...this.authHeaders(),
        },
        method: 'POST',
        body: JSON.stringify(body),
        pollingInterval: 0, // Disable reconnections - we handle one request at a time
      });

      // Helper to safely close and cleanup
      const cleanup = () => {
        recovery?.stopHeartbeat();
        try { es.close(); } catch {}
      };

      // Helper to resolve only once
      const safeResolve = (result: ChatResponse) => {
        if (!hasResolved) {
          hasResolved = true;
          cleanup();
          resolve(result);
        }
      };

      // Helper to reject only once
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

        // Start heartbeat monitoring
        recovery?.startHeartbeat(() => {
          console.log('[OpenAIClient] Heartbeat missed, connection may be stale');
          safeReject(new Error('Connection timeout: no data received'));
        });
      });

      es.addEventListener('message', (event) => {
        if (!event.data) return;

        // Record heartbeat on every message
        recovery?.recordHeartbeat();

        const data = event.data;

        // Handle [DONE] signal
        if (data === '[DONE]' || data === '"[DONE]"') {
          console.log('[OpenAIClient] Received [DONE] signal');
          return;
        }

        try {
          const obj = JSON.parse(data);

          // Handle SpeakMCP-specific SSE event types
          if (obj.type === 'progress' && obj.data) {
            const update = obj.data as AgentProgressUpdate;
            onProgress?.(update);
            if (update.streamingContent?.text) {
              onToken?.(update.streamingContent.text);
            }
            return;
          }

          if (obj.type === 'done' && obj.data) {
            // For 'done' events, the content is complete - overwrite
            if (obj.data.content !== undefined) {
              finalContent = obj.data.content;
            }
            if (obj.data.conversation_id) {
              conversationId = obj.data.conversation_id;
            }
            if (obj.data.conversation_history) {
              conversationHistory = obj.data.conversation_history;
            }
            return;
          }

          if (obj.type === 'error' && obj.data) {
            console.error('[OpenAIClient] Error event:', obj.data.message);
            safeReject(new Error(obj.data.message || 'Server error'));
            return;
          }

          // Handle standard OpenAI streaming format (fallback)
          const delta = obj?.choices?.[0]?.delta;
          const token = delta?.content;
          if (typeof token === 'string' && token.length > 0) {
            onToken?.(token);
            finalContent += token;
          }
        } catch {
          // Ignore non-JSON data
        }
      });

      es.addEventListener('error', (event) => {
        console.error('[OpenAIClient] SSE error:', event);
        recovery?.markDisconnected((event as any)?.message || 'SSE connection error');

        if (event.type === 'error') {
          safeReject(new Error((event as any).message || 'SSE connection error'));
        } else {
          safeReject(new Error('SSE connection failed'));
        }
      });

      // 'done' event fires when server closes the connection (stream complete)
      es.addEventListener('done', () => {
        console.log('[OpenAIClient] SSE done (server closed), content length:', finalContent.length);
        safeResolve({ content: finalContent, conversationId, conversationHistory });
      });

      // 'close' event fires when client closes the connection
      es.addEventListener('close', () => {
        console.log('[OpenAIClient] SSE connection closed, content length:', finalContent.length);
        safeResolve({ content: finalContent, conversationId, conversationHistory });
      });
    });
  }

  /**
   * Stream SSE using fetch with ReadableStream for true real-time streaming.
   * This works in web environments where response.body is a ReadableStream.
   * Includes timeout/abort mechanism and heartbeat monitoring for stale connection detection.
   */
  private async streamSSEWithFetch(
    url: string,
    body: object,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    const recovery = this.recoveryManager;
    const abortController = new AbortController();
    let heartbeatAborted = false;

    // Start heartbeat monitoring - abort fetch if connection stalls
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

      // Mark connected once we get a successful response
      recovery?.markConnected();
      recovery?.recordHeartbeat();

      let finalContent = '';
      let conversationId: string | undefined;
      let conversationHistory: ConversationHistoryMessage[] | undefined;

      // Check if we have a readable stream (web environment)
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Record heartbeat on each chunk received
            recovery?.recordHeartbeat();

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Process complete SSE events
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || ''; // Keep incomplete event in buffer

            for (const event of events) {
              const result = this.processSSEEvent(event, onToken, onProgress);
              if (result) {
                // For 'done' events, the content is complete - overwrite
                // For streaming tokens, accumulate
                if (result.content !== undefined) {
                  // Check if this is streaming delta content (OpenAI format) vs complete content (SpeakMCP done event)
                  // If conversationHistory is present, it's a complete response - overwrite
                  // Otherwise, accumulate tokens
                  if (result.conversationHistory) {
                    finalContent = result.content;
                  } else {
                    finalContent += result.content;
                  }
                }
                if (result.conversationId) conversationId = result.conversationId;
                if (result.conversationHistory) conversationHistory = result.conversationHistory;
              }
            }
          }
        } catch (readError: any) {
          // Re-throw with appropriate error message for heartbeat timeout
          if (heartbeatAborted || readError.name === 'AbortError') {
            throw new Error('Connection timeout: no data received');
          }
          throw readError;
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          const result = this.processSSEEvent(buffer, onToken, onProgress);
          if (result) {
            if (result.content !== undefined) {
              if (result.conversationHistory) {
                finalContent = result.content;
              } else {
                finalContent += result.content;
              }
            }
            if (result.conversationId) conversationId = result.conversationId;
            if (result.conversationHistory) conversationHistory = result.conversationHistory;
          }
        }
      } else {
        // Fallback: no streaming support, parse entire response
        const text = await res.text();
        const events = text.split(/\r?\n\r?\n/);
        for (const event of events) {
          const result = this.processSSEEvent(event, onToken, onProgress);
          if (result) {
            if (result.content !== undefined) {
              if (result.conversationHistory) {
                finalContent = result.content;
              } else {
                finalContent += result.content;
              }
            }
            if (result.conversationId) conversationId = result.conversationId;
            if (result.conversationHistory) conversationHistory = result.conversationHistory;
          }
        }
      }

      console.log('[OpenAIClient] SSE complete, content length:', finalContent.length);
      return { content: finalContent, conversationId, conversationHistory };
    } catch (error: any) {
      // Convert abort errors to timeout errors for proper retry handling
      if (heartbeatAborted || error.name === 'AbortError') {
        recovery?.markDisconnected('Connection timeout: no data received');
        throw new Error('Connection timeout: no data received');
      }
      throw error;
    } finally {
      recovery?.stopHeartbeat();
    }
  }

  /**
   * Process a single SSE event and return any final data extracted
   */
  private processSSEEvent(
    event: string,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): { content?: string; conversationId?: string; conversationHistory?: ConversationHistoryMessage[] } | null {
    if (!event.trim()) return null;

    const lines = event.split(/\r?\n/).map(l => l.replace(/^data:\s?/, '').trim()).filter(Boolean);
    let result: { content?: string; conversationId?: string; conversationHistory?: ConversationHistoryMessage[] } | null = null;

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
          throw new Error(obj.data.message || 'Server error');
        }

        // Handle standard OpenAI streaming format (fallback)
        const delta = obj?.choices?.[0]?.delta;
        const token = delta?.content;
        if (typeof token === 'string' && token.length > 0) {
          onToken?.(token);
          result = { ...result, content: (result?.content || '') + token };
        }
      } catch {
        // Ignore non-JSON lines
      }
    }

    return result;
  }

  /**
   * POST /v1/emergency-stop - Kill switch to stop all agent sessions on the remote server
   * Returns success status and number of processes killed
   */
  async killSwitch(): Promise<{ success: boolean; message?: string; error?: string; processesKilled?: number }> {
    const url = this.getUrl('/emergency-stop');
    console.log('[OpenAIClient] Triggering emergency stop:', url);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({}), // Fastify requires a body when Content-Type is application/json
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

