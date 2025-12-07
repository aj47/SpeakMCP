import type {
  ToolCall,
  ToolResult,
  ConversationHistoryMessage,
  ChatApiResponse
} from '@speakmcp/shared';

export type OpenAIConfig = {
  baseUrl: string;    // OpenAI-compatible API base URL e.g., https://api.openai.com/v1
  apiKey: string;
  model?: string; // model name for /v1/chat/completions
};

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

  /** Health check for the API */
  async health(): Promise<boolean> {
    const url = this.getUrl('/models');
    console.log('[OpenAIClient] Health check:', url);
    try {
      const res = await fetch(url, { headers: this.authHeaders() });
      console.log('[OpenAIClient] Health check response:', res.status, res.statusText);
      return res.ok;
    } catch (error) {
      console.error('[OpenAIClient] Health check error:', error);
      return false;
    }
  }

  /**
   * POST OpenAI-compatible API: /v1/chat/completions
   * Supports SpeakMCP server SSE streaming with real-time agent progress updates.
   * Uses XMLHttpRequest for true streaming in React Native (fetch waits for full response).
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

    console.log('[OpenAIClient] Starting chat request with XHR streaming');
    console.log('[OpenAIClient] URL:', url);
    console.log('[OpenAIClient] Model:', this.cfg.model);
    console.log('[OpenAIClient] Messages count:', messages.length);

    try {
      // Use XHR for true streaming - fetch's res.text() waits for full response in React Native
      return await this.streamSSEWithXHR(url, body, onToken, onProgress);
    } catch (error) {
      console.error('[OpenAIClient] Chat request failed:', error);
      throw error;
    }
  }

  /**
   * Stream SSE using XMLHttpRequest for true real-time streaming in React Native.
   * Unlike fetch, XHR's onprogress fires as data arrives, not after the full response.
   */
  private streamSSEWithXHR(
    url: string,
    body: object,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);

      // Set headers
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (this.cfg.apiKey) {
        xhr.setRequestHeader('Authorization', `Bearer ${this.cfg.apiKey}`);
      }

      let processedLength = 0;
      let finalContent = '';
      let conversationId: string | undefined;
      let conversationHistory: ConversationHistoryMessage[] | undefined;
      let buffer = '';

      xhr.onprogress = () => {
        // Get new data since last progress event
        const newData = xhr.responseText.substring(processedLength);
        processedLength = xhr.responseText.length;

        if (!newData) return;

        // Add to buffer and process complete events
        buffer += newData;

        // Split by double newline (SSE event separator)
        const events = buffer.split(/\r?\n\r?\n/);
        // Keep the last incomplete event in the buffer
        buffer = events.pop() || '';

        for (const event of events) {
          if (!event.trim()) continue;

          const lines = event.split(/\r?\n/).map(l => l.replace(/^data:\s?/, '').trim()).filter(Boolean);
          for (const line of lines) {
            if (line === '[DONE]' || line === '"[DONE]"') {
              console.log('[OpenAIClient XHR] Found DONE marker');
              continue;
            }

            try {
              const obj = JSON.parse(line);

              // Handle SpeakMCP-specific SSE event types
              if (obj.type === 'progress' && obj.data) {
                const update = obj.data as AgentProgressUpdate;
                console.log('[OpenAIClient XHR] Progress event:', update.currentIteration, '/', update.maxIterations, 'steps:', update.steps?.length);
                if (update.steps && update.steps.length > 0) {
                  console.log('[OpenAIClient XHR] Step types:', update.steps.map((s: AgentProgressStep) => `${s.type}:${s.status}`).join(', '));
                }
                onProgress?.(update);
                if (update.streamingContent?.text) {
                  onToken?.(update.streamingContent.text);
                }
                continue;
              }

              if (obj.type === 'done' && obj.data) {
                console.log('[OpenAIClient XHR] Done event received');
                finalContent = obj.data.content || '';
                conversationId = obj.data.conversation_id;
                conversationHistory = obj.data.conversation_history;
                continue;
              }

              if (obj.type === 'error' && obj.data) {
                console.error('[OpenAIClient XHR] Error event:', obj.data.message);
                reject(new Error(obj.data.message || 'Server error'));
                return;
              }

              // Handle standard OpenAI streaming format (fallback)
              const delta = obj?.choices?.[0]?.delta;
              const token = delta?.content;
              if (typeof token === 'string' && token.length > 0) {
                finalContent += token;
                onToken?.(token);
              }
            } catch {
              // Ignore non-JSON lines
            }
          }
        }
      };

      xhr.onload = () => {
        console.log('[OpenAIClient XHR] Request complete, status:', xhr.status);
        if (xhr.status >= 200 && xhr.status < 300) {
          // Process any remaining buffer
          if (buffer.trim()) {
            const lines = buffer.split(/\r?\n/).map(l => l.replace(/^data:\s?/, '').trim()).filter(Boolean);
            for (const line of lines) {
              try {
                const obj = JSON.parse(line);
                if (obj.type === 'done' && obj.data) {
                  finalContent = obj.data.content || finalContent;
                  conversationId = obj.data.conversation_id || conversationId;
                  conversationHistory = obj.data.conversation_history || conversationHistory;
                }
              } catch {
                // Ignore
              }
            }
          }
          resolve({ content: finalContent, conversationId, conversationHistory });
        } else {
          reject(new Error(`Request failed: ${xhr.status} ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => {
        console.error('[OpenAIClient XHR] Request error');
        reject(new Error('Network request failed'));
      };

      xhr.ontimeout = () => {
        console.error('[OpenAIClient XHR] Request timeout');
        reject(new Error('Request timeout'));
      };

      // Send the request
      xhr.send(JSON.stringify(body));
      console.log('[OpenAIClient XHR] Request sent to:', url);
    });
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

