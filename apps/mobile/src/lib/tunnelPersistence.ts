import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const TUNNEL_METADATA_KEY = 'speakmcp_tunnel_metadata_v1';
const API_KEY_SECURE_KEY = 'speakmcp_api_key_secure';

/**
 * Tunnel metadata for connection persistence.
 * Stores information needed to resume or reconnect to a tunnel.
 * API key is stored securely using expo-secure-store (iOS Keychain/Android Keystore).
 */
export interface TunnelMetadata {
  /** The base URL of the tunnel endpoint */
  baseUrl: string;
  /** API key for authentication - stored in secure storage */
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
 * API key is stored securely using expo-secure-store.
 */
export async function saveTunnelMetadata(metadata: TunnelMetadata): Promise<void> {
  try {
    // Store apiKey securely using expo-secure-store (iOS Keychain/Android Keystore)
    if (metadata.apiKey) {
      await SecureStore.setItemAsync(API_KEY_SECURE_KEY, metadata.apiKey, {
        requireAuthentication: false,
      });
    }

    // Store non-sensitive metadata in AsyncStorage
    const { apiKey, ...safeMetadata } = metadata;
    await AsyncStorage.setItem(TUNNEL_METADATA_KEY, JSON.stringify(safeMetadata));

    console.log('[TunnelPersistence] Saved tunnel metadata:', {
      baseUrl: metadata.baseUrl,
      hasApiKey: !!metadata.apiKey,
      hasSessionId: !!metadata.sessionId,
      hasResumeToken: !!metadata.resumeToken,
      secureStorageUsed: true,
    });
  } catch (error) {
    console.error('[TunnelPersistence] Failed to save tunnel metadata:', error);
  }
}

/**
 * Load previously saved tunnel metadata.
 * Returns null if no metadata exists or if it's invalid.
 * API key is retrieved from secure storage.
 */
export async function loadTunnelMetadata(): Promise<TunnelMetadata | null> {
  try {
    // Load non-sensitive metadata from AsyncStorage
    const stored = await AsyncStorage.getItem(TUNNEL_METADATA_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);

    // Validate required fields exist and have correct types (except apiKey)
    if (
      typeof parsed.baseUrl !== 'string' ||
      typeof parsed.lastConnectedAt !== 'number'
    ) {
      console.warn('[TunnelPersistence] Invalid stored metadata: missing required fields or incorrect types');
      return null;
    }

    // Retrieve apiKey from secure storage
    const apiKey = await SecureStore.getItemAsync(API_KEY_SECURE_KEY);

    if (!apiKey) {
      console.warn('[TunnelPersistence] API key not found in secure storage');
      return null;
    }

    return {
      ...parsed,
      apiKey,
    } as TunnelMetadata;
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
  };

  await saveTunnelMetadata(updated);
  return updated;
}

/**
 * Clear tunnel metadata (for logout or reset scenarios).
 * Also clears the secure-stored API key.
 */
export async function clearTunnelMetadata(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TUNNEL_METADATA_KEY);
    await SecureStore.deleteItemAsync(API_KEY_SECURE_KEY);
    console.log('[TunnelPersistence] Cleared tunnel metadata and secure API key');
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
