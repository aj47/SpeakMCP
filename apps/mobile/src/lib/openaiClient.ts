export type OpenAIConfig = {
  baseUrl: string;    // OpenAI-compatible API base URL e.g., https://api.openai.com/v1
  apiKey: string;
  model?: string; // model name for /v1/chat/completions
};

export type ChatMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant';
  content?: string;
};



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
   * If the server responds with text/event-stream, this will parse SSE chunks and accumulate assistant content.
   * You can pass an onToken callback to receive incremental tokens.
   */
  async chat(
    messages: ChatMessage[],
    onToken?: (token: string) => void
  ): Promise<string> {
    const url = this.getUrl('/chat/completions');
    const body = { model: this.cfg.model, messages, stream: true } as any;

    console.log('[OpenAIClient] Starting chat request');
    console.log('[OpenAIClient] URL:', url);
    console.log('[OpenAIClient] Model:', this.cfg.model);
    console.log('[OpenAIClient] Messages count:', messages.length);
    console.log('[OpenAIClient] Headers:', JSON.stringify(this.authHeaders(), null, 2));
    console.log('[OpenAIClient] Request body:', JSON.stringify(body, null, 2));

    // Test basic connectivity first
    console.log('[OpenAIClient] Testing basic connectivity...');
    try {
      const testResponse = await fetch(url.replace('/chat/completions', '/models'), {
        method: 'GET',
        headers: this.authHeaders(),
      });
      console.log('[OpenAIClient] Connectivity test result:', testResponse.status, testResponse.statusText);
    } catch (connectError) {
      console.error('[OpenAIClient] Connectivity test failed:', connectError);
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });

      console.log('[OpenAIClient] Response status:', res.status, res.statusText);
      console.log('[OpenAIClient] Response headers:', Object.fromEntries(res.headers.entries()));

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[OpenAIClient] Error response body:', text);
        throw new Error(`Chat failed: ${res.status} ${text}`);
      }

      const ct = res.headers.get('content-type') || '';
      console.log('[OpenAIClient] Content-Type:', ct);

      const isSSE = ct.includes('text/event-stream');
      const supportsReader = !!(res as any)?.body && typeof (res as any).body.getReader === 'function';

      console.log('[OpenAIClient] Is SSE:', isSSE);
      console.log('[OpenAIClient] Supports Reader:', supportsReader);

      // Non-SSE responses: parse JSON content or return raw text
      if (!isSSE) {
        console.log('[OpenAIClient] Processing non-SSE response');
        const text = await res.text();
        console.log('[OpenAIClient] Response text:', text);
        try {
          const j = JSON.parse(text);
          const content = j?.choices?.[0]?.message?.content ?? '';
          console.log('[OpenAIClient] Extracted content:', content);
          return typeof content === 'string' ? content : text;
        } catch (parseError) {
          console.error('[OpenAIClient] JSON parse error:', parseError);
          return text;
        }
      }

      // SSE but streaming not supported (React Native fetch): fallback to parsing the full text
      if (isSSE && !supportsReader) {
        console.log('[OpenAIClient] Using SSE fallback (no reader support)');
        const text = await res.text();
        console.log('[OpenAIClient] Raw SSE text length:', text.length);
        console.log('[OpenAIClient] Raw SSE text preview:', text.substring(0, 500));
        let finalText = '';
        const chunks = text.split(/\r?\n\r?\n/);
        console.log('[OpenAIClient] Split into', chunks.length, 'chunks');
        for (const chunk of chunks) {
        const lines = chunk.split(/\r?\n/).map(l => l.replace(/^data:\s?/, '').trim()).filter(Boolean);
          for (const l of lines) {
            if (l === '[DONE]' || l === '"[DONE]"') {
              console.log('[OpenAIClient] Found DONE marker, returning:', finalText.length, 'characters');
              return finalText;
            }
            try {
              const obj = JSON.parse(l);
              const delta = obj?.choices?.[0]?.delta;
              let token = delta?.content as string | undefined;
              if (!token && obj?.choices?.[0]?.message?.content) {
                token = obj.choices[0].message.content as string;
              }
              if (typeof token === 'string' && token.length > 0) {
                if (token.trim().startsWith('{')) {
                  try {
                    const inner = JSON.parse(token);
                    if (inner?.type === 'data-operation') {
                      continue; // ignore control events embedded in content
                    }
                  } catch {}
                }
                finalText += token;
                console.log('[OpenAIClient] Token received:', token);
                onToken?.(token);
              }
            } catch (parseError) {
              console.log('[OpenAIClient] Ignoring non-JSON line:', l);
            }
          }
        }
        console.log('[OpenAIClient] SSE fallback complete, final text length:', finalText.length);
        return finalText;
      }

      // Streaming parse
      console.log('[OpenAIClient] Using streaming reader');
      const decoder = new TextDecoder();
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      let buffer = '';
      let finalText = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log('[OpenAIClient] Stream ended, final text length:', finalText.length);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!chunk) continue;
        // Each SSE event line typically starts with "data: "
        const lines = chunk.split('\n').map(l => l.replace(/^data:\s?/, ''));
        for (const l of lines) {
          if (!l) continue;
            if (l === '[DONE]' || l === '"[DONE]"') {
              // End of stream
              console.log('[OpenAIClient] Stream DONE, returning:', finalText.length, 'characters');
              return finalText;
            }
          try {
            const obj = JSON.parse(l);
            const delta = obj?.choices?.[0]?.delta;
            const token = delta?.content;
            if (typeof token === 'string' && token.length > 0) {
              // Some streams include JSON-encoded control messages in content; skip those
              if (token.trim().startsWith('{')) {
                try {
                  const inner = JSON.parse(token);
                  if (inner?.type === 'data-operation') {
                    continue; // ignore control events
                  }
                } catch {}
              }
                finalText += token;
                console.log('[OpenAIClient] Stream token received:', token);
                onToken?.(token);
              }
            } catch (parseError) {
              console.log('[OpenAIClient] Ignoring non-JSON stream line:', l);
            }
        }
      }
    }

      return finalText;
    } catch (error) {
      console.error('[OpenAIClient] Chat request failed:', error);
      throw error;
    }
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

