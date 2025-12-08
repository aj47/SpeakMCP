import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './src/screens/SettingsScreen';
import ChatScreen from './src/screens/ChatScreen';
import SessionListScreen from './src/screens/SessionListScreen';
import { ConfigContext, useConfig, saveConfig } from './src/store/config';
import { SessionContext, useSessions } from './src/store/sessions';
import { View, Image, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/ui/ThemeProvider';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';

// SpeakMCP icon asset
const speakMCPIcon = require('./assets/speakmcp-icon.png');

// Animated spinner GIFs for loading state
const darkSpinner = require('./assets/loading-spinner.gif');
const lightSpinner = require('./assets/light-spinner.gif');

const Stack = createNativeStackNavigator();

function parseDeepLink(url: string | null) {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    // Handle speakmcp://config?baseUrl=...&apiKey=...&model=...
    if (parsed.path === 'config' || parsed.hostname === 'config') {
      const { baseUrl, apiKey, model } = parsed.queryParams || {};
      if (baseUrl || apiKey || model) {
        return {
          baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined,
          apiKey: typeof apiKey === 'string' ? apiKey : undefined,
          model: typeof model === 'string' ? model : undefined,
        };
      }
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

  // Handle deep links
  useEffect(() => {
    if (!cfg.ready) return;

    const handleUrl = async (url: string | null) => {
      const params = parseDeepLink(url);
      if (params) {
        const newConfig = {
          ...cfg.config,
          ...(params.baseUrl && { baseUrl: params.baseUrl }),
          ...(params.apiKey && { apiKey: params.apiKey }),
          ...(params.model && { model: params.model }),
        };
        cfg.setConfig(newConfig);
        await saveConfig(newConfig);
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
      <SessionContext.Provider value={sessionStore}>
        <NavigationContainer theme={navTheme}>
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
      </SessionContext.Provider>
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
