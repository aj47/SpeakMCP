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
  activeRequestCount: number;
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
   * If max connections is reached, the least recently used inactive connection will be evicted.
   * If all connections are active (streaming), allows temporary overflow to avoid disrupting streams.
   */
  getOrCreateConnection(sessionId: string): SessionConnection {
    // Check if connection already exists
    let connection = this.connections.get(sessionId);

    if (connection) {
      // Update last accessed time
      connection.lastAccessedAt = Date.now();
      return connection;
    }

    // Try to evict LRU inactive connection if at max capacity
    if (this.connections.size >= this.maxConnections) {
      const evicted = this.evictLRUConnection();
      if (!evicted) {
        // All connections are active - allow temporary overflow to protect streams
        // This will resolve when streams complete and connections become inactive
        console.log('[SessionConnectionManager] Allowing temporary overflow due to active streams, current count:', this.connections.size);
      }
    }

    // Create new connection
    const client = new OpenAIClient(this.clientConfig);
    
    connection = {
      sessionId,
      client,
      lastAccessedAt: Date.now(),
      activeRequestCount: 0,
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
   * Increment the active request count for a session connection.
   * Called when a new request starts.
   */
  incrementActiveRequests(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.activeRequestCount++;
      connection.lastAccessedAt = Date.now();
    }
  }

  /**
   * Decrement the active request count for a session connection.
   * Called when a request completes. Will not go below 0.
   * Also attempts to trim overflow if the cache is above maxConnections.
   */
  decrementActiveRequests(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.activeRequestCount = Math.max(0, connection.activeRequestCount - 1);
      connection.lastAccessedAt = Date.now();

      // After a request completes, try to trim overflow if we're above maxConnections
      // This ensures the cache eventually returns to the configured limit (PR review fix #12)
      this.tryTrimOverflow();
    }
  }

  /**
   * Attempts to trim the connection cache back to maxConnections by evicting
   * inactive connections. This is called after requests complete to clean up
   * any temporary overflow that was allowed to protect active streams.
   */
  private tryTrimOverflow(): void {
    // Keep evicting LRU inactive connections until we're at or below maxConnections
    while (this.connections.size > this.maxConnections) {
      const evicted = this.evictLRUConnection();
      if (!evicted) {
        // All remaining connections are active, stop trying
        break;
      }
    }
  }

  /**
   * Check if a session has an active connection (any in-flight requests)
   */
  isConnectionActive(sessionId: string): boolean {
    return (this.connections.get(sessionId)?.activeRequestCount ?? 0) > 0;
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
   * Note: This preserves UI subscriptions (sessionCallbacks) so mounted components
   * will continue to receive updates when new connections are created
   */
  updateClientConfig(newConfig: OpenAIConfig): void {
    this.clientConfig = newConfig;
    // Clear connections only - preserve callbacks so UI components continue to work
    // The callbacks are managed by component lifecycle (via unsubscribe on unmount),
    // not connection lifecycle. They'll start receiving updates when new connections
    // are created for each session.
    this.cleanupConnectionsOnly();
  }

  /**
   * Internal method to cleanup connections without clearing callbacks.
   * Used by updateClientConfig to preserve UI subscriptions during config changes.
   */
  private cleanupConnectionsOnly(): void {
    for (const connection of this.connections.values()) {
      connection.client.cleanup();
    }
    this.connections.clear();
    console.log('[SessionConnectionManager] Connections cleared (callbacks preserved)');
  }

  /**
   * Cleanup all connections and callbacks.
   * Use this for full teardown (e.g., app unmount).
   */
  cleanupAll(): void {
    for (const connection of this.connections.values()) {
      connection.client.cleanup();
    }
    this.connections.clear();
    // Clear all session callbacks to prevent memory leaks from stale UI subscriptions
    this.sessionCallbacks.clear();
    console.log('[SessionConnectionManager] Full cleanup complete (connections and callbacks)');
  }

  /**
   * Get the number of active connections (sessions with at least one in-flight request)
   */
  getActiveConnectionCount(): number {
    return Array.from(this.connections.values()).filter(c => c.activeRequestCount > 0).length;
  }

  /**
   * Get all session IDs with connections
   */
  getConnectedSessionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Attempts to evict the least recently used inactive connection.
   * Returns true if a connection was evicted, false if all connections are active.
   * This protects active streaming connections from being aborted unexpectedly.
   */
  private evictLRUConnection(): boolean {
    let lruSessionId: string | null = null;
    let lruTime = Infinity;

    // Find the least recently used INACTIVE connection only
    // We do NOT evict active connections to prevent stream crashes (fixes PR review feedback)
    for (const [sessionId, connection] of this.connections) {
      if (connection.activeRequestCount === 0 && connection.lastAccessedAt < lruTime) {
        lruTime = connection.lastAccessedAt;
        lruSessionId = sessionId;
      }
    }

    if (lruSessionId) {
      console.log('[SessionConnectionManager] Evicting LRU inactive connection:', lruSessionId);
      this.removeConnection(lruSessionId);
      return true;
    }

    // All connections are active - don't evict any to protect in-flight streams
    console.warn('[SessionConnectionManager] All connections are active, cannot evict without disrupting streams');
    return false;
  }
}

