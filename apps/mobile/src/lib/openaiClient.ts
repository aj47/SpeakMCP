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
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error' | 'pending_approval';
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  timestamp: number;
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
    const body = { model: this.cfg.model, messages, stream: true } as any;

    console.log('[OpenAIClient] Starting chat request');
    console.log('[OpenAIClient] URL:', url);
    console.log('[OpenAIClient] Model:', this.cfg.model);
    console.log('[OpenAIClient] Messages count:', messages.length);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });

      console.log('[OpenAIClient] Response status:', res.status, res.statusText);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[OpenAIClient] Error response body:', text);
        throw new Error(`Chat failed: ${res.status} ${text}`);
      }

      const ct = res.headers.get('content-type') || '';
      const isSSE = ct.includes('text/event-stream');

      console.log('[OpenAIClient] Content-Type:', ct, 'isSSE:', isSSE);

      // Non-SSE responses: parse JSON content and conversation history
      if (!isSSE) {
        return this.parseNonSSEResponse(res);
      }

      // SSE streaming: parse SpeakMCP-specific events (progress, done, error)
      return this.parseSSEResponse(res, onToken, onProgress);
    } catch (error) {
      console.error('[OpenAIClient] Chat request failed:', error);
      throw error;
    }
  }

  /**
   * Parse non-SSE JSON response
   */
  private async parseNonSSEResponse(res: Response): Promise<ChatResponse> {
    console.log('[OpenAIClient] Processing non-SSE response');
    const text = await res.text();
    console.log('[OpenAIClient] Response text:', text);
    try {
      const j = JSON.parse(text);
      const content = j?.choices?.[0]?.message?.content ?? '';
      const conversationId = j?.conversation_id;
      const conversationHistory = j?.conversation_history;
      if (conversationHistory) {
        console.log('[OpenAIClient] Received conversation history with', conversationHistory.length, 'messages');
      }
      return {
        content: typeof content === 'string' ? content : text,
        conversationId,
        conversationHistory,
      };
    } catch (parseError) {
      console.error('[OpenAIClient] JSON parse error:', parseError);
      return { content: text };
    }
  }

  /**
   * Parse SSE response, handling both SpeakMCP agent progress events and standard OpenAI streaming
   */
  private async parseSSEResponse(
    res: Response,
    onToken?: (token: string) => void,
    onProgress?: OnProgressCallback
  ): Promise<ChatResponse> {
    const text = await res.text();
    console.log('[OpenAIClient] SSE response length:', text.length);

    let finalContent = '';
    let conversationId: string | undefined;
    let conversationHistory: ConversationHistoryMessage[] | undefined;

    const chunks = text.split(/\r?\n\r?\n/);
    for (const chunk of chunks) {
      const lines = chunk.split(/\r?\n/).map(l => l.replace(/^data:\s?/, '').trim()).filter(Boolean);
      for (const line of lines) {
        if (line === '[DONE]' || line === '"[DONE]"') {
          console.log('[OpenAIClient] Found DONE marker');
          continue;
        }

        try {
          const obj = JSON.parse(line);

          // Handle SpeakMCP-specific SSE event types
          if (obj.type === 'progress' && obj.data) {
            console.log('[OpenAIClient] Progress event:', obj.data.currentIteration, '/', obj.data.maxIterations);
            onProgress?.(obj.data as AgentProgressUpdate);
            // Also update streaming content if available
            if (obj.data.streamingContent?.text) {
              onToken?.(obj.data.streamingContent.text);
            }
            continue;
          }

          if (obj.type === 'done' && obj.data) {
            console.log('[OpenAIClient] Done event received');
            finalContent = obj.data.content || '';
            conversationId = obj.data.conversation_id;
            conversationHistory = obj.data.conversation_history;
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
            finalContent += token;
            onToken?.(token);
          }
        } catch (parseError) {
          // Ignore non-JSON lines
        }
      }
    }

    console.log('[OpenAIClient] SSE complete, content length:', finalContent.length);
    return { content: finalContent, conversationId, conversationHistory };
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

