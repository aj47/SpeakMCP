import AsyncStorage from '@react-native-async-storage/async-storage';

const TUNNEL_METADATA_KEY = 'speakmcp_tunnel_metadata_v1';

/**
 * Tunnel metadata for connection persistence.
 * Stores information needed to resume or reconnect to a tunnel.
 */
export interface TunnelMetadata {
  /** The base URL of the tunnel endpoint */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Timestamp of last successful connection */
  lastConnectedAt: number;
  /** Optional session ID for resumption */
  sessionId?: string;
  /** Optional resume token from server */
  resumeToken?: string;
  /** Whether this was a Cloudflare tunnel (vs local network) */
  isCloudflareTunnel?: boolean;
}

/**
 * Save tunnel metadata for later reconnection.
 *
 * TODO: Security enhancement - Consider storing the apiKey in secure storage
 * (expo-secure-store for iOS Keychain/Android Keystore) instead of AsyncStorage
 * for production deployments where the API key grants sensitive access.
 */
export async function saveTunnelMetadata(metadata: TunnelMetadata): Promise<void> {
  try {
    await AsyncStorage.setItem(TUNNEL_METADATA_KEY, JSON.stringify(metadata));
    console.log('[TunnelPersistence] Saved tunnel metadata:', {
      baseUrl: metadata.baseUrl,
      hasApiKey: !!metadata.apiKey,
      hasSessionId: !!metadata.sessionId,
      hasResumeToken: !!metadata.resumeToken,
    });
  } catch (error) {
    console.error('[TunnelPersistence] Failed to save tunnel metadata:', error);
  }
}

/**
 * Load previously saved tunnel metadata.
 * Returns null if no metadata exists or if it's invalid.
 */
export async function loadTunnelMetadata(): Promise<TunnelMetadata | null> {
  try {
    const stored = await AsyncStorage.getItem(TUNNEL_METADATA_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    if (!parsed.baseUrl || !parsed.apiKey) {
      console.warn('[TunnelPersistence] Invalid stored metadata, missing required fields');
      return null;
    }

    return parsed as TunnelMetadata;
  } catch (error) {
    console.error('[TunnelPersistence] Failed to load tunnel metadata:', error);
    return null;
  }
}

/**
 * Update specific fields in the tunnel metadata.
 * Preserves existing fields that are not specified.
 */
export async function updateTunnelMetadata(
  updates: Partial<TunnelMetadata>
): Promise<TunnelMetadata | null> {
  const existing = await loadTunnelMetadata();
  if (!existing) {
    console.warn('[TunnelPersistence] Cannot update: no existing metadata');
    return null;
  }

  const updated: TunnelMetadata = {
    ...existing,
    ...updates,
    lastConnectedAt: updates.lastConnectedAt ?? Date.now(),
  };

  await saveTunnelMetadata(updated);
  return updated;
}

/**
 * Clear tunnel metadata (for logout or reset scenarios).
 */
export async function clearTunnelMetadata(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TUNNEL_METADATA_KEY);
    console.log('[TunnelPersistence] Cleared tunnel metadata');
  } catch (error) {
    console.error('[TunnelPersistence] Failed to clear tunnel metadata:', error);
  }
}

/**
 * Check if we have valid tunnel metadata for reconnection.
 */
export async function hasTunnelMetadata(): Promise<boolean> {
  const metadata = await loadTunnelMetadata();
  return metadata !== null;
}

/**
 * Check if the stored tunnel metadata is recent enough to attempt reconnection.
 * @param maxAgeMs Maximum age in milliseconds (default: 24 hours)
 */
export async function isTunnelMetadataFresh(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<boolean> {
  const metadata = await loadTunnelMetadata();
  if (!metadata) {
    return false;
  }

  const age = Date.now() - metadata.lastConnectedAt;
  return age < maxAgeMs;
}

