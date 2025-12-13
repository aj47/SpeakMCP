/**
 * React context and hooks for SessionConnectionManager
 * 
 * Provides a centralized connection manager that persists across navigation,
 * allowing sessions to maintain their streaming connections when switching views.
 * 
 * Fixes issue #608: Mobile app multi-session state management
 */

import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { SessionConnectionManager, SessionConnectionManagerConfig } from '../lib/sessionConnectionManager';
import { OpenAIConfig, OnConnectionStatusChange } from '../lib/openaiClient';
import { RecoveryState } from '../lib/connectionRecovery';

export interface ConnectionManagerContextValue {
  manager: SessionConnectionManager;
  /** Get or create a connection for a session */
  getOrCreateConnection: (sessionId: string) => ReturnType<SessionConnectionManager['getOrCreateConnection']>;
  /** Get an existing connection without creating */
  getConnection: (sessionId: string) => ReturnType<SessionConnectionManager['getConnection']>;
  /** Increment active request count when a request starts */
  incrementActiveRequests: (sessionId: string) => void;
  /** Decrement active request count when a request completes */
  decrementActiveRequests: (sessionId: string) => void;
  /** Check if a connection is active */
  isConnectionActive: (sessionId: string) => boolean;
  /** Get connection state for a session */
  getConnectionState: (sessionId: string) => RecoveryState | null;
  /** Remove a session's connection */
  removeConnection: (sessionId: string) => void;
  /** Update client config (recreates connections) */
  updateClientConfig: (config: OpenAIConfig) => void;
  /** Subscribe to connection status changes for a session. Returns unsubscribe function. */
  subscribeToConnectionStatus: (sessionId: string, callback: OnConnectionStatusChange) => () => void;
}

export const ConnectionManagerContext = createContext<ConnectionManagerContextValue | null>(null);

/**
 * Hook to access the connection manager
 */
export function useConnectionManager(): ConnectionManagerContextValue {
  const ctx = useContext(ConnectionManagerContext);
  if (!ctx) {
    throw new Error('useConnectionManager must be used within a ConnectionManagerProvider');
  }
  return ctx;
}

/**
 * Hook to create and manage the SessionConnectionManager instance
 * This should be used at the app root level
 */
export function useConnectionManagerProvider(clientConfig: OpenAIConfig): ConnectionManagerContextValue {
  // Use ref to maintain stable manager instance across re-renders
  const managerRef = useRef<SessionConnectionManager | null>(null);
  
  // Track previous config to detect changes
  const prevConfigRef = useRef<OpenAIConfig | null>(null);

  // Create or update manager
  const manager = useMemo(() => {
    // Create new manager if none exists
    if (!managerRef.current) {
      managerRef.current = new SessionConnectionManager({
        clientConfig,
        maxConnections: 3,
      });
    }
    return managerRef.current;
  }, []); // Only create once

  // Update config when it changes (including initial load after async config is ready)
  // This fixes the issue where the manager could be created with default/empty config
  // before the real async config loads (PR review comment #6)
  useEffect(() => {
    const isFirstConfig = prevConfigRef.current === null;
    const configChanged = prevConfigRef.current && (
      prevConfigRef.current.baseUrl !== clientConfig.baseUrl ||
      prevConfigRef.current.apiKey !== clientConfig.apiKey ||
      prevConfigRef.current.model !== clientConfig.model
    );

    if (isFirstConfig) {
      // First config application - update the manager to ensure it has the real config
      // This handles the race condition where manager was created before async config loaded
      console.log('[ConnectionManager] Applying initial config');
      manager.updateClientConfig(clientConfig);
    } else if (configChanged) {
      console.log('[ConnectionManager] Config changed, updating connections');
      manager.updateClientConfig(clientConfig);
    }

    prevConfigRef.current = clientConfig;
  }, [clientConfig, manager]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[ConnectionManager] Cleaning up all connections');
      managerRef.current?.cleanupAll();
    };
  }, []);

  // Create stable context value
  const contextValue = useMemo<ConnectionManagerContextValue>(() => ({
    manager,
    getOrCreateConnection: (sessionId: string) => manager.getOrCreateConnection(sessionId),
    getConnection: (sessionId: string) => manager.getConnection(sessionId),
    incrementActiveRequests: (sessionId: string) => manager.incrementActiveRequests(sessionId),
    decrementActiveRequests: (sessionId: string) => manager.decrementActiveRequests(sessionId),
    isConnectionActive: (sessionId: string) => manager.isConnectionActive(sessionId),
    getConnectionState: (sessionId: string) => manager.getConnectionState(sessionId),
    removeConnection: (sessionId: string) => manager.removeConnection(sessionId),
    updateClientConfig: (config: OpenAIConfig) => manager.updateClientConfig(config),
    subscribeToConnectionStatus: (sessionId: string, callback: OnConnectionStatusChange) =>
      manager.subscribeToConnectionStatus(sessionId, callback),
  }), [manager]);

  return contextValue;
}

