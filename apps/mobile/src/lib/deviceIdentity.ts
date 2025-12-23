import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const DEVICE_ID_KEY = 'speakmcp_device_id_v1';

/**
 * Device identity for stable tunnel identification.
 * This ID persists across app restarts (but not reinstalls, as AsyncStorage is cleared on uninstall).
 */
export interface DeviceIdentity {
  deviceId: string;
  createdAt: number;
}

/**
 * Generate a cryptographically random device ID.
 * Uses UUID v4 format for compatibility.
 */
async function generateDeviceId(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(16);
  const hex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  // Format as UUID v4
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(parseInt(hex.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Get or create a persistent device identity.
 * The device ID is generated once and stored in AsyncStorage.
 */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.deviceId && typeof parsed.deviceId === 'string') {
        return parsed as DeviceIdentity;
      }
    }
  } catch (error) {
    console.warn('[DeviceIdentity] Error reading stored identity:', error);
  }

  // Generate new device identity
  const identity: DeviceIdentity = {
    deviceId: await generateDeviceId(),
    createdAt: Date.now(),
  };

  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, JSON.stringify(identity));
    console.log('[DeviceIdentity] Created new device identity:', identity.deviceId);
  } catch (error) {
    console.error('[DeviceIdentity] Failed to persist device identity:', error);
  }

  return identity;
}

/**
 * Clear the device identity (for testing or reset scenarios).
 */
export async function clearDeviceIdentity(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEVICE_ID_KEY);
    console.log('[DeviceIdentity] Cleared device identity');
  } catch (error) {
    console.error('[DeviceIdentity] Failed to clear device identity:', error);
  }
}

