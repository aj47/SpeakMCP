/**
 * SessionConnectionManager - Manages OpenAI client connections per session
 * 
 * This manager maintains active connections for multiple sessions, allowing users
 * to switch between sessions without losing streaming connections. It implements:
 * - Connection caching per session
 * - LRU eviction when max connections is reached
 * - Graceful cleanup when sessions are deleted
 * - Connection state preservation during navigation
 * 
 * Fixes issue #608: Mobile app multi-session state management
 */

import { OpenAIClient, OpenAIConfig, OnConnectionStatusChange } from './openaiClient';
import { RecoveryState } from './connectionRecovery';

export interface SessionConnection {
  sessionId: string;
  client: OpenAIClient;
  lastAccessedAt: number;
  isActive: boolean;
  connectionState: RecoveryState | null;
}

export interface SessionConnectionManagerConfig {
  /** Maximum number of concurrent session connections to maintain (default: 3) */
  maxConnections?: number;
  /** OpenAI client configuration */
  clientConfig: OpenAIConfig;
}

/**
 * Manages OpenAI client connections across multiple sessions.
 * Allows switching between sessions without losing active connections.
 */
export class SessionConnectionManager {
  private connections: Map<string, SessionConnection> = new Map();
  private maxConnections: number;
  private clientConfig: OpenAIConfig;
  private globalConnectionStatusCallback?: OnConnectionStatusChange;
  /** Per-session callback subscriptions for UI components */
  private sessionCallbacks: Map<string, Set<OnConnectionStatusChange>> = new Map();

  constructor(config: SessionConnectionManagerConfig) {
    this.maxConnections = config.maxConnections ?? 3;
    this.clientConfig = config.clientConfig;
  }

  /**
   * Set a global callback for connection status changes across all sessions
   */
  setGlobalConnectionStatusCallback(callback: OnConnectionStatusChange): void {
    this.globalConnectionStatusCallback = callback;
  }

  /**
   * Get or create a connection for a session.
   * If the session already has a connection, it will be reused.
   * If max connections is reached, the least recently used connection will be evicted.
   */
  getOrCreateConnection(sessionId: string): SessionConnection {
    // Check if connection already exists
    let connection = this.connections.get(sessionId);
    
    if (connection) {
      // Update last accessed time
      connection.lastAccessedAt = Date.now();
      return connection;
    }

    // Evict LRU connection if at max capacity
    if (this.connections.size >= this.maxConnections) {
      this.evictLRUConnection();
    }

    // Create new connection
    const client = new OpenAIClient(this.clientConfig);
    
    connection = {
      sessionId,
      client,
      lastAccessedAt: Date.now(),
      isActive: false,
      connectionState: null,
    };

    // Set up connection status callback that notifies both internal state and subscribers
    client.setConnectionStatusCallback((state) => {
      connection!.connectionState = state;
      this.globalConnectionStatusCallback?.(state);
      // Notify all session-specific subscribers
      this.notifySessionSubscribers(sessionId, state);
    });

    this.connections.set(sessionId, connection);
    return connection;
  }

  /**
   * Subscribe to connection status changes for a specific session.
   * This allows UI components to receive updates without overwriting the internal callback.
   * Returns an unsubscribe function.
   */
  subscribeToConnectionStatus(
    sessionId: string,
    callback: OnConnectionStatusChange
  ): () => void {
    let callbacks = this.sessionCallbacks.get(sessionId);
    if (!callbacks) {
      callbacks = new Set();
      this.sessionCallbacks.set(sessionId, callbacks);
    }
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      const cbs = this.sessionCallbacks.get(sessionId);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.sessionCallbacks.delete(sessionId);
        }
      }
    };
  }

  /**
   * Notify all subscribers for a specific session
   */
  private notifySessionSubscribers(sessionId: string, state: RecoveryState): void {
    const callbacks = this.sessionCallbacks.get(sessionId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(state);
        } catch (error) {
          console.error('[SessionConnectionManager] Subscriber callback error:', error);
        }
      }
    }
  }

  /**
   * Get an existing connection for a session without creating a new one
   */
  getConnection(sessionId: string): SessionConnection | undefined {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.lastAccessedAt = Date.now();
    }
    return connection;
  }

  /**
   * Mark a session connection as active (currently in use for streaming)
   */
  setConnectionActive(sessionId: string, isActive: boolean): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.isActive = isActive;
      connection.lastAccessedAt = Date.now();
    }
  }

  /**
   * Check if a session has an active connection
   */
  isConnectionActive(sessionId: string): boolean {
    return this.connections.get(sessionId)?.isActive ?? false;
  }

  /**
   * Get the connection state for a session
   */
  getConnectionState(sessionId: string): RecoveryState | null {
    return this.connections.get(sessionId)?.connectionState ?? null;
  }

  /**
   * Remove a specific session's connection (e.g., when session is deleted)
   */
  removeConnection(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.client.cleanup();
      this.connections.delete(sessionId);
    }
    // Also clean up any session-specific callbacks
    this.sessionCallbacks.delete(sessionId);
  }

  /**
   * Update the client configuration for all connections
   * This will recreate connections with the new config
   */
  updateClientConfig(newConfig: OpenAIConfig): void {
    this.clientConfig = newConfig;
    // Clear all existing connections - they'll be recreated with new config on next access
    this.cleanupAll();
  }

  /**
   * Cleanup all connections
   */
  cleanupAll(): void {
    for (const connection of this.connections.values()) {
      connection.client.cleanup();
    }
    this.connections.clear();
  }

  /**
   * Get the number of active connections
   */
  getActiveConnectionCount(): number {
    return Array.from(this.connections.values()).filter(c => c.isActive).length;
  }

  /**
   * Get all session IDs with connections
   */
  getConnectedSessionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  private evictLRUConnection(): void {
    let lruSessionId: string | null = null;
    let lruTime = Infinity;

    // Find the least recently used inactive connection
    for (const [sessionId, connection] of this.connections) {
      // Prefer evicting inactive connections
      if (!connection.isActive && connection.lastAccessedAt < lruTime) {
        lruTime = connection.lastAccessedAt;
        lruSessionId = sessionId;
      }
    }

    // If all connections are active, evict the oldest one anyway
    if (!lruSessionId) {
      for (const [sessionId, connection] of this.connections) {
        if (connection.lastAccessedAt < lruTime) {
          lruTime = connection.lastAccessedAt;
          lruSessionId = sessionId;
        }
      }
    }

    if (lruSessionId) {
      console.log('[SessionConnectionManager] Evicting LRU connection:', lruSessionId);
      this.removeConnection(lruSessionId);
    }
  }
}

