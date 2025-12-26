/**
 * A2A Client
 * 
 * Client for communicating with A2A-compatible agents.
 * Implements the A2A protocol operations: message/send, tasks/get, tasks/cancel.
 */

import type {
  A2ATask,
  A2AMessage,
  A2ASendMessageRequest,
  A2ASendMessageResponse,
  A2AStreamEvent,
  A2AError,
  A2ATaskState,
} from './types';
import { isTerminalState } from './types';

function logA2A(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [A2A Client]`, ...args);
}

/**
 * Options for A2A client operations.
 */
export interface A2AClientOptions {
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Custom headers to include */
  headers?: Record<string, string>;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Authentication token */
  authToken?: string;
}

/**
 * JSON-RPC 2.0 request structure.
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC 2.0 response structure.
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * A2A Client for communicating with A2A-compatible agents.
 */
export class A2AClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private requestIdCounter: number = 0;

  constructor(baseUrl: string, options?: { headers?: Record<string, string> }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options?.headers,
    };
  }

  /**
   * Generate a new request ID.
   */
  private nextRequestId(): number {
    return ++this.requestIdCounter;
  }

  /**
   * Build headers for a request.
   */
  private buildHeaders(options?: A2AClientOptions): Record<string, string> {
    const headers: Record<string, string> = { ...this.defaultHeaders };

    if (options?.headers) {
      Object.assign(headers, options.headers);
    }

    if (options?.authToken) {
      headers['Authorization'] = `Bearer ${options.authToken}`;
    }

    return headers;
  }

  /**
   * Make a JSON-RPC request.
   */
  private async rpcRequest<T>(
    method: string,
    params: unknown,
    options?: A2AClientOptions
  ): Promise<T> {
    const { timeoutMs = 30000 } = options || {};

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextRequestId(),
      method,
      params,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Chain with external abort signal if provided, and track for cleanup
    const abortHandler = () => controller.abort();
    if (options?.signal) {
      options.signal.addEventListener('abort', abortHandler);
    }

    try {
      logA2A(`RPC request: ${method}`, { params });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.buildHeaders(options),
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const jsonResponse: JsonRpcResponse = await response.json();

      if (jsonResponse.error) {
        const error: A2AError = {
          code: 'INTERNAL_ERROR',
          message: jsonResponse.error.message,
          data: jsonResponse.error.data,
        };
        throw error;
      }

      logA2A(`RPC response: ${method}`, { result: jsonResponse.result });
      return jsonResponse.result as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout or aborted');
      }

      throw error;
    } finally {
      // Clean up event listener to prevent memory leaks
      if (options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  /**
   * Send a message to the agent and get a task or response.
   * Maps to A2A operation: Send Message (message/send)
   * 
   * @param request - The message request
   * @param options - Client options
   * @returns Task or direct message response
   */
  async sendMessage(
    request: A2ASendMessageRequest,
    options?: A2AClientOptions
  ): Promise<A2ASendMessageResponse> {
    const params = {
      message: request.message,
      configuration: request.configuration,
      taskId: request.taskId,
    };

    const result = await this.rpcRequest<{ task?: A2ATask; message?: A2AMessage }>(
      'message/send',
      params,
      options
    );

    if (result.task) {
      return { task: result.task };
    } else if (result.message) {
      return { message: result.message };
    }

    // Fallback: treat the result as a task
    return { task: result as unknown as A2ATask };
  }

  /**
   * Send a streaming message to the agent.
   * Maps to A2A operation: Send Streaming Message (message/stream)
   * 
   * @param request - The message request
   * @param options - Client options
   * @returns Async generator of stream events
   */
  async *sendStreamingMessage(
    request: A2ASendMessageRequest,
    options?: A2AClientOptions
  ): AsyncGenerator<A2AStreamEvent> {
    const { timeoutMs = 120000 } = options || {};

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), timeoutMs);

    // Helper to reset the timeout (called on each chunk received)
    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    };

    // Helper to clear timeout completely
    const clearStreamTimeout = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const abortHandler = () => controller.abort();
    if (options?.signal) {
      options.signal.addEventListener('abort', abortHandler);
    }

    try {
      const headers = {
        ...this.buildHeaders(options),
        Accept: 'text/event-stream',
      };

      const body: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: this.nextRequestId(),
        method: 'message/stream',
        params: {
          message: request.message,
          configuration: request.configuration,
          taskId: request.taskId,
        },
      };

      logA2A('Starting streaming request');

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Reset timeout after fetch completes - timeout now covers stream read
      resetTimeout();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          logA2A('Stream ended');
          break;
        }

        // Reset timeout on each chunk received
        resetTimeout();

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              return;
            }

            try {
              const event = JSON.parse(data) as A2AStreamEvent;
              logA2A('Stream event received', { event });
              yield event;

              // Check for terminal state
              if ('task' in event && isTerminalState(event.task.status.state)) {
                return;
              }
              if ('statusUpdate' in event && isTerminalState(event.statusUpdate.status.state)) {
                return;
              }
            } catch (parseError) {
              logA2A('Failed to parse stream event:', parseError);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Stream timeout or aborted');
      }
      throw error;
    } finally {
      clearStreamTimeout();
      if (options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  /**
   * Get the current state of a task.
   * Maps to A2A operation: Get Task (tasks/get)
   * 
   * @param taskId - The task ID (format: tasks/{id})
   * @param historyLength - Optional number of history messages to include
   * @param options - Client options
   * @returns The current task state
   */
  async getTask(
    taskId: string,
    historyLength?: number,
    options?: A2AClientOptions
  ): Promise<A2ATask> {
    const params = {
      name: taskId,
      historyLength,
    };

    return this.rpcRequest<A2ATask>('tasks/get', params, options);
  }

  /**
   * Cancel a running task.
   * Maps to A2A operation: Cancel Task (tasks/cancel)
   * 
   * @param taskId - The task ID to cancel
   * @param options - Client options
   * @returns The updated task state
   */
  async cancelTask(
    taskId: string,
    options?: A2AClientOptions
  ): Promise<A2ATask> {
    const params = {
      name: taskId,
    };

    return this.rpcRequest<A2ATask>('tasks/cancel', params, options);
  }

  /**
   * List tasks with optional filtering.
   * Maps to A2A operation: List Tasks (tasks/list)
   * 
   * @param filter - Optional filter criteria
   * @param options - Client options
   * @returns List of tasks and pagination info
   */
  async listTasks(
    filter?: {
      contextId?: string;
      status?: A2ATaskState;
      pageSize?: number;
      pageToken?: string;
      historyLength?: number;
      includeArtifacts?: boolean;
    },
    options?: A2AClientOptions
  ): Promise<{
    tasks: A2ATask[];
    nextPageToken: string;
    pageSize: number;
    totalSize: number;
  }> {
    return this.rpcRequest('tasks/list', filter || {}, options);
  }

  /**
   * Subscribe to task updates via streaming.
   * Maps to A2A operation: Subscribe to Task (tasks/subscribe)
   * 
   * @param taskId - The task ID to subscribe to
   * @param options - Client options
   * @returns Async generator of stream events
   */
  async *subscribeToTask(
    taskId: string,
    options?: A2AClientOptions
  ): AsyncGenerator<A2AStreamEvent> {
    const { timeoutMs = 300000 } = options || {};

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), timeoutMs);

    // Helper to reset the timeout (called on each chunk received)
    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    };

    // Helper to clear timeout completely
    const clearStreamTimeout = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const abortHandler = () => controller.abort();
    if (options?.signal) {
      options.signal.addEventListener('abort', abortHandler);
    }

    try {
      const headers = {
        ...this.buildHeaders(options),
        Accept: 'text/event-stream',
      };

      const body: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: this.nextRequestId(),
        method: 'tasks/subscribe',
        params: { name: taskId },
      };

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Reset timeout after fetch completes - timeout now covers stream read
      resetTimeout();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Reset timeout on each chunk received
        resetTimeout();

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              return;
            }

            try {
              const event = JSON.parse(data) as A2AStreamEvent;
              yield event;

              if ('statusUpdate' in event && isTerminalState(event.statusUpdate.status.state)) {
                return;
              }
            } catch (parseError) {
              logA2A('Failed to parse subscription event:', parseError);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Subscription timeout or aborted');
      }
      throw error;
    } finally {
      clearStreamTimeout();
      if (options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  /**
   * Helper: Send a simple text message and wait for completion.
   * 
   * @param text - The text to send
   * @param contextId - Optional context ID
   * @param options - Client options
   * @returns The final task or message
   */
  async sendText(
    text: string,
    contextId?: string,
    options?: A2AClientOptions
  ): Promise<A2ASendMessageResponse> {
    const request: A2ASendMessageRequest = {
      message: {
        role: 'user',
        parts: [{ text }],
      },
      configuration: contextId ? { contextId } : undefined,
    };

    return this.sendMessage(request, options);
  }

  /**
   * Helper: Send a text message and poll for completion.
   * 
   * @param text - The text to send
   * @param pollIntervalMs - Polling interval in milliseconds
   * @param maxWaitMs - Maximum wait time in milliseconds
   * @param options - Client options
   * @returns The final task state
   */
  async sendTextAndWait(
    text: string,
    pollIntervalMs: number = 1000,
    maxWaitMs: number = 60000,
    options?: A2AClientOptions
  ): Promise<A2ATask> {
    const response = await this.sendText(text, undefined, options);

    if ('message' in response) {
      // Direct response, no task to poll
      return {
        id: `tasks/direct_${Date.now()}`,
        status: {
          state: 'completed',
          message: response.message,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const task = response.task;

    // If already complete, return immediately
    if (isTerminalState(task.status.state)) {
      return task;
    }

    // Poll for completion
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      const updatedTask = await this.getTask(task.id, undefined, options);

      if (isTerminalState(updatedTask.status.state)) {
        return updatedTask;
      }
    }

    throw new Error(`Task did not complete within ${maxWaitMs}ms`);
  }
}

/**
 * Create an A2A client for the given base URL.
 */
export function createA2AClient(
  baseUrl: string,
  options?: { headers?: Record<string, string> }
): A2AClient {
  return new A2AClient(baseUrl, options);
}
