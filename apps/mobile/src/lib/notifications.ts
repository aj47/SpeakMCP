/**
 * Push notification service for SpeakMCP mobile app.
 * 
 * Handles:
 * - Permission requests
 * - Push token registration
 * - Local notification display
 * - Notification response handling
 * - Badge count management
 * 
 * Implements issue #936: Add Push Notifications to Mobile App
 */

import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIFICATION_SETTINGS_KEY = 'notification_settings_v1';
const PUSH_TOKEN_KEY = 'push_token_v1';

export interface NotificationSettings {
  enabled: boolean;
  showPreviews: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  showPreviews: true,
};

export interface PushTokenInfo {
  token: string;
  type: 'expo' | 'fcm' | 'apns';
  createdAt: number;
}

// Configure how notifications are handled when the app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Load notification settings from storage
 */
export async function loadNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save notification settings to storage
 */
export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Check if push notifications are supported on this device
 */
export function isPushNotificationsSupported(): boolean {
  return Device.isDevice;
}

/**
 * Get the current notification permission status
 */
export async function getNotificationPermissionStatus(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Request notification permissions from the user
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) {
    console.warn('[Notifications] Push notifications only work on physical devices');
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted');
    return false;
  }

  // Configure Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });

    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      description: 'Notifications for new messages from AI assistant',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  return true;
}

/**
 * Get push token for this device
 */
export async function getPushToken(): Promise<PushTokenInfo | null> {
  if (!Device.isDevice) {
    console.warn('[Notifications] Cannot get push token on simulator');
    return null;
  }

  try {
    // Get Expo push token (works for both iOS and Android)
    const projectId = Constants.expoConfig?.extra?.eas?.projectId
      ?? Constants.easConfig?.projectId;

    if (!projectId) {
      console.error('[Notifications] No EAS projectId configured. Push notifications require EAS project configuration.');
      console.error('[Notifications] Add projectId to app.json: extra.eas.projectId or configure via eas.json');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const tokenInfo: PushTokenInfo = {
      token: tokenData.data,
      type: 'expo',
      createdAt: Date.now(),
    };

    // Store token for later use
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, JSON.stringify(tokenInfo));
    console.log('[Notifications] Push token obtained:', tokenInfo.token.substring(0, 20) + '...');

    return tokenInfo;
  } catch (error) {
    console.error('[Notifications] Failed to get push token:', error);
    return null;
  }
}

/**
 * Load stored push token
 */
export async function loadStoredPushToken(): Promise<PushTokenInfo | null> {
  try {
    const raw = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Set the app badge count
 */
export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (error) {
    console.error('[Notifications] Failed to set badge count:', error);
  }
}

/**
 * Get the current badge count
 */
export async function getBadgeCount(): Promise<number> {
  try {
    return await Notifications.getBadgeCountAsync();
  } catch {
    return 0;
  }
}

/**
 * Clear all notifications and reset badge
 */
export async function clearAllNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
    await setBadgeCount(0);
  } catch (error) {
    console.error('[Notifications] Failed to clear notifications:', error);
  }
}

/**
 * Schedule a local notification (for testing or local alerts)
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  options?: {
    channelId?: string;
    delay?: number;
  }
): Promise<string> {
  const trigger: Notifications.NotificationTriggerInput = options?.delay
    ? { type: SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: options.delay, repeats: false }
    : null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data || {},
      sound: true,
      ...(Platform.OS === 'android' && {
        channelId: options?.channelId || 'messages',
      }),
    },
    trigger,
  });

  return id;
}

/**
 * Show an immediate notification for a new message
 */
export async function showMessageNotification(
  conversationId: string,
  messagePreview: string,
  senderName: string = 'AI Assistant'
): Promise<string> {
  return scheduleLocalNotification(
    senderName,
    messagePreview,
    {
      type: 'message',
      conversationId,
    },
    { channelId: 'messages' }
  );
}

/**
 * Parse notification data to extract conversation info for deep linking
 */
export interface NotificationData {
  type?: 'message' | 'system';
  conversationId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export function parseNotificationData(
  notification: Notifications.Notification | null
): NotificationData | null {
  if (!notification) return null;

  const data = notification.request.content.data;
  if (!data) return null;

  return {
    ...data,
    type: data.type as 'message' | 'system' | undefined,
    conversationId: data.conversationId as string | undefined,
    sessionId: data.sessionId as string | undefined,
  };
}

/**
 * Add listener for when a notification is received while app is foregrounded
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener(callback);
}

/**
 * Add listener for when user interacts with a notification
 */
export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

/**
 * Get the last notification response (for when app was launched via notification tap)
 */
export async function getLastNotificationResponse(): Promise<Notifications.NotificationResponse | null> {
  return Notifications.getLastNotificationResponseAsync();
}

// Server token registration keys
const SERVER_TOKEN_ENABLED_KEY = 'push_server_token_enabled_v1';

/**
 * Check if push notifications are registered with the server
 */
export async function isEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(SERVER_TOKEN_ENABLED_KEY);
    return value === 'true';
  } catch {
    return false;
  }
}

/**
 * Register push token with the desktop server
 */
export async function registerToken(baseUrl: string, apiKey: string): Promise<boolean> {
  const tokenInfo = await getPushToken();
  if (!tokenInfo) return false;

  try {
    const response = await fetch(`${baseUrl}/v1/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        token: tokenInfo.token,
        type: tokenInfo.type,
        platform: Platform.OS as 'ios' | 'android',
      }),
    });

    if (response.ok) {
      await AsyncStorage.setItem(SERVER_TOKEN_ENABLED_KEY, 'true');
      return true;
    }
    console.error('[Notifications] Server registration failed:', await response.text());
    return false;
  } catch (error) {
    console.error('[Notifications] Server registration error:', error);
    return false;
  }
}

/**
 * Unregister push token from the desktop server
 */
export async function unregisterToken(baseUrl: string, apiKey: string): Promise<boolean> {
  const tokenInfo = await loadStoredPushToken();
  if (!tokenInfo) {
    await AsyncStorage.setItem(SERVER_TOKEN_ENABLED_KEY, 'false');
    return true;
  }

  try {
    const response = await fetch(`${baseUrl}/v1/push/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ token: tokenInfo.token }),
    });

    if (response.ok) {
      await AsyncStorage.setItem(SERVER_TOKEN_ENABLED_KEY, 'false');
      return true;
    }
    console.error('[Notifications] Server unregistration failed:', await response.text());
    return false;
  } catch (error) {
    console.error('[Notifications] Server unregistration error:', error);
    return false;
  }
}
