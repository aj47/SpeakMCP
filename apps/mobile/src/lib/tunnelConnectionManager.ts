import { AppState, AppStateStatus } from 'react-native';
import { getDeviceIdentity } from './deviceIdentity';
import {
  TunnelMetadata,
  saveTunnelMetadata,
  loadTunnelMetadata,
  updateTunnelMetadata,
  clearTunnelMetadata,
} from './tunnelPersistence';
import { OpenAIClient, OpenAIConfig } from './openaiClient';
import { RecoveryState, ConnectionStatus } from './connectionRecovery';

/**
 * Connection state for UI display
 */
export type TunnelConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface TunnelConnectionInfo {
  state: TunnelConnectionState;
  deviceId: string | null;
  baseUrl: string | null;
  lastConnectedAt: number | null;
  retryCount: number;
  errorMessage: string | null;
}

export type OnTunnelStateChange = (info: TunnelConnectionInfo) => void;

/**
 * Manages tunnel connection lifecycle with persistence and auto-recovery.
 * 
 * Features:
 * - Persistent device identity for stable tunnel identification
 * - Automatic reconnection on app foreground
 * - Connection state tracking for UI feedback
 * - Tunnel metadata persistence for session resumption
 */
export class TunnelConnectionManager {
  private client: OpenAIClient | null = null;
  private deviceId: string | null = null;
  private metadata: TunnelMetadata | null = null;
  private connectionState: TunnelConnectionState = 'disconnected';
  private retryCount: number = 0;
  private errorMessage: string | null = null;
  private onStateChange: OnTunnelStateChange | null = null;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private isInitialized: boolean = false;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.setupAppStateListener();
  }

  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
  }

  private handleAppStateChange = async (nextAppState: AppStateStatus): Promise<void> => {
    if (nextAppState === 'active' && this.isInitialized && this.metadata) {
      // App came to foreground - check connection health
      console.log('[TunnelConnectionManager] App became active, checking connection');
      await this.checkAndReconnect();
    }
  };

  /**
   * Initialize the manager and attempt to restore previous connection.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Get or create device identity
    const identity = await getDeviceIdentity();
    this.deviceId = identity.deviceId;
    console.log('[TunnelConnectionManager] Device ID:', this.deviceId);

    // Try to load previous tunnel metadata
    this.metadata = await loadTunnelMetadata();
    if (this.metadata) {
      console.log('[TunnelConnectionManager] Found previous tunnel metadata');
      // Attempt to reconnect to previous tunnel
      await this.attemptReconnect();
    }

    this.isInitialized = true;
  }

  /**
   * Connect to a new tunnel endpoint.
   */
  async connect(baseUrl: string, apiKey: string): Promise<boolean> {
    this.updateState('connecting');

    // Clear any pending reconnect timeout to avoid race conditions
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    // Ensure we have device identity
    if (!this.deviceId) {
      const identity = await getDeviceIdentity();
      this.deviceId = identity.deviceId;
    }

    // Create new client
    const config: OpenAIConfig = {
      baseUrl,
      apiKey,
      recoveryConfig: {
        maxRetries: 5,
        heartbeatIntervalMs: 15000,
        connectionTimeoutMs: 45000,
      },
    };

    // Cleanup existing client to prevent resource leaks
    this.client?.cleanup();
    this.client = new OpenAIClient(config);
    this.client.setConnectionStatusCallback(this.handleRecoveryStateChange);

    // Test connection with health check
    try {
      const healthy = await this.client.health();
      if (!healthy) {
        this.updateState('failed', 'Server health check failed');
        return false;
      }

      // Save tunnel metadata for future reconnection
      this.metadata = {
        baseUrl,
        apiKey,
        lastConnectedAt: Date.now(),
        isCloudflareTunnel: baseUrl.includes('trycloudflare.com'),
      };
      await saveTunnelMetadata(this.metadata);

      this.retryCount = 0;
      this.updateState('connected');
      return true;
    } catch (error: any) {
      console.error('[TunnelConnectionManager] Connection failed:', error);
      this.updateState('failed', error.message || 'Connection failed');
      return false;
    }
  }

  private handleRecoveryStateChange = (state: RecoveryState): void => {
    // Map recovery state to tunnel connection state
    switch (state.status) {
      case 'connected':
        this.retryCount = 0;
        this.updateState('connected');
        break;
      case 'reconnecting':
        this.retryCount = state.retryCount;
        this.updateState('reconnecting');
        break;
      case 'disconnected':
        this.updateState('disconnected', state.lastError);
        break;
      case 'failed':
        this.updateState('failed', state.lastError);
        break;
    }
  };

  private updateState(state: TunnelConnectionState, error?: string): void {
    this.connectionState = state;
    // Clear error message for non-error states, set it for error states
    if (state === 'connected' || state === 'connecting' || state === 'reconnecting') {
      this.errorMessage = null;
    } else if (error !== undefined) {
      this.errorMessage = error;
    }
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.getConnectionInfo());
    }
  }

  /**
   * Get current connection information for UI display.
   */
  getConnectionInfo(): TunnelConnectionInfo {
    return {
      state: this.connectionState,
      deviceId: this.deviceId,
      baseUrl: this.metadata?.baseUrl ?? null,
      lastConnectedAt: this.metadata?.lastConnectedAt ?? null,
      retryCount: this.retryCount,
      errorMessage: this.errorMessage,
    };
  }

  /**
   * Set callback for connection state changes.
   */
  setOnStateChange(callback: OnTunnelStateChange | null): void {
    this.onStateChange = callback;
  }

  /**
   * Get the underlying OpenAI client for making requests.
   */
  getClient(): OpenAIClient | null {
    return this.client;
  }

  /**
   * Check connection health and reconnect if needed.
   */
  async checkAndReconnect(): Promise<void> {
    if (!this.client || !this.metadata) {
      return;
    }

    try {
      const healthy = await this.client.health();
      if (healthy) {
        // Update last connected timestamp
        await updateTunnelMetadata({ lastConnectedAt: Date.now() });
        this.updateState('connected');
      } else {
        await this.attemptReconnect();
      }
    } catch (error) {
      console.log('[TunnelConnectionManager] Health check failed, attempting reconnect');
      await this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect using stored metadata.
   */
  private async attemptReconnect(): Promise<void> {
    if (!this.metadata) {
      console.log('[TunnelConnectionManager] No metadata for reconnection');
      return;
    }

    this.updateState('reconnecting');
    this.retryCount++;

    // Exponential backoff with jitter
    const baseDelay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30000);
    const jitter = Math.random() * 1000;
    const delay = baseDelay + jitter;

    console.log(`[TunnelConnectionManager] Reconnecting in ${Math.round(delay)}ms (attempt ${this.retryCount})`);

    // Clear any existing timeout
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
    }

    this.reconnectTimeoutId = setTimeout(async () => {
      const success = await this.connect(this.metadata!.baseUrl, this.metadata!.apiKey);
      if (!success && this.retryCount < 5) {
        // Continue retrying
        await this.attemptReconnect();
      } else if (!success) {
        this.updateState('failed', 'Max reconnection attempts reached');
      }
    }, delay);
  }

  /**
   * Disconnect and clear stored metadata.
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    this.client?.cleanup();
    this.client = null;
    await clearTunnelMetadata();
    this.metadata = null;
    this.retryCount = 0;
    this.updateState('disconnected');
  }

  /**
   * Cleanup resources.
   */
  cleanup(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.client?.cleanup();
    this.client = null;
    this.onStateChange = null;
  }
}

