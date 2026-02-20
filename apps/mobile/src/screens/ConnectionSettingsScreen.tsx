import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppConfig, saveConfig, useConfigContext } from '../store/config';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius } from '../ui/theme';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { checkServerConnection } from '../lib/connectionRecovery';
import { useTunnelConnection } from '../store/tunnelConnection';

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

export default function ConnectionSettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { config, setConfig, ready } = useConfigContext();
  const [draft, setDraft] = useState<AppConfig>(config);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const { connect: tunnelConnect, disconnect: tunnelDisconnect } = useTunnelConnection();

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
      apiKey: draft.apiKey?.trim?.() ?? '',
    };

    // Clear any previous error
    setConnectionError(null);

    // Default to OpenAI URL if baseUrl is empty
    if (!normalizedDraft.baseUrl) {
      normalizedDraft.baseUrl = 'https://api.openai.com/v1';
    }

    const hasCustomUrl = normalizedDraft.baseUrl && normalizedDraft.baseUrl !== 'https://api.openai.com/v1';
    const hasApiKey = normalizedDraft.apiKey && normalizedDraft.apiKey.length > 0;

    // Require API key when using a custom server URL
    if (hasCustomUrl && !hasApiKey) {
      setConnectionError('API Key is required when using a custom server URL');
      return;
    }

    // Validate: if API key is set, base URL must also be set
    if (hasApiKey && !normalizedDraft.baseUrl) {
      setConnectionError('Base URL is required when an API key is provided');
      return;
    }

    // Only check connection if we have both a custom URL and API key
    if (hasApiKey && normalizedDraft.baseUrl) {
      setIsCheckingConnection(true);

      try {
        const result = await checkServerConnection(
          normalizedDraft.baseUrl,
          normalizedDraft.apiKey,
          10000
        );

        if (!result.success) {
          setConnectionError(result.error || 'Connection failed');
          setIsCheckingConnection(false);
          return;
        }

        if (result.normalizedUrl) {
          normalizedDraft = {
            ...normalizedDraft,
            baseUrl: result.normalizedUrl,
          };
        }

        console.log('[ConnectionSettings] Connection check successful:', result);
      } catch (error: any) {
        console.error('[ConnectionSettings] Connection check error:', error);
        setConnectionError(error.message || 'Connection check failed');
        setIsCheckingConnection(false);
        return;
      }

      setIsCheckingConnection(false);
    }

    // Connection successful, proceed
    setConfig(normalizedDraft);
    await saveConfig(normalizedDraft);

    // Connect tunnel for persistence
    if (normalizedDraft.baseUrl && normalizedDraft.apiKey) {
      tunnelConnect(normalizedDraft.baseUrl, normalizedDraft.apiKey).catch((error) => {
        console.warn('[ConnectionSettings] Tunnel connect failed (non-blocking):', error);
      });
    } else {
      tunnelDisconnect().catch((error) => {
        console.warn('[ConnectionSettings] Tunnel disconnect failed (non-blocking):', error);
      });
    }

    navigation.goBack();
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

  const resetBaseUrl = () => {
    setDraft(prev => ({ ...prev, baseUrl: 'https://api.openai.com/v1' }));
  };

  // Connection status indicator
  const isConnected = config.baseUrl && config.apiKey;
  const connectionStatusText = isConnected
    ? `Connected to ${config.baseUrl}`
    : 'Not connected';

  if (!ready) return null;

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + spacing.md }]}
      >
        {/* Connection Status */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, isConnected ? styles.statusConnected : styles.statusDisconnected]} />
            <Text style={styles.statusText}>
              {isConnected ? 'Connected' : 'Not connected'}
            </Text>
          </View>
          {isConnected && (
            <Text style={styles.statusUrl} numberOfLines={1}>
              {config.baseUrl}
            </Text>
          )}
        </View>

        {connectionError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>⚠️ {connectionError}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.scanButton} onPress={handleScanQR} accessibilityRole="button" accessibilityLabel="Scan QR Code">
          <Text style={styles.scanButtonText}>📷 Scan QR Code</Text>
        </TouchableOpacity>
        <Text style={styles.helperText}>
          Scan the QR code from your SpeakMCP desktop app to connect
        </Text>

        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={styles.input}
          value={draft.apiKey}
          onChangeText={(t) => setDraft({ ...draft, apiKey: t })}
          placeholder="sk-..."
          placeholderTextColor={theme.colors.mutedForeground}
          autoCapitalize='none'
          secureTextEntry={false}
        />

        <View style={styles.labelRow}>
          <Text style={styles.label}>Base URL</Text>
          <TouchableOpacity onPress={resetBaseUrl}>
            <Text style={styles.resetText}>Reset to default</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={draft.baseUrl}
          onChangeText={(t) => setDraft({ ...draft, baseUrl: t })}
          placeholder='https://api.openai.com/v1'
          placeholderTextColor={theme.colors.mutedForeground}
          autoCapitalize='none'
        />

        <TouchableOpacity
          style={[styles.primaryButton, isCheckingConnection && styles.primaryButtonDisabled]}
          onPress={onSave}
          disabled={isCheckingConnection}
          accessibilityRole="button"
          accessibilityLabel={isCheckingConnection ? 'Testing connection' : 'Test & Save'}
        >
          {isCheckingConnection ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={theme.colors.primaryForeground} size="small" />
              <Text style={styles.primaryButtonText}>  Testing connection...</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>Test & Save</Text>
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
    statusCard: {
      backgroundColor: theme.colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    statusConnected: {
      backgroundColor: '#22c55e',
    },
    statusDisconnected: {
      backgroundColor: '#ef4444',
    },
    statusText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.foreground,
    },
    statusUrl: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      marginTop: spacing.xs,
    },
    label: {
      ...theme.typography.label,
      marginTop: spacing.sm,
    },
    labelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    resetText: {
      fontSize: 12,
      color: theme.colors.primary,
    },
    helperText: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      marginTop: -spacing.xs,
    },
    input: {
      ...theme.input,
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

