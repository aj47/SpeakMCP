import { useState, useEffect, useCallback, useRef } from 'react';
import { RecoveryState } from '../../../lib/connectionRecovery';
import { useConnectionManager } from '../../../store/connectionManager';
import { useSessionContext } from '../../../store/sessions';

export interface ConnectionManagementResult {
  responding: boolean;
  setResponding: (value: boolean) => void;
  connectionState: RecoveryState | null;
  setConnectionState: (value: RecoveryState | null) => void;
  activeRequestIdRef: React.MutableRefObject<number>;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  getSessionClient: () => any;
}

export function useConnectionManagement(): ConnectionManagementResult {
  const [responding, setResponding] = useState(false);
  const [connectionState, setConnectionState] = useState<RecoveryState | null>(null);
  const activeRequestIdRef = useRef<number>(0);
  const sessionStore = useSessionContext();
  const connectionManager = useConnectionManager();

  // Stable ref for current session ID to avoid stale closures in callbacks
  const currentSessionIdRef = useRef<string | null>(sessionStore.currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = sessionStore.currentSessionId;
  }, [sessionStore.currentSessionId]);

  // Get or create a connection for the current session using the connection manager
  const getSessionClient = useCallback(() => {
    const currentSessionId = sessionStore.currentSessionId;
    if (!currentSessionId) {
      console.warn('[ChatScreen] No current session ID, cannot get client');
      return null;
    }
    const connection = connectionManager.getOrCreateConnection(currentSessionId);
    return connection.client;
  }, [connectionManager, sessionStore.currentSessionId]);

  // Subscribe to connection status changes for the current session
  useEffect(() => {
    const currentSessionId = sessionStore.currentSessionId;
    if (!currentSessionId) {
      // Reset both connection state and responding state when there's no session
      setConnectionState(null);
      setResponding(false);
      return;
    }

    // Restore existing connection state when switching sessions
    const existingState = connectionManager.getConnectionState(currentSessionId);
    if (existingState) {
      setConnectionState(existingState);
    } else {
      setConnectionState(null);
    }

    // Check if there's an active request for this session
    const isActive = connectionManager.isConnectionActive(currentSessionId);
    setResponding(isActive);

    // Ensure connection exists for subscription
    connectionManager.getOrCreateConnection(currentSessionId);

    // Subscribe to connection status changes for this session
    const unsubscribe = connectionManager.subscribeToConnectionStatus(
      currentSessionId,
      (state) => {
        // Only update UI if this is still the current session
        if (currentSessionIdRef.current === currentSessionId) {
          setConnectionState(state);
        }
      }
    );

    return unsubscribe;
  }, [sessionStore.currentSessionId, connectionManager]);

  return {
    responding,
    setResponding,
    connectionState,
    setConnectionState,
    activeRequestIdRef,
    currentSessionIdRef,
    getSessionClient,
  };
}
