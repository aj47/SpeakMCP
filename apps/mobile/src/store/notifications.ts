/**
 * React context and hooks for push notification management.
 * 
 * Provides:
 * - Notification settings state
 * - Permission status tracking
 * - Badge count management
 * - Notification response handling for deep linking
 * 
 * Implements issue #936: Add Push Notifications to Mobile App
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import {
  NotificationSettings,
  PushTokenInfo,
  loadNotificationSettings,
  saveNotificationSettings,
  requestNotificationPermissions,
  getNotificationPermissionStatus,
  getPushToken,
  loadStoredPushToken,
  setBadgeCount,
  getBadgeCount,
  clearAllNotifications,
  addNotificationReceivedListener,
  addNotificationResponseListener,
  getLastNotificationResponse,
  parseNotificationData,
  NotificationData,
  isPushNotificationsSupported,
} from '../lib/notifications';

export interface NotificationContextValue {
  /** Current notification settings */
  settings: NotificationSettings;
  /** Whether settings have been loaded */
  isReady: boolean;
  /** Current permission status */
  permissionStatus: Notifications.PermissionStatus | null;
  /** Push token info */
  pushToken: PushTokenInfo | null;
  /** Current badge count */
  badgeCount: number;
  /** Whether push notifications are supported (physical device) */
  isSupported: boolean;
  /** Update notification settings */
  updateSettings: (updates: Partial<NotificationSettings>) => Promise<void>;
  /** Request notification permissions */
  requestPermissions: () => Promise<boolean>;
  /** Register for push notifications and get token */
  registerForPushNotifications: () => Promise<PushTokenInfo | null>;
  /** Update badge count */
  updateBadgeCount: (count: number) => Promise<void>;
  /** Increment badge count */
  incrementBadgeCount: () => Promise<void>;
  /** Clear all notifications and badge */
  clearNotifications: () => Promise<void>;
  /** Callback for when notification is tapped (for navigation) */
  onNotificationTap: ((data: NotificationData) => void) | null;
  /** Set the notification tap handler */
  setOnNotificationTap: (handler: ((data: NotificationData) => void) | null) => void;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  showPreviews: true,
};

export const NotificationContext = createContext<NotificationContextValue | null>(null);

/**
 * Hook to access the notification context
 */
export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return ctx;
}

/**
 * Hook to create and manage notification state.
 * Should be used at the app root level.
 */
export function useNotificationProvider(): NotificationContextValue {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [isReady, setIsReady] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<Notifications.PermissionStatus | null>(null);
  const [pushToken, setPushToken] = useState<PushTokenInfo | null>(null);
  const [badgeCount, setBadgeCountState] = useState(0);
  const [pendingNotificationData, setPendingNotificationData] = useState<NotificationData | null>(null);
  const onNotificationTapRef = useRef<((data: NotificationData) => void) | null>(null);

  const isSupported = isPushNotificationsSupported();

  // Initialize on mount
  useEffect(() => {
    async function initialize() {
      // Load settings
      const loadedSettings = await loadNotificationSettings();
      setSettings(loadedSettings);

      // Check permission status
      const status = await getNotificationPermissionStatus();
      setPermissionStatus(status);

      // Load stored token
      const storedToken = await loadStoredPushToken();
      if (storedToken) {
        setPushToken(storedToken);
      }

      // Get current badge count
      const currentBadge = await getBadgeCount();
      setBadgeCountState(currentBadge);

      setIsReady(true);

      // Check for initial notification response (app launched via notification tap)
      const lastResponse = await getLastNotificationResponse();
      if (lastResponse) {
        const data = parseNotificationData(lastResponse.notification);
        if (data) {
          // Store as pending - will be handled when tap handler is set
          setPendingNotificationData(data);
        }
      }
    }

    initialize();
  }, []);

  // Process pending notification when tap handler is registered
  useEffect(() => {
    if (pendingNotificationData && onNotificationTapRef.current) {
      // Delay to ensure navigation is ready
      setTimeout(() => {
        onNotificationTapRef.current?.(pendingNotificationData);
        setPendingNotificationData(null);
      }, 500);
    }
  }, [pendingNotificationData]);

  // Set up notification listeners
  useEffect(() => {
    // Listen for notification received while app is in foreground
    const receivedSubscription = addNotificationReceivedListener((notification) => {
      console.log('[Notifications] Received in foreground:', notification.request.content.title);
    });

    // Listen for notification taps
    const responseSubscription = addNotificationResponseListener((response) => {
      const data = parseNotificationData(response.notification);
      console.log('[Notifications] User tapped notification:', data);
      if (data && onNotificationTapRef.current) {
        onNotificationTapRef.current(data);
      }
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  const updateSettings = useCallback(async (updates: Partial<NotificationSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await saveNotificationSettings(newSettings);
  }, [settings]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const granted = await requestNotificationPermissions();
    const status = await getNotificationPermissionStatus();
    setPermissionStatus(status);
    return granted;
  }, []);

  const registerForPushNotifications = useCallback(async (): Promise<PushTokenInfo | null> => {
    if (!isSupported) {
      console.warn('[Notifications] Push notifications not supported on this device');
      return null;
    }

    // Request permissions first
    const granted = await requestPermissions();
    if (!granted) {
      return null;
    }

    // Get push token
    const token = await getPushToken();
    if (token) {
      setPushToken(token);
    }
    return token;
  }, [isSupported, requestPermissions]);

  const updateBadgeCount = useCallback(async (count: number) => {
    setBadgeCountState(count);
    await setBadgeCount(count);
  }, []);

  const incrementBadgeCount = useCallback(async () => {
    const newCount = badgeCount + 1;
    setBadgeCountState(newCount);
    await setBadgeCount(newCount);
  }, [badgeCount]);

  const clearNotifications = useCallback(async () => {
    setBadgeCountState(0);
    await clearAllNotifications();
  }, []);

  const setOnNotificationTap = useCallback((handler: ((data: NotificationData) => void) | null) => {
    onNotificationTapRef.current = handler;
  }, []);

  return {
    settings,
    isReady,
    permissionStatus,
    pushToken,
    badgeCount,
    isSupported,
    updateSettings,
    requestPermissions,
    registerForPushNotifications,
    updateBadgeCount,
    incrementBadgeCount,
    clearNotifications,
    onNotificationTap: onNotificationTapRef.current,
    setOnNotificationTap,
  };
}

/**
 * Hook to check if notifications are enabled
 */
export function useNotificationsEnabled(): boolean {
  const { settings, permissionStatus } = useNotifications();
  return settings.enabled && permissionStatus === 'granted';
}

// Re-export types from notifications lib for convenience
export type { NotificationData } from '../lib/notifications';
