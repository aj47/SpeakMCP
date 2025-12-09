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
  model?: string;
  recoveryConfig?: Partial<ConnectionRecoveryConfig>;
};

export type OnConnectionStatusChange = (state: RecoveryState) => void;

export type ChatMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant';
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isThinking?: boolean;
};

export type ChatResponse = ChatApiResponse;

export type { ToolCall, ToolResult, ConversationHistoryMessage } from '@speakmcp/shared';

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

  cleanup(): void {
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.activeEventSource?.close();
    this.activeEventSource = null;
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

  /**
   * Sanitize messages to remove UI-only fields before sending to the server.
   * This prevents UI state like `isThinking` or `id` from leaking to the backend.
   */
  private sanitizeMessage(message: ChatMessage): object {
    return {
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      toolResults: message.toolResults,
    };
  }

  async chat(
    messages: ChatMessage[],
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback,
    conversationId?: string
  ): Promise<ChatResponse> {
    const url = this.getUrl('/chat/completions');
    const body: Record<string, any> = {
      model: this.cfg.model,
      messages: messages.map(m => this.sanitizeMessage(m)),
      stream: true
    };

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

    try {
      return await this.chatWithRecovery(url, body, onToken, onProgress);
    } finally {
    }
  }

  private async chatWithRecovery(
    url: string,
    body: object,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    const recovery = this.recoveryManager!;
    recovery.reset();

    while (true) {
      try {
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

        if (isRetryableError(error) && recovery.shouldRetry()) {
          const delayMs = recovery.prepareRetry();
          console.log(`[OpenAIClient] Retrying in ${delayMs}ms (attempt ${recovery.getState().retryCount})`);
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

      const es = new EventSource<'done'>(url, {
        headers: {
          ...this.authHeaders(),
        },
        method: 'POST',
        body: JSON.stringify(body),
        pollingInterval: 0,
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
            console.error('[OpenAIClient] Error event:', obj.data.message);
            safeReject(new Error(obj.data.message || 'Server error'));
            return;
          }

          const delta = obj?.choices?.[0]?.delta;
          const token = delta?.content;
          if (typeof token === 'string' && token.length > 0) {
            onToken?.(token);
            finalContent += token;
          }
        } catch {
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
        } catch (readError: any) {
          if (heartbeatAborted || readError.name === 'AbortError') {
            throw new Error('Connection timeout: no data received');
          }
          throw readError;
        }

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

        const delta = obj?.choices?.[0]?.delta;
        const token = delta?.content;
        if (typeof token === 'string' && token.length > 0) {
          onToken?.(token);
          result = { ...result, content: (result?.content || '') + token };
        }
      } catch {
      }
    }

    return result;
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

