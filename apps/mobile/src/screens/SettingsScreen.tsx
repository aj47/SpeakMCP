import { useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, Switch, StyleSheet, ScrollView, Modal, TouchableOpacity, Platform, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppConfig, saveConfig, useConfigContext } from '../store/config';
import { useTheme, ThemeMode } from '../ui/ThemeProvider';
import { spacing, radius } from '../ui/theme';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { checkServerConnection, ConnectionCheckResult } from '../lib/connectionRecovery';

function parseQRCode(data: string): { baseUrl?: string; apiKey?: string; model?: string } | null {
  try {
    const parsed = Linking.parse(data);
    // Handle speakmcp://config?baseUrl=...&apiKey=...&model=...
    if (parsed.scheme === 'speakmcp' && (parsed.path === 'config' || parsed.hostname === 'config')) {
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
    console.warn('Failed to parse QR code:', e);
  }
  return null;
}

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: '☀️ Light', value: 'light' },
  { label: '🌙 Dark', value: 'dark' },
  { label: '⚙️ System', value: 'system' },
];

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { theme, themeMode, setThemeMode, isDark } = useTheme();
  const { config, setConfig, ready } = useConfigContext();
  const [draft, setDraft] = useState<AppConfig>(config);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    setDraft(config);
  }, [ready]);

  // Clear connection error when draft changes
  useEffect(() => {
    if (connectionError) {
      setConnectionError(null);
    }
  }, [draft.baseUrl, draft.apiKey]);

  const onSave = async () => {
    let normalizedDraft = {
      ...draft,
      baseUrl: draft.baseUrl?.trim?.() ?? '',
    };

    // Clear any previous error
    setConnectionError(null);

    // Check if we have a base URL to validate
    // If using default OpenAI URL with no API key, allow pass-through (might be using built-in key)
    const hasCustomUrl = normalizedDraft.baseUrl && normalizedDraft.baseUrl !== 'https://api.openai.com/v1';
    const hasApiKey = normalizedDraft.apiKey && normalizedDraft.apiKey.trim().length > 0;

    // Require API key when using a custom server URL
    if (hasCustomUrl && !hasApiKey) {
      setConnectionError('API Key is required when using a custom server URL');
      return;
    }

    // Only check connection if we have both a custom URL and API key
    // Or if we have an API key with the default URL
    if (hasApiKey && normalizedDraft.baseUrl) {
      setIsCheckingConnection(true);

      try {
        const result = await checkServerConnection(
          normalizedDraft.baseUrl,
          normalizedDraft.apiKey,
          10000 // 10 second timeout
        );

        if (!result.success) {
          setConnectionError(result.error || 'Connection failed');
          setIsCheckingConnection(false);
          return; // Don't proceed if connection fails
        }

        // Use the normalized URL from the connection check so the saved config
        // matches what was actually verified (includes scheme, no trailing slashes)
        if (result.normalizedUrl) {
          normalizedDraft = {
            ...normalizedDraft,
            baseUrl: result.normalizedUrl,
          };
        }

        console.log('[Settings] Connection check successful:', result);
      } catch (error: any) {
        console.error('[Settings] Connection check error:', error);
        setConnectionError(error.message || 'Connection check failed');
        setIsCheckingConnection(false);
        return;
      }

      setIsCheckingConnection(false);
    }

    // Connection successful or no validation needed, proceed
    setConfig(normalizedDraft);
    await saveConfig(normalizedDraft);
    navigation.navigate('Sessions');
  };

  const handleScanQR = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        return;
      }
    }
    setScanned(false);
    setShowScanner(true);
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    const params = parseQRCode(data);
    if (params) {
      setDraft(prev => ({
        ...prev,
        ...(params.baseUrl && { baseUrl: params.baseUrl }),
        ...(params.apiKey && { apiKey: params.apiKey }),
        ...(params.model && { model: params.model }),
      }));
      setShowScanner(false);
    } else {
      // Invalid QR code, allow scanning again
      setTimeout(() => setScanned(false), 2000);
    }
  };

  if (!ready) return null;

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + spacing.md }]}
      >
        <Text style={styles.h1}>Settings</Text>

        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.themeSelector}>
          {THEME_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[
                styles.themeOption,
                themeMode === option.value && styles.themeOptionActive,
              ]}
              onPress={() => setThemeMode(option.value)}
            >
              <Text style={[
                styles.themeOptionText,
                themeMode === option.value && styles.themeOptionTextActive,
              ]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>API Configuration</Text>

        <TouchableOpacity style={styles.scanButton} onPress={handleScanQR}>
          <Text style={styles.scanButtonText}>📷 Scan QR Code</Text>
        </TouchableOpacity>

        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={styles.input}
          value={draft.apiKey}
          onChangeText={(t) => setDraft({ ...draft, apiKey: t })}
          placeholder="sk-..."
          placeholderTextColor={theme.colors.mutedForeground}
          autoCapitalize='none'
        />

        <Text style={styles.label}>Base URL</Text>
        <TextInput
          style={styles.input}
          value={draft.baseUrl}
          onChangeText={(t) => setDraft({ ...draft, baseUrl: t })}
          placeholder='https://api.openai.com/v1'
          placeholderTextColor={theme.colors.mutedForeground}
          autoCapitalize='none'
        />

        <View style={styles.row}>
          <Text style={styles.label}>Hands-free Voice Mode</Text>
          <Switch
            value={!!draft.handsFree}
            onValueChange={(v) => setDraft({ ...draft, handsFree: v })}
            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
            thumbColor={draft.handsFree ? theme.colors.primaryForeground : theme.colors.background}
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Text-to-Speech</Text>
          <Switch
            value={draft.ttsEnabled !== false}
            onValueChange={(v) => setDraft({ ...draft, ttsEnabled: v })}
            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
            thumbColor={draft.ttsEnabled !== false ? theme.colors.primaryForeground : theme.colors.background}
          />
        </View>

        {connectionError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>⚠️ {connectionError}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, isCheckingConnection && styles.primaryButtonDisabled]}
          onPress={onSave}
          disabled={isCheckingConnection}
        >
          {isCheckingConnection ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={theme.colors.primaryForeground} size="small" />
              <Text style={styles.primaryButtonText}>  Checking connection...</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>Save & Start Chatting</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarCodeScanned}
          />
          <View style={styles.scannerOverlay}>
            <View style={styles.scannerFrame} />
            <Text style={styles.scannerText}>
              {scanned ? 'Invalid QR code format' : 'Scan a SpeakMCP QR code'}
            </Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={() => setShowScanner(false)}>
            <Text style={styles.closeButtonText}>✕ Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>['theme']) {
  return StyleSheet.create({
    container: {
      padding: spacing.lg,
      gap: spacing.md,
    },
    h1: {
      ...theme.typography.h1,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      ...theme.typography.label,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
      textTransform: 'uppercase',
      fontSize: 12,
      letterSpacing: 0.5,
      color: theme.colors.mutedForeground,
    },
    label: {
      ...theme.typography.label,
      marginTop: spacing.sm,
    },
    input: {
      ...theme.input,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
    },
    themeSelector: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    themeOption: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
    },
    themeOptionActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    themeOptionText: {
      fontSize: 14,
      color: theme.colors.foreground,
    },
    themeOptionTextActive: {
      color: theme.colors.primaryForeground,
      fontWeight: '600',
    },
    scanButton: {
      backgroundColor: theme.colors.secondary,
      padding: spacing.md,
      borderRadius: radius.lg,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    scanButtonText: {
      color: theme.colors.foreground,
      fontSize: 16,
      fontWeight: '500',
    },
    primaryButton: {
      backgroundColor: theme.colors.primary,
      padding: spacing.md,
      borderRadius: radius.lg,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    primaryButtonDisabled: {
      opacity: 0.7,
    },
    primaryButtonText: {
      color: theme.colors.primaryForeground,
      fontSize: 16,
      fontWeight: '600',
    },
    loadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorContainer: {
      backgroundColor: theme.colors.destructive + '20',
      borderWidth: 1,
      borderColor: theme.colors.destructive,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    errorText: {
      color: theme.colors.destructive,
      fontSize: 14,
      textAlign: 'center',
    },
    scannerContainer: {
      flex: 1,
      backgroundColor: '#000',
    },
    camera: {
      flex: 1,
    },
    scannerOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
    },
    scannerFrame: {
      width: 250,
      height: 250,
      borderWidth: 2,
      borderColor: '#fff',
      borderRadius: radius.xl,
      backgroundColor: 'transparent',
    },
    scannerText: {
      color: '#fff',
      fontSize: 16,
      marginTop: 20,
      textAlign: 'center',
    },
    closeButton: {
      position: 'absolute',
      top: 60,
      right: 20,
      backgroundColor: 'rgba(0,0,0,0.6)',
      padding: 12,
      borderRadius: radius.lg,
    },
    closeButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
