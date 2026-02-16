import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './src/screens/SettingsScreen';
import ChatScreen from './src/screens/ChatScreen';
import SessionListScreen from './src/screens/SessionListScreen';
import { ConfigContext, useConfig, saveConfig } from './src/store/config';
import { SessionContext, useSessions } from './src/store/sessions';
import { MessageQueueContext, useMessageQueue } from './src/store/message-queue';
import { ConnectionManagerContext, useConnectionManagerProvider } from './src/store/connectionManager';
import { TunnelConnectionContext, useTunnelConnectionProvider } from './src/store/tunnelConnection';
import { ProfileContext, useProfileProvider } from './src/store/profile';
import { usePushNotifications, NotificationData, clearNotifications, clearServerBadge } from './src/lib/pushNotifications';
import { SettingsApiClient } from './src/lib/settingsApi';
import { View, Image, Text, StyleSheet, AppState, AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/ui/ThemeProvider';
import { ConnectionStatusIndicator } from './src/ui/ConnectionStatusIndicator';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useCallback, useRef } from 'react';


const speakMCPIcon = require('./assets/speakmcp-icon.png');
const darkSpinner = require('./assets/loading-spinner.gif');
const lightSpinner = require('./assets/light-spinner.gif');

const Stack = createNativeStackNavigator();

type DeepLinkConfig = {
  type: 'config';
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

type DeepLinkAssistant = {
  type: 'assistant';
  query: string;
};

type DeepLinkChat = {
  type: 'chat';
};

type DeepLinkVoice = {
  type: 'voice';
};

type DeepLinkFeature = {
  type: 'feature';
  feature: string;
};

type DeepLinkResult = DeepLinkConfig | DeepLinkAssistant | DeepLinkChat | DeepLinkVoice | DeepLinkFeature;

function parseDeepLink(url: string | null): DeepLinkResult | null {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const path = parsed.path || parsed.hostname || '';
    const params = parsed.queryParams || {};

    // Handle speakmcp://config?baseUrl=...&apiKey=...&model=...
    if (path === 'config') {
      const { baseUrl, apiKey, model } = params;
      if (baseUrl || apiKey || model) {
        return {
          type: 'config',
          baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined,
          apiKey: typeof apiKey === 'string' ? apiKey : undefined,
          model: typeof model === 'string' ? model : undefined,
        };
      }
    }

    // Handle speakmcp://assistant?query=... (Google Assistant App Actions)
    if (path === 'assistant') {
      const query = typeof params.query === 'string' ? params.query : '';
      if (query) {
        return { type: 'assistant', query };
      }
      // No query provided, fall through to open chat
      return { type: 'chat' };
    }

    // Handle speakmcp://chat (open chat screen)
    if (path === 'chat') {
      return { type: 'chat' };
    }

    // Handle speakmcp://voice (open chat in voice mode)
    if (path === 'voice') {
      return { type: 'voice' };
    }

    // Handle speakmcp://feature/{name} (Google Assistant OPEN_APP_FEATURE)
    if (path.startsWith('feature/') || path === 'feature') {
      const feature = path.replace('feature/', '').replace('feature', '') ||
        (typeof params.feature === 'string' ? params.feature : '');
      if (feature) {
        return { type: 'feature', feature };
      }
      return { type: 'chat' };
    }
  } catch (e) {
    console.warn('Failed to parse deep link:', e);
  }
  return null;
}

function Navigation() {
  const { theme, isDark } = useTheme();
  const cfg = useConfig();
  const sessionStore = useSessions();
  const messageQueueStore = useMessageQueue();
  const navigationRef = useNavigationContainerRef();
  const isNavigationReady = useRef(false);

  // Initialize tunnel connection manager for persistence and auto-reconnection
  const tunnelConnection = useTunnelConnectionProvider();

  // Initialize push notifications
  const pushNotifications = usePushNotifications();

  // Create connection manager config from app config
  const clientConfig = useMemo(() => ({
    baseUrl: cfg.config.baseUrl,
    apiKey: cfg.config.apiKey,
    model: cfg.config.model,
    recoveryConfig: {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      heartbeatIntervalMs: 30000,
    },
  }), [cfg.config.baseUrl, cfg.config.apiKey, cfg.config.model]);

  // Initialize connection manager with client config
  const connectionManager = useConnectionManagerProvider(clientConfig);

  // Initialize profile provider to track current profile from server
  const profileProvider = useProfileProvider(cfg.config.baseUrl, cfg.config.apiKey);

  // Create navigation theme that matches our theme
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.colors.background,
      card: theme.colors.card,
      text: theme.colors.foreground,
      border: theme.colors.border,
      primary: theme.colors.primary,
    },
  };

  // Handle deep links (including Google Assistant App Actions)
  useEffect(() => {
    if (!cfg.ready) return;

    const handleUrl = async (url: string | null) => {
      const result = parseDeepLink(url);
      if (!result) return;

      switch (result.type) {
        case 'config': {
          const newConfig = {
            ...cfg.config,
            ...(result.baseUrl && { baseUrl: result.baseUrl }),
            ...(result.apiKey && { apiKey: result.apiKey }),
            ...(result.model && { model: result.model }),
          };
          cfg.setConfig(newConfig);
          await saveConfig(newConfig);
          break;
        }
        case 'assistant': {
          // Google Assistant sent a query - navigate to chat and auto-send
          console.log('[App] Google Assistant query:', result.query);
          if (isNavigationReady.current) {
            // Create a new session for the assistant query
            const session = sessionStore.createNewSession();
            sessionStore.setCurrentSession(session.id);
            navigationRef.navigate('Chat' as never, { initialMessage: result.query } as never);
          }
          break;
        }
        case 'chat': {
          // Open the chat screen
          if (isNavigationReady.current) {
            navigationRef.navigate('Chat' as never);
          }
          break;
        }
        case 'voice': {
          // Open chat in voice/listening mode
          console.log('[App] Opening voice mode via deep link');
          if (isNavigationReady.current) {
            const session = sessionStore.createNewSession();
            sessionStore.setCurrentSession(session.id);
            navigationRef.navigate('Chat' as never, { autoVoice: true } as never);
          }
          break;
        }
        case 'feature': {
          // Google Assistant OPEN_APP_FEATURE - route to the named feature
          const featureLower = result.feature.toLowerCase();
          if (isNavigationReady.current) {
            if (featureLower.includes('chat') || featureLower.includes('message') || featureLower.includes('talk')) {
              navigationRef.navigate('Chat' as never);
            } else if (featureLower.includes('session') || featureLower.includes('history')) {
              navigationRef.navigate('Sessions' as never);
            } else if (featureLower.includes('setting') || featureLower.includes('config')) {
              navigationRef.navigate('Settings' as never);
            } else if (featureLower.includes('voice') || featureLower.includes('speak') || featureLower.includes('listen')) {
              const session = sessionStore.createNewSession();
              sessionStore.setCurrentSession(session.id);
              navigationRef.navigate('Chat' as never, { autoVoice: true } as never);
            } else {
              // Default: open chat
              navigationRef.navigate('Chat' as never);
            }
          }
          break;
        }
      }
    };

    // Handle initial URL (app opened via deep link)
    Linking.getInitialURL().then(handleUrl);

    // Handle URL when app is already open
    const subscription = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    return () => subscription.remove();
  }, [cfg.ready]);

  // Handle notification taps for deep linking to conversations
  const handleNotificationTap = useCallback((data: NotificationData) => {
    console.log('[App] Notification tapped:', data);
    if (!isNavigationReady.current) {
      console.log('[App] Navigation not ready, skipping notification navigation');
      return;
    }

    if (data.type === 'message' && (data.sessionId || data.conversationId)) {
      // Navigate to the specific chat session
      // Try to find session by local sessionId first, then by server conversationId
      let targetSessionId: string | null = null;

      if (data.sessionId) {
        // sessionId from notification is already a local session ID
        targetSessionId = data.sessionId;
      } else if (data.conversationId) {
        // conversationId is a server-side ID - need to find the matching local session
        const session = sessionStore.findSessionByServerConversationId(data.conversationId);
        if (session) {
          targetSessionId = session.id;
          console.log('[App] Found session by serverConversationId:', session.id);
        } else {
          console.log('[App] No session found for conversationId:', data.conversationId);
        }
      }

      if (targetSessionId) {
        sessionStore.setCurrentSession(targetSessionId);
        navigationRef.navigate('Chat' as never);
      } else {
        // No matching session found - navigate to sessions list
        navigationRef.navigate('Sessions' as never);
      }
    } else if (data.type === 'message') {
      // Navigate to sessions list if no specific session
      navigationRef.navigate('Sessions' as never);
    }
  }, [sessionStore, navigationRef]);

  // Set up notification tap handler
  useEffect(() => {
    pushNotifications.setOnNotificationTap(handleNotificationTap);
    return () => pushNotifications.setOnNotificationTap(null);
  }, [handleNotificationTap, pushNotifications]);

  // Clear notifications when app becomes active (including from background)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && cfg.ready) {
        // Clear badge when user opens the app or brings it to foreground
        clearNotifications();
        // Also clear badge count on server if connected
        if (cfg.config.baseUrl && cfg.config.apiKey) {
          clearServerBadge(cfg.config.baseUrl, cfg.config.apiKey).catch((err) => {
            console.warn('[App] Failed to clear server badge count:', err);
          });
        }
      }
    };

    // Also clear immediately if app is already active and config is ready
    if (cfg.ready) {
      clearNotifications();
      if (cfg.config.baseUrl && cfg.config.apiKey) {
        clearServerBadge(cfg.config.baseUrl, cfg.config.apiKey).catch((err) => {
          console.warn('[App] Failed to clear server badge count:', err);
        });
      }
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [cfg.ready, cfg.config.baseUrl, cfg.config.apiKey]);

  // Auto-sync sessions with desktop server
  useEffect(() => {
    if (!cfg.ready || !sessionStore.ready) return;
    if (!cfg.config.baseUrl || !cfg.config.apiKey) return;

    const client = new SettingsApiClient(cfg.config.baseUrl, cfg.config.apiKey);

    // Sync on initial load
    sessionStore.syncWithServer(client).catch((err) => {
      console.warn('[App] Initial session sync failed:', err);
    });

    // Sync when app returns to foreground
    const handleAppStateForSync = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        sessionStore.syncWithServer(client).catch((err) => {
          console.warn('[App] Foreground session sync failed:', err);
        });
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateForSync);
    return () => subscription.remove();
  }, [cfg.ready, cfg.config.baseUrl, cfg.config.apiKey, sessionStore.ready]);

  if (!cfg.ready || !sessionStore.ready) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
        <Image
          source={isDark ? darkSpinner : lightSpinner}
          style={styles.spinner}
          resizeMode="contain"
        />
        <Text style={[styles.loadingText, { color: theme.colors.mutedForeground }]}>
          Loading...
        </Text>
      </View>
    );
  }

  return (
    <ConfigContext.Provider value={cfg}>
      <ProfileContext.Provider value={profileProvider}>
        <SessionContext.Provider value={sessionStore}>
          <MessageQueueContext.Provider value={messageQueueStore}>
            <ConnectionManagerContext.Provider value={connectionManager}>
              <TunnelConnectionContext.Provider value={tunnelConnection}>
                <NavigationContainer
                  ref={navigationRef}
                  theme={navTheme}
                  onReady={() => { isNavigationReady.current = true; }}
                >
                  <Stack.Navigator
                    initialRouteName="Settings"
                    screenOptions={{
                      headerTitleStyle: { ...theme.typography.h2 },
                      headerStyle: { backgroundColor: theme.colors.card },
                      headerTintColor: theme.colors.foreground,
                      contentStyle: { backgroundColor: theme.colors.background },
                      headerLeft: () => (
                        <Image
                          source={speakMCPIcon}
                          style={{ width: 28, height: 28, marginLeft: 12, marginRight: 8 }}
                          resizeMode="contain"
                        />
                      ),
                      headerRight: () => (
                        <ConnectionStatusIndicator
                          state={tunnelConnection.connectionInfo.state}
                          retryCount={tunnelConnection.connectionInfo.retryCount}
                          compact
                          />
                      ),
                    }}
                  >
                    <Stack.Screen
                      name="Settings"
                      component={SettingsScreen}
                      options={{ title: 'SpeakMCP' }}
                    />
                    <Stack.Screen
                      name="Sessions"
                      component={SessionListScreen}
                      options={{ title: 'Chats' }}
                    />
                    <Stack.Screen name="Chat" component={ChatScreen} />
                  </Stack.Navigator>
                </NavigationContainer>
              </TunnelConnectionContext.Provider>
            </ConnectionManagerContext.Provider>
          </MessageQueueContext.Provider>
        </SessionContext.Provider>
      </ProfileContext.Provider>
    </ConfigContext.Provider>
  );
}

function Root() {
  return <Navigation />;
}

function StatusBarWrapper() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 48,
    height: 48,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBarWrapper />
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
