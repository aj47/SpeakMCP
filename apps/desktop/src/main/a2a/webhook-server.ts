/**
 * A2A Webhook Server
 * 
 * HTTP server for receiving A2A push notifications.
 * Agents can send task updates to the webhook URL when tasks complete or update.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { A2AStreamEvent, A2ATask, A2APushNotificationConfig } from './types';
import { a2aTaskManager } from './task-manager';

function logA2A(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [A2A Webhook]`, ...args);
}

/**
 * Webhook event handler callback.
 */
export type WebhookEventHandler = (event: {
  taskId: string;
  event: A2AStreamEvent;
  headers: Record<string, string | string[] | undefined>;
}) => void;

/**
 * Options for the webhook server.
 */
export interface WebhookServerOptions {
  /** Port to listen on (default: 0 for auto-assign) */
  port?: number;
  /** Host to bind to (default: 127.0.0.1) */
  host?: string;
  /** Path prefix for webhook endpoints (default: /a2a/webhook) */
  pathPrefix?: string;
  /** Expected authentication tokens per task */
  expectedTokens?: Map<string, string>;
}

/**
 * A2A Webhook Server for receiving push notifications.
 */
export class A2AWebhookServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private host: string = '127.0.0.1';
  private pathPrefix: string = '/a2a/webhook';
  private handlers: Set<WebhookEventHandler> = new Set();
  private expectedTokens: Map<string, string> = new Map();
  private isRunning: boolean = false;

  constructor(options?: WebhookServerOptions) {
    if (options) {
      if (options.port !== undefined) this.port = options.port;
      if (options.host) this.host = options.host;
      if (options.pathPrefix) this.pathPrefix = options.pathPrefix;
      if (options.expectedTokens) this.expectedTokens = options.expectedTokens;
    }
  }

  /**
   * Set the port before starting the server.
   * Must be called before start() to take effect.
   * 
   * @param port - The port to listen on (0 for auto-assign)
   */
  setPort(port: number): void {
    if (this.isRunning) {
      throw new Error('Cannot change port while server is running');
    }
    this.port = port;
  }

  /**
   * Start the webhook server.
   * 
   * @returns The actual port the server is listening on
   */
  async start(): Promise<number> {
    if (this.isRunning) {
      return this.port;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        logA2A('Server error:', error);
        reject(error);
      });

      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
        }

        this.isRunning = true;
        logA2A(`Webhook server started on ${this.host}:${this.port}`);
        resolve(this.port);
      });
    });
  }

  /**
   * Stop the webhook server.
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          logA2A('Error stopping server:', error);
          reject(error);
        } else {
          this.isRunning = false;
          this.server = null;
          logA2A('Webhook server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Get the webhook URL for a specific task.
   * 
   * @param taskId - The task ID
   * @returns The webhook URL
   */
  getWebhookUrl(taskId: string): string {
    // URL-encode the task ID
    const encodedTaskId = encodeURIComponent(taskId);
    return `http://${this.host}:${this.port}${this.pathPrefix}/${encodedTaskId}`;
  }

  /**
   * Generate a push notification config for a task.
   * 
   * @param taskId - The task ID
   * @returns The push notification config
   */
  generateConfig(taskId: string): A2APushNotificationConfig {
    // Generate a cryptographically secure random token for authentication
    // Using crypto.randomBytes instead of Math.random() for security
    const token = crypto.randomBytes(32).toString('hex');
    
    // Store the expected token
    this.expectedTokens.set(taskId, token);

    return {
      id: `config_${taskId}`,
      url: this.getWebhookUrl(taskId),
      token,
      events: ['completed', 'failed', 'canceled'],
    };
  }

  /**
   * Add an event handler.
   * 
   * @param handler - The event handler
   * @returns Unsubscribe function
   */
  onNotification(handler: WebhookEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Handle incoming HTTP request.
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Only accept POST requests
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Parse the path to extract task ID
    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    // Escape regex metacharacters in pathPrefix to prevent incorrect matching
    const escapedPrefix = this.pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pathMatch = url.pathname.match(new RegExp(`^${escapedPrefix}/(.+)$`));
    
    if (!pathMatch) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Safely decode the task ID, returning 400 for malformed percent-encoding
    let taskId: string;
    try {
      taskId = decodeURIComponent(pathMatch[1]);
    } catch {
      logA2A(`Invalid task ID encoding: ${pathMatch[1]}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid task ID encoding' }));
      return;
    }

    // Verify authentication token - reject unknown task IDs to prevent injection
    const authHeader = req.headers['authorization'];
    const expectedToken = this.expectedTokens.get(taskId);

    // If no token is registered for this task ID, reject the request
    // This prevents unauthorized task update injection for unknown tasks
    if (!expectedToken) {
      logA2A(`Unknown task ID rejected: ${taskId}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown task' }));
      return;
    }

    // Verify the provided token matches the expected token
    const providedToken = authHeader?.replace(/^Bearer\s+/i, '');
    if (providedToken !== expectedToken) {
      logA2A(`Unauthorized webhook request for task ${taskId}`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Collect request body
    let body = '';
    let sizeLimitExceeded = false;
    req.on('data', (chunk) => {
      if (sizeLimitExceeded) return; // Skip further processing
      
      body += chunk.toString();
      
      // Limit body size to prevent abuse
      if (body.length > 1024 * 1024) {
        sizeLimitExceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      // Skip processing if size limit was exceeded (response already sent)
      if (sizeLimitExceeded) return;
      try {
        const event = JSON.parse(body) as A2AStreamEvent;
        
        logA2A(`Received webhook for task ${taskId}:`, { event });

        // Apply to task manager
        a2aTaskManager.applyStreamEvent(taskId, event);

        // Notify handlers
        const headers: Record<string, string | string[] | undefined> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          headers[key] = value;
        }

        for (const handler of this.handlers) {
          try {
            handler({ taskId, event, headers });
          } catch (error) {
            logA2A('Handler error:', error);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

        // Clean up token after terminal events
        // Handle both statusUpdate events and full task events with terminal states
        if ('statusUpdate' in event) {
          const state = event.statusUpdate.status.state;
          if (['completed', 'failed', 'canceled', 'rejected'].includes(state)) {
            this.expectedTokens.delete(taskId);
          }
        } else if ('task' in event && event.task?.status?.state) {
          const state = event.task.status.state;
          if (['completed', 'failed', 'canceled', 'rejected'].includes(state)) {
            this.expectedTokens.delete(taskId);
          }
        }
      } catch (error) {
        logA2A('Error processing webhook:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    req.on('error', (error) => {
      logA2A('Request error:', error);
      // Guard against writing after response is already ended (e.g., after 413 response)
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  }

  /**
   * Check if the server is running.
   */
  isListening(): boolean {
    return this.isRunning;
  }

  /**
   * Get the current port.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the full base URL.
   */
  getBaseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Clear all expected tokens.
   */
  clearTokens(): void {
    this.expectedTokens.clear();
  }

  /**
   * Serialize state for debugging.
   */
  toJSON(): object {
    return {
      isRunning: this.isRunning,
      port: this.port,
      host: this.host,
      pathPrefix: this.pathPrefix,
      handlerCount: this.handlers.size,
      tokenCount: this.expectedTokens.size,
    };
  }
}

/** Singleton instance of the A2A webhook server */
export const a2aWebhookServer = new A2AWebhookServer();
