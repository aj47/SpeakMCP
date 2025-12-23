/**
 * React context and hooks for TunnelConnectionManager
 * 
 * Provides tunnel connection state management with persistence,
 * auto-reconnection, and UI status feedback.
 * 
 * Implements issue #696: Improve mobile tunnel persistence and reconnection reliability
 */

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import {
  TunnelConnectionManager,
  TunnelConnectionInfo,
  TunnelConnectionState,
} from '../lib/tunnelConnectionManager';

export interface TunnelConnectionContextValue {
  /** Current connection state */
  connectionInfo: TunnelConnectionInfo;
  /** Whether the manager is initialized */
  isInitialized: boolean;
  /** Connect to a tunnel endpoint */
  connect: (baseUrl: string, apiKey: string) => Promise<boolean>;
  /** Disconnect and clear stored metadata */
  disconnect: () => Promise<void>;
  /** Check connection health and reconnect if needed */
  checkAndReconnect: () => Promise<void>;
  /** Get the underlying tunnel manager */
  getManager: () => TunnelConnectionManager;
}

const defaultConnectionInfo: TunnelConnectionInfo = {
  state: 'disconnected',
  deviceId: null,
  baseUrl: null,
  lastConnectedAt: null,
  retryCount: 0,
  errorMessage: null,
};

export const TunnelConnectionContext = createContext<TunnelConnectionContextValue | null>(null);

/**
 * Hook to access the tunnel connection context
 */
export function useTunnelConnection(): TunnelConnectionContextValue {
  const ctx = useContext(TunnelConnectionContext);
  if (!ctx) {
    throw new Error('useTunnelConnection must be used within a TunnelConnectionProvider');
  }
  return ctx;
}

/**
 * Hook to create and manage the TunnelConnectionManager instance.
 * This should be used at the app root level.
 */
export function useTunnelConnectionProvider(): TunnelConnectionContextValue {
  const managerRef = useRef<TunnelConnectionManager | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<TunnelConnectionInfo>(defaultConnectionInfo);
  const [isInitialized, setIsInitialized] = useState(false);

  // Create manager on mount
  useEffect(() => {
    const manager = new TunnelConnectionManager();
    managerRef.current = manager;

    // Subscribe to state changes
    manager.setOnStateChange((info) => {
      setConnectionInfo(info);
    });

    // Initialize the manager (loads device identity and attempts reconnection)
    manager.initialize().then(() => {
      setIsInitialized(true);
      setConnectionInfo(manager.getConnectionInfo());
    });

    return () => {
      manager.cleanup();
      managerRef.current = null;
    };
  }, []);

  const connect = useCallback(async (baseUrl: string, apiKey: string): Promise<boolean> => {
    if (!managerRef.current) {
      console.error('[TunnelConnection] Manager not initialized');
      return false;
    }
    return managerRef.current.connect(baseUrl, apiKey);
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!managerRef.current) {
      return;
    }
    await managerRef.current.disconnect();
  }, []);

  const checkAndReconnect = useCallback(async (): Promise<void> => {
    if (!managerRef.current) {
      return;
    }
    await managerRef.current.checkAndReconnect();
  }, []);

  const getManager = useCallback((): TunnelConnectionManager => {
    if (!managerRef.current) {
      throw new Error('TunnelConnectionManager not initialized');
    }
    return managerRef.current;
  }, []);

  return {
    connectionInfo,
    isInitialized,
    connect,
    disconnect,
    checkAndReconnect,
    getManager,
  };
}

/**
 * Hook to get just the connection state (for UI components)
 */
export function useTunnelConnectionState(): TunnelConnectionState {
  const { connectionInfo } = useTunnelConnection();
  return connectionInfo.state;
}

/**
 * Hook to check if currently connected
 */
export function useIsTunnelConnected(): boolean {
  const state = useTunnelConnectionState();
  return state === 'connected';
}

