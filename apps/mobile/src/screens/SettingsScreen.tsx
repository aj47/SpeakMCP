import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, TextInput, Switch, StyleSheet, ScrollView, Modal, TouchableOpacity, Platform, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppConfig, saveConfig, useConfigContext } from '../store/config';
import { useTheme, ThemeMode } from '../ui/ThemeProvider';
import { spacing, radius } from '../ui/theme';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { checkServerConnection, ConnectionCheckResult } from '../lib/connectionRecovery';
import { useTunnelConnection } from '../store/tunnelConnection';
import { SettingsApiClient, Profile, MCPServer, Settings } from '../lib/settingsApi';

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
  const { connect: tunnelConnect, disconnect: tunnelDisconnect } = useTunnelConnection();

  // Remote settings state
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | undefined>();
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [remoteSettings, setRemoteSettings] = useState<Settings | null>(null);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const styles = useMemo(() => createStyles(theme), [theme]);

  // Create settings API client when we have valid credentials
  const settingsClient = useMemo(() => {
    if (config.baseUrl && config.apiKey) {
      return new SettingsApiClient(config.baseUrl, config.apiKey);
    }
    return null;
  }, [config.baseUrl, config.apiKey]);

  // Fetch remote settings from desktop
  const fetchRemoteSettings = useCallback(async () => {
    if (!settingsClient) {
      setProfiles([]);
      setMcpServers([]);
      setRemoteSettings(null);
      return;
    }

    setIsLoadingRemote(true);
    setRemoteError(null);

    try {
      const errors: string[] = [];

      const [profilesRes, serversRes, settingsRes] = await Promise.all([
        settingsClient.getProfiles().catch((e) => { errors.push('profiles'); return null; }),
        settingsClient.getMCPServers().catch((e) => { errors.push('MCP servers'); return null; }),
        settingsClient.getSettings().catch((e) => { errors.push('settings'); return null; }),
      ]);

      if (profilesRes) {
        setProfiles(profilesRes.profiles);
        setCurrentProfileId(profilesRes.currentProfileId);
      }
      if (serversRes) {
        setMcpServers(serversRes.servers);
      }
      if (settingsRes) {
        setRemoteSettings(settingsRes);
      }

      // Show error if any endpoint failed
      if (errors.length > 0) {
        setRemoteError(`Failed to load: ${errors.join(', ')}`);
      }
    } catch (error: any) {
      console.error('[Settings] Failed to fetch remote settings:', error);
      setRemoteError(error.message || 'Failed to load remote settings');
    } finally {
      setIsLoadingRemote(false);
    }
  }, [settingsClient]);

  // Fetch remote settings when client becomes available
  useEffect(() => {
    if (settingsClient) {
      fetchRemoteSettings();
    }
  }, [settingsClient, fetchRemoteSettings]);

  // Handle pull-to-refresh
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchRemoteSettings();
    setIsRefreshing(false);
  }, [fetchRemoteSettings]);

  // Handle profile switch
  const handleProfileSwitch = async (profileId: string) => {
    if (!settingsClient || profileId === currentProfileId) return;

    try {
      await settingsClient.setCurrentProfile(profileId);
      setCurrentProfileId(profileId);
      // Refresh MCP servers as they may have changed with the profile
      const serversRes = await settingsClient.getMCPServers();
      setMcpServers(serversRes.servers);
    } catch (error: any) {
      console.error('[Settings] Failed to switch profile:', error);
      setRemoteError(error.message || 'Failed to switch profile');
    }
  };

  // Handle MCP server toggle
  const handleServerToggle = async (serverName: string, enabled: boolean) => {
    if (!settingsClient) return;

    try {
      await settingsClient.toggleMCPServer(serverName, enabled);
      // Update local state optimistically
      setMcpServers(prev => prev.map(s =>
        s.name === serverName ? { ...s, enabled, runtimeEnabled: enabled } : s
      ));
    } catch (error: any) {
      console.error('[Settings] Failed to toggle server:', error);
      setRemoteError(error.message || 'Failed to toggle server');
      // Refresh to get actual state
      fetchRemoteSettings();
    }
  };

  // Handle remote settings toggle
  const handleRemoteSettingToggle = async (key: keyof Settings, value: boolean) => {
    if (!settingsClient || !remoteSettings) return;

    try {
      await settingsClient.updateSettings({ [key]: value });
      setRemoteSettings(prev => prev ? { ...prev, [key]: value } : null);
    } catch (error: any) {
      console.error('[Settings] Failed to update setting:', error);
      setRemoteError(error.message || 'Failed to update setting');
    }
  };

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

    // Default to OpenAI URL if baseUrl is empty to prevent OpenAIClient from throwing
    if (!normalizedDraft.baseUrl) {
      normalizedDraft.baseUrl = 'https://api.openai.com/v1';
    }

    // Check if we have a base URL to validate
    // If using default OpenAI URL with no API key, allow pass-through (might be using built-in key)
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

    // Connect tunnel for persistence (fire and forget - don't block navigation)
    if (normalizedDraft.baseUrl && normalizedDraft.apiKey) {
      tunnelConnect(normalizedDraft.baseUrl, normalizedDraft.apiKey).catch((error) => {
        console.warn('[Settings] Tunnel connect failed (non-blocking):', error);
      });
    } else {
      // Clear tunnel metadata when credentials are removed
      tunnelDisconnect().catch((error) => {
        console.warn('[Settings] Tunnel disconnect failed (non-blocking):', error);
      });
    }

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
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
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

        <View style={styles.row}>
          <Text style={styles.label}>Message Queuing</Text>
          <Switch
            value={draft.messageQueueEnabled !== false}
            onValueChange={(v) => setDraft({ ...draft, messageQueueEnabled: v })}
            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
            thumbColor={draft.messageQueueEnabled !== false ? theme.colors.primaryForeground : theme.colors.background}
          />
        </View>
        <Text style={styles.helperText}>
          Queue messages while the agent is busy processing
        </Text>

        {/* Remote Settings Section - only show when connected */}
        {settingsClient && (
          <>
            <Text style={styles.sectionTitle}>Desktop Settings</Text>

            {isLoadingRemote && !isRefreshing && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.loadingText}>Loading remote settings...</Text>
              </View>
            )}

            {remoteError && (
              <View style={styles.warningContainer}>
                <Text style={styles.warningText}>⚠️ {remoteError}</Text>
                <TouchableOpacity onPress={fetchRemoteSettings}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Profile Switching */}
            {profiles.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Profile</Text>
                <View style={styles.profileList}>
                  {profiles.map((profile) => (
                    <TouchableOpacity
                      key={profile.id}
                      style={[
                        styles.profileItem,
                        currentProfileId === profile.id && styles.profileItemActive,
                      ]}
                      onPress={() => handleProfileSwitch(profile.id)}
                    >
                      <Text style={[
                        styles.profileName,
                        currentProfileId === profile.id && styles.profileNameActive,
                      ]}>
                        {profile.name}
                        {profile.isDefault && ' (Default)'}
                      </Text>
                      {currentProfileId === profile.id && (
                        <Text style={styles.checkmark}>✓</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* MCP Servers */}
            {mcpServers.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>MCP Servers</Text>
                {mcpServers.map((server) => (
                  <View key={server.name} style={styles.serverRow}>
                    <View style={styles.serverInfo}>
                      <View style={styles.serverNameRow}>
                        <View style={[
                          styles.statusDot,
                          server.connected ? styles.statusConnected : styles.statusDisconnected,
                        ]} />
                        <Text style={styles.serverName}>{server.name}</Text>
                      </View>
                      <Text style={styles.serverMeta}>
                        {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
                        {server.error && ` • ${server.error}`}
                      </Text>
                    </View>
                    <Switch
                      value={server.enabled}
                      onValueChange={(v) => handleServerToggle(server.name, v)}
                      trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                      thumbColor={server.enabled ? theme.colors.primaryForeground : theme.colors.background}
                      disabled={server.configDisabled}
                    />
                  </View>
                ))}
              </>
            )}

            {/* Feature Toggles */}
            {remoteSettings && (
              <>
                <Text style={styles.subsectionTitle}>Features</Text>

                <View style={styles.row}>
                  <Text style={styles.label}>Post-Processing</Text>
                  <Switch
                    value={remoteSettings.transcriptPostProcessingEnabled}
                    onValueChange={(v) => handleRemoteSettingToggle('transcriptPostProcessingEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.transcriptPostProcessingEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Clean up transcripts before sending to LLM
                </Text>

                <View style={styles.row}>
                  <Text style={styles.label}>Tool Approval Required</Text>
                  <Switch
                    value={remoteSettings.mcpRequireApprovalBeforeToolCall}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpRequireApprovalBeforeToolCall', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpRequireApprovalBeforeToolCall ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Require approval before executing MCP tools
                </Text>
              </>
            )}
          </>
        )}

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
    helperText: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      marginTop: -spacing.xs,
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
    // Remote settings styles
    subsectionTitle: {
      ...theme.typography.label,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.foreground,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    loadingText: {
      color: theme.colors.mutedForeground,
      fontSize: 14,
    },
    warningContainer: {
      backgroundColor: '#f59e0b20', // amber-500 with opacity
      borderWidth: 1,
      borderColor: '#f59e0b', // amber-500
      borderRadius: radius.md,
      padding: spacing.md,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    warningText: {
      color: '#d97706', // amber-600
      fontSize: 14,
      flex: 1,
    },
    retryText: {
      color: theme.colors.primary,
      fontSize: 14,
      fontWeight: '600',
      marginLeft: spacing.sm,
    },
    profileList: {
      gap: spacing.xs,
    },
    profileItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    profileItemActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary + '10',
    },
    profileName: {
      fontSize: 14,
      color: theme.colors.foreground,
    },
    profileNameActive: {
      fontWeight: '600',
      color: theme.colors.primary,
    },
    checkmark: {
      color: theme.colors.primary,
      fontSize: 16,
      fontWeight: '600',
    },
    serverRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    serverInfo: {
      flex: 1,
      marginRight: spacing.md,
    },
    serverNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    serverName: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.foreground,
    },
    serverMeta: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      marginTop: 2,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusConnected: {
      backgroundColor: '#22c55e', // green-500
    },
    statusDisconnected: {
      backgroundColor: theme.colors.muted,
    },
  });
}
