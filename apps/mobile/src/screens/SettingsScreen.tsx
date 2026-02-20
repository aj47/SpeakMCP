import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, TextInput, Switch, StyleSheet, ScrollView, Modal, TouchableOpacity, Platform, Pressable, ActivityIndicator, RefreshControl, Share, Alert, LayoutAnimation, UIManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppConfig, saveConfig, useConfigContext } from '../store/config';
import { useTheme, ThemeMode } from '../ui/ThemeProvider';
import { spacing, radius } from '../ui/theme';
import { useProfile } from '../store/profile';
import { usePushNotifications } from '../lib/pushNotifications';
import { SettingsApiClient, Profile, MCPServer, Settings, ModelInfo, SettingsUpdate } from '../lib/settingsApi';
import { TTSSettings } from '../ui/TTSSettings';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: '☀️ Light', value: 'light' },
  { label: '🌙 Dark', value: 'dark' },
  { label: '⚙️ System', value: 'system' },
];

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { theme, themeMode, setThemeMode } = useTheme();
  const { config, setConfig, ready } = useConfigContext();
  const [draft, setDraft] = useState<AppConfig>(config);
  const { setCurrentProfile: setProfileContext } = useProfile();

  // Push notification state
  const {
    permissionStatus: notificationPermission,
    isSupported: notificationsSupported,
    isRegistered: notificationsRegistered,
    isLoading: isNotificationLoading,
    register: registerPush,
    unregister: unregisterPush,
  } = usePushNotifications();

  // Remote settings state
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | undefined>();
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [remoteSettings, setRemoteSettings] = useState<Settings | null>(null);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Track if the server is a SpeakMCP desktop server (supports our settings API)
  const [isSpeakMCPServer, setIsSpeakMCPServer] = useState(false);

  // Profile import/export state
  const [isExportingProfile, setIsExportingProfile] = useState(false);
  const [isImportingProfile, setIsImportingProfile] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');

  // Model picker state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);

  // Preset picker state
  const [showPresetPicker, setShowPresetPicker] = useState(false);

  // Custom model input state (for debouncing)
  const [customModelDraft, setCustomModelDraft] = useState('');
  const modelUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collapsible section state - all new sections start collapsed
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    profileModel: true,  // Keep profile/model expanded by default since it was already visible
    mcpServers: true,    // Keep MCP servers expanded by default since it was already visible
    streamerMode: false,
    speechToText: false,
    textToSpeech: false,
    agentSettings: false,
    memorySummarization: false,
    toolExecution: false,
    whatsapp: false,
    langfuse: false,
  });

  // Debounced input state for string/number fields
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const inputTimeoutRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const styles = useMemo(() => createStyles(theme), [theme]);

  // Create settings API client when we have valid credentials
  const settingsClient = useMemo(() => {
    if (config.baseUrl && config.apiKey) {
      return new SettingsApiClient(config.baseUrl, config.apiKey);
    }
    return null;
  }, [config.baseUrl, config.apiKey]);

  // Clear pending model update timeout when settingsClient changes
  // to prevent sending updates to the previous server
  useEffect(() => {
    if (modelUpdateTimeoutRef.current) {
      clearTimeout(modelUpdateTimeoutRef.current);
      modelUpdateTimeoutRef.current = null;
    }
  }, [settingsClient]);

  // Fetch remote settings from desktop
  const fetchRemoteSettings = useCallback(async () => {
    if (!settingsClient) {
      setProfiles([]);
      setMcpServers([]);
      setRemoteSettings(null);
      setIsSpeakMCPServer(false);
      return;
    }

    setIsLoadingRemote(true);
    setRemoteError(null);

    try {
      const errors: string[] = [];
      let successCount = 0;

      const [profilesRes, serversRes, settingsRes] = await Promise.all([
        settingsClient.getProfiles().catch((e) => { errors.push('profiles'); return null; }),
        settingsClient.getMCPServers().catch((e) => { errors.push('MCP servers'); return null; }),
        settingsClient.getSettings().catch((e) => { errors.push('settings'); return null; }),
      ]);

      if (profilesRes) {
        setProfiles(profilesRes.profiles);
        setCurrentProfileId(profilesRes.currentProfileId);
        successCount++;
      }
      if (serversRes) {
        setMcpServers(serversRes.servers);
        successCount++;
      }
      if (settingsRes) {
        setRemoteSettings(settingsRes);
        successCount++;
      }

      // Consider it a SpeakMCP server if at least one endpoint succeeded
      // This gates the Desktop Settings section for non-SpeakMCP endpoints (e.g., OpenAI)
      setIsSpeakMCPServer(successCount > 0);

      // Show error if any endpoint failed but at least one succeeded
      if (errors.length > 0 && successCount > 0) {
        setRemoteError(`Failed to load: ${errors.join(', ')}`);
      } else if (successCount === 0) {
        // All endpoints failed - not a SpeakMCP server
        setIsSpeakMCPServer(false);
      }
    } catch (error: any) {
      console.error('[Settings] Failed to fetch remote settings:', error);
      setRemoteError(error.message || 'Failed to load remote settings');
      setIsSpeakMCPServer(false);
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
      // Update the profile context so the header badge updates immediately
      const selectedProfile = profiles.find(p => p.id === profileId);
      if (selectedProfile) {
        setProfileContext(selectedProfile);
      }
      // Refresh MCP servers as they may have changed with the profile
      const serversRes = await settingsClient.getMCPServers();
      setMcpServers(serversRes.servers);
    } catch (error: any) {
      console.error('[Settings] Failed to switch profile:', error);
      setRemoteError(error.message || 'Failed to switch profile');
    }
  };

  // Handle profile export
  const handleExportProfile = async () => {
    if (!settingsClient || !currentProfileId) return;

    setIsExportingProfile(true);
    try {
      const result = await settingsClient.exportProfile(currentProfileId);
      await Share.share({
        message: result.profileJson,
        title: 'Export Profile',
      });
    } catch (error: any) {
      console.error('[Settings] Failed to export profile:', error);
      Alert.alert('Export Failed', error.message || 'Failed to export profile');
    } finally {
      setIsExportingProfile(false);
    }
  };

  // Handle profile import
  const handleImportProfile = async () => {
    if (!settingsClient || !importJsonText.trim()) return;

    setIsImportingProfile(true);
    try {
      const result = await settingsClient.importProfile(importJsonText.trim());
      // Import succeeded - close modal and show success first
      setShowImportModal(false);
      setImportJsonText('');
      Alert.alert('Success', `Profile "${result.profile.name}" imported successfully`);

      // Refresh profiles list separately - don't show import failure if only refresh fails
      try {
        const profilesRes = await settingsClient.getProfiles();
        setProfiles(profilesRes.profiles);
        setCurrentProfileId(profilesRes.currentProfileId);
      } catch (refreshError: any) {
        console.error('[Settings] Failed to refresh profiles after import:', refreshError);
        // Don't show error alert - import was successful, just log the refresh issue
      }
    } catch (error: any) {
      console.error('[Settings] Failed to import profile:', error);
      Alert.alert('Import Failed', error.message || 'Failed to import profile');
    } finally {
      setIsImportingProfile(false);
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

  // Handle remote settings update for string/number fields (with debounce)
  const handleRemoteSettingUpdate = useCallback((key: keyof SettingsUpdate, value: string | number | string[]) => {
    // Update local draft immediately for responsive UI
    setInputDrafts(prev => ({ ...prev, [key]: String(value) }));
    setRemoteSettings(prev => prev ? { ...prev, [key]: value } : null);

    // Cancel any pending update for this key
    if (inputTimeoutRefs.current[key]) {
      clearTimeout(inputTimeoutRefs.current[key]);
    }

    // Debounce the actual API call by 1000ms
    inputTimeoutRefs.current[key] = setTimeout(async () => {
      if (!settingsClient) return;

      try {
        await settingsClient.updateSettings({ [key]: value });
      } catch (error: any) {
        console.error(`[Settings] Failed to update ${key}:`, error);
        setRemoteError(error.message || `Failed to update ${key}`);
        // Refresh to get actual state
        fetchRemoteSettings();
      }
    }, 1000);
  }, [settingsClient, fetchRemoteSettings]);

  // Cleanup input timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(inputTimeoutRefs.current).forEach(clearTimeout);
    };
  }, []);

  // Toggle section collapse state
  const toggleSection = useCallback((section: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Handle push notification toggle
  const handleNotificationToggle = async (enabled: boolean) => {
    if (!config.baseUrl || !config.apiKey) {
      Alert.alert('Configuration Required', 'Please configure your server connection first.');
      return;
    }

    if (enabled) {
      const success = await registerPush(config.baseUrl, config.apiKey);
      if (!success) {
        Alert.alert(
          'Permission Required',
          'Push notifications require permission. Please enable notifications in your device settings.',
          [{ text: 'OK' }]
        );
      }
    } else {
      await unregisterPush(config.baseUrl, config.apiKey);
    }
  };

  // Fetch available models for the current provider
  const fetchModels = useCallback(async (providerId: 'openai' | 'groq' | 'gemini') => {
    if (!settingsClient) return;

    setIsLoadingModels(true);
    try {
      const response = await settingsClient.getModels(providerId);
      setAvailableModels(response.models);
      // Check if current model is in the list, if not enable custom mode
      const currentModel = getCurrentModelValue();
      if (currentModel && response.models.length > 0) {
        const isInList = response.models.some(m => m.id === currentModel);
        setUseCustomModel(!isInList);
      }
    } catch (error: any) {
      console.error('[Settings] Failed to fetch models:', error);
      // Keep any existing models on error to avoid UI looking empty
      // Only log the error, don't clear the list
    } finally {
      setIsLoadingModels(false);
    }
  }, [settingsClient]);

  // Fetch models when remote settings load or provider changes
  useEffect(() => {
    if (remoteSettings?.mcpToolsProviderId && settingsClient) {
      fetchModels(remoteSettings.mcpToolsProviderId);
    }
  }, [remoteSettings?.mcpToolsProviderId, settingsClient, fetchModels]);

  // Handle provider change
  const handleProviderChange = async (provider: 'openai' | 'groq' | 'gemini') => {
    if (!settingsClient || !remoteSettings || remoteSettings.mcpToolsProviderId === provider) return;

    // Cancel any pending model update to avoid writing to the wrong provider's model key
    if (modelUpdateTimeoutRef.current) {
      clearTimeout(modelUpdateTimeoutRef.current);
      modelUpdateTimeoutRef.current = null;
    }

    try {
      await settingsClient.updateSettings({ mcpToolsProviderId: provider });
      setRemoteSettings(prev => prev ? { ...prev, mcpToolsProviderId: provider } : null);
      // Reset custom model mode when switching providers
      setUseCustomModel(false);
      // Models will be fetched via the useEffect above
    } catch (error: any) {
      console.error('[Settings] Failed to change provider:', error);
      setRemoteError(error.message || 'Failed to change provider');
    }
  };

  // Handle preset change (OpenAI compatible providers)
  const handlePresetChange = async (presetId: string) => {
    if (!settingsClient || !remoteSettings || remoteSettings.currentModelPresetId === presetId) return;

    // Cancel any pending model update to avoid writing to the wrong preset's context
    if (modelUpdateTimeoutRef.current) {
      clearTimeout(modelUpdateTimeoutRef.current);
      modelUpdateTimeoutRef.current = null;
    }

    setShowPresetPicker(false);
    try {
      await settingsClient.updateSettings({ currentModelPresetId: presetId });
      setRemoteSettings(prev => prev ? { ...prev, currentModelPresetId: presetId } : null);
      // Reset models and fetch new ones for the new preset
      setAvailableModels([]);
      setUseCustomModel(false);
      // Fetch models for the new preset
      if (remoteSettings.mcpToolsProviderId === 'openai') {
        fetchModels('openai');
      }
    } catch (error: any) {
      console.error('[Settings] Failed to change preset:', error);
      setRemoteError(error.message || 'Failed to change preset');
    }
  };

  // Get current preset display name
  const getCurrentPresetName = () => {
    if (!remoteSettings?.availablePresets || !remoteSettings.currentModelPresetId) return 'OpenAI';
    const preset = remoteSettings.availablePresets.find(p => p.id === remoteSettings.currentModelPresetId);
    return preset?.name || 'OpenAI';
  };

  // Handle model name change with debouncing to avoid request storms per keystroke
  const handleModelNameChange = useCallback((modelName: string) => {
    // Update draft state immediately for responsive UI
    setCustomModelDraft(modelName);

    // Cancel any pending update
    if (modelUpdateTimeoutRef.current) {
      clearTimeout(modelUpdateTimeoutRef.current);
    }

    // Debounce the actual API call by 500ms
    modelUpdateTimeoutRef.current = setTimeout(async () => {
      if (!settingsClient || !remoteSettings) return;

      const provider = remoteSettings.mcpToolsProviderId;
      const modelKey = provider === 'openai' ? 'mcpToolsOpenaiModel'
        : provider === 'groq' ? 'mcpToolsGroqModel'
        : 'mcpToolsGeminiModel';

      // Update local state
      setRemoteSettings(prev => prev ? { ...prev, [modelKey]: modelName } : null);

      try {
        await settingsClient.updateSettings({ [modelKey]: modelName });
      } catch (error: any) {
        console.error('[Settings] Failed to update model:', error);
        setRemoteError(error.message || 'Failed to update model');
        // Refresh to get actual state
        fetchRemoteSettings();
      }
    }, 500);
  }, [settingsClient, remoteSettings, fetchRemoteSettings]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (modelUpdateTimeoutRef.current) {
        clearTimeout(modelUpdateTimeoutRef.current);
      }
    };
  }, []);

  // Sync customModelDraft with remoteSettings when it changes (e.g., on initial load or provider change)
  useEffect(() => {
    if (remoteSettings) {
      setCustomModelDraft(getCurrentModelValue());
    }
  }, [remoteSettings?.mcpToolsProviderId, remoteSettings?.mcpToolsOpenaiModel, remoteSettings?.mcpToolsGroqModel, remoteSettings?.mcpToolsGeminiModel]);

  // Get current model value based on provider
  const getCurrentModelValue = () => {
    if (!remoteSettings) return '';
    const provider = remoteSettings.mcpToolsProviderId;
    if (provider === 'openai') return remoteSettings.mcpToolsOpenaiModel || '';
    if (provider === 'groq') return remoteSettings.mcpToolsGroqModel || '';
    return remoteSettings.mcpToolsGeminiModel || '';
  };

  // Get placeholder based on provider
  const getModelPlaceholder = () => {
    if (!remoteSettings) return '';
    const provider = remoteSettings.mcpToolsProviderId;
    if (provider === 'openai') return 'gpt-4o-mini';
    if (provider === 'groq') return 'llama-3.3-70b-versatile';
    return 'gemini-1.5-flash-002';
  };

  // Get display name for current model
  const getCurrentModelDisplayName = () => {
    const currentValue = getCurrentModelValue();
    if (!currentValue) return 'Select a model';
    const model = availableModels.find(m => m.id === currentValue);
    return model?.name || currentValue;
  };

  // Handle model selection from picker
  const handleModelSelect = async (modelId: string) => {
    setShowModelPicker(false);
    setModelSearchQuery('');
    await handleModelNameChange(modelId);
  };

  // Filter models by search query
  const filteredModels = useMemo(() => {
    if (!modelSearchQuery.trim()) return availableModels;
    const query = modelSearchQuery.toLowerCase();
    return availableModels.filter(
      m => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
    );
  }, [availableModels, modelSearchQuery]);

  useEffect(() => {
    setDraft(config);
  }, [ready, config]);

  // Sync input drafts with remoteSettings when they change
  useEffect(() => {
    if (remoteSettings) {
      setInputDrafts({
        sttLanguage: remoteSettings.sttLanguage || '',
        transcriptPostProcessingPrompt: remoteSettings.transcriptPostProcessingPrompt || '',
        mcpMaxIterations: String(remoteSettings.mcpMaxIterations ?? 10),
        whatsappAllowFrom: (remoteSettings.whatsappAllowFrom || []).join(', '),
        langfusePublicKey: remoteSettings.langfusePublicKey || '',
        langfuseSecretKey: remoteSettings.langfuseSecretKey === '••••••••' ? '' : (remoteSettings.langfuseSecretKey || ''),
        langfuseBaseUrl: remoteSettings.langfuseBaseUrl || '',
      });
    }
  }, [remoteSettings]);

  // CollapsibleSection component
  const CollapsibleSection = ({
    id,
    title,
    children
  }: {
    id: string;
    title: string;
    children: React.ReactNode;
  }) => {
    const isExpanded = expandedSections[id] ?? false;
    return (
      <View style={styles.collapsibleSection}>
        <TouchableOpacity
          style={styles.collapsibleHeader}
          onPress={() => toggleSection(id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: isExpanded }}
        >
          <Text style={styles.collapsibleTitle}>{title}</Text>
          <Text style={styles.collapsibleChevron}>{isExpanded ? '▼' : '▶'}</Text>
        </TouchableOpacity>
        {isExpanded && (
          <View style={styles.collapsibleContent}>
            {children}
          </View>
        )}
      </View>
    );
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

        {/* Connection Card - Tap to navigate to ConnectionSettings */}
        <TouchableOpacity
          style={styles.connectionCard}
          onPress={() => navigation.navigate('ConnectionSettings')}
          accessibilityRole="button"
          accessibilityLabel="Connection settings"
        >
          <View style={styles.connectionCardContent}>
            <View style={styles.connectionCardLeft}>
              <View style={styles.connectionStatusRow}>
                <View style={[
                  styles.statusDot,
                  { width: 10, height: 10, borderRadius: 5 },
                  config.baseUrl && config.apiKey
                    ? styles.statusConnected
                    : { backgroundColor: '#ef4444' }
                ]} />
                <Text style={styles.connectionCardTitle}>
                  {config.baseUrl && config.apiKey ? 'Connected' : 'Not connected'}
                </Text>
              </View>
              {config.baseUrl && (
                <Text style={styles.connectionCardUrl} numberOfLines={1}>
                  {config.baseUrl}
                </Text>
              )}
            </View>
            <Text style={styles.connectionCardChevron}>›</Text>
          </View>
        </TouchableOpacity>

        {/* Go to Chats button */}
        <TouchableOpacity
          style={[styles.primaryButton, !(config.baseUrl && config.apiKey) && styles.primaryButtonDisabled]}
          onPress={() => navigation.navigate('Sessions')}
          disabled={!(config.baseUrl && config.apiKey)}
          accessibilityRole="button"
          accessibilityLabel="Go to Chats"
        >
          <Text style={styles.primaryButtonText}>Go to Chats</Text>
        </TouchableOpacity>

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

        {/* TTS Voice Settings - shown when TTS is enabled */}
        {draft.ttsEnabled !== false && (
          <TTSSettings
            voiceId={draft.ttsVoiceId}
            rate={draft.ttsRate ?? 1.0}
            pitch={draft.ttsPitch ?? 1.0}
            onVoiceChange={(v) => setDraft({ ...draft, ttsVoiceId: v })}
            onRateChange={(r) => setDraft({ ...draft, ttsRate: r })}
            onPitchChange={(p) => setDraft({ ...draft, ttsPitch: p })}
          />
        )}

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

        {/* Push Notifications Section */}
        <Text style={styles.sectionTitle}>Notifications</Text>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Push Notifications</Text>
            {!notificationsSupported && (
              <Text style={[styles.helperText, { marginTop: 2 }]}>
                Only available on physical devices
              </Text>
            )}
            {notificationsSupported && notificationPermission === 'denied' && (
              <Text style={[styles.helperText, { marginTop: 2, color: theme.colors.destructive }]}>
                Permission denied - enable in device settings
              </Text>
            )}
          </View>
          <Switch
            value={notificationsRegistered}
            onValueChange={handleNotificationToggle}
            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
            thumbColor={notificationsRegistered ? theme.colors.primaryForeground : theme.colors.background}
            disabled={!notificationsSupported || isNotificationLoading}
          />
        </View>
        <Text style={styles.helperText}>
          Receive notifications when new messages arrive from your AI assistant
        </Text>

        {/* Remote Settings Section - only show when connected to a SpeakMCP desktop server */}
        {settingsClient && (isLoadingRemote || isSpeakMCPServer) && (
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
                <TouchableOpacity onPress={fetchRemoteSettings} accessibilityRole="button" accessibilityLabel="Retry">
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 4a. Profile & Model */}
            {remoteSettings && (
              <CollapsibleSection id="profileModel" title="Profile & Model">
                {/* Profile Switching */}
                {profiles.length > 0 && (
                  <>
                    <Text style={styles.label}>Profile</Text>
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
                    <View style={styles.profileActions}>
                      <TouchableOpacity
                        style={[styles.profileActionButton, isImportingProfile && styles.profileActionButtonDisabled]}
                        onPress={() => setShowImportModal(true)}
                        disabled={isImportingProfile}
                      >
                        <Text style={styles.profileActionButtonText}>
                          {isImportingProfile ? 'Importing...' : '📥 Import'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.profileActionButton, (!currentProfileId || isExportingProfile) && styles.profileActionButtonDisabled]}
                        onPress={handleExportProfile}
                        disabled={!currentProfileId || isExportingProfile}
                      >
                        <Text style={styles.profileActionButtonText}>
                          {isExportingProfile ? 'Exporting...' : '📤 Export'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {/* Model Settings */}
                <Text style={styles.label}>Provider</Text>
                <View style={styles.providerSelector}>
                  {(['openai', 'groq', 'gemini'] as const).map((provider) => (
                    <Pressable
                      key={provider}
                      style={[
                        styles.providerOption,
                        remoteSettings.mcpToolsProviderId === provider && styles.providerOptionActive,
                      ]}
                      onPress={() => handleProviderChange(provider)}
                    >
                      <Text style={[
                        styles.providerOptionText,
                        remoteSettings.mcpToolsProviderId === provider && styles.providerOptionTextActive,
                      ]}>
                        {provider.charAt(0).toUpperCase() + provider.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {remoteSettings.mcpToolsProviderId === 'openai' && remoteSettings.availablePresets && remoteSettings.availablePresets.length > 0 && (
                  <>
                    <Text style={styles.label}>OpenAI Compatible Endpoint</Text>
                    <TouchableOpacity
                      style={styles.modelSelector}
                      onPress={() => setShowPresetPicker(true)}
                    >
                      <View style={styles.modelSelectorContent}>
                        <Text style={styles.modelSelectorText}>
                          {getCurrentPresetName()}
                        </Text>
                        <Text style={styles.modelSelectorChevron}>▼</Text>
                      </View>
                    </TouchableOpacity>
                  </>
                )}

                <View style={styles.modelLabelRow}>
                  <Text style={styles.label}>Model Name</Text>
                  <View style={styles.modelActions}>
                    <TouchableOpacity
                      style={styles.modelActionButton}
                      onPress={() => setUseCustomModel(!useCustomModel)}
                    >
                      <Text style={styles.modelActionText}>
                        {useCustomModel ? '📋 List' : '✏️ Custom'}
                      </Text>
                    </TouchableOpacity>
                    {!useCustomModel && (
                      <TouchableOpacity
                        style={styles.modelActionButton}
                        onPress={() => remoteSettings?.mcpToolsProviderId && fetchModels(remoteSettings.mcpToolsProviderId)}
                        disabled={isLoadingModels}
                      >
                        <Text style={styles.modelActionText}>
                          {isLoadingModels ? '⏳' : '🔄'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {useCustomModel ? (
                  <TextInput
                    style={styles.input}
                    value={customModelDraft}
                    onChangeText={handleModelNameChange}
                    placeholder={getModelPlaceholder()}
                    placeholderTextColor={theme.colors.mutedForeground}
                    autoCapitalize='none'
                  />
                ) : (
                  <TouchableOpacity
                    style={styles.modelSelector}
                    onPress={() => setShowModelPicker(true)}
                    disabled={isLoadingModels}
                  >
                    {isLoadingModels ? (
                      <View style={styles.modelSelectorContent}>
                        <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
                        <Text style={styles.modelSelectorPlaceholder}>Loading models...</Text>
                      </View>
                    ) : (
                      <View style={styles.modelSelectorContent}>
                        <Text style={[
                          styles.modelSelectorText,
                          !getCurrentModelValue() && styles.modelSelectorPlaceholder
                        ]}>
                          {getCurrentModelDisplayName()}
                        </Text>
                        <Text style={styles.modelSelectorChevron}>▼</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              </CollapsibleSection>
            )}

            {/* 4b. Streamer Mode */}
            {remoteSettings && (
              <CollapsibleSection id="streamerMode" title="Streamer Mode">
                <View style={styles.row}>
                  <Text style={styles.label}>Streamer Mode</Text>
                  <Switch
                    value={remoteSettings.streamerModeEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('streamerModeEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.streamerModeEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Hide sensitive information when streaming or sharing screen
                </Text>
              </CollapsibleSection>
            )}

            {/* 4c. Speech-to-Text */}
            {remoteSettings && (
              <CollapsibleSection id="speechToText" title="Speech-to-Text">
                <Text style={styles.label}>STT Language</Text>
                <TextInput
                  style={styles.input}
                  value={inputDrafts.sttLanguage ?? ''}
                  onChangeText={(v) => handleRemoteSettingUpdate('sttLanguage', v)}
                  placeholder="en (default)"
                  placeholderTextColor={theme.colors.mutedForeground}
                  autoCapitalize='none'
                />
                <Text style={styles.helperText}>
                  Language code for speech-to-text (e.g., en, es, fr)
                </Text>

                <View style={styles.row}>
                  <Text style={styles.label}>Transcription Preview</Text>
                  <Switch
                    value={remoteSettings.transcriptionPreviewEnabled ?? true}
                    onValueChange={(v) => handleRemoteSettingToggle('transcriptionPreviewEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.transcriptionPreviewEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Show live transcription while recording
                </Text>

                <View style={styles.row}>
                  <Text style={styles.label}>Post-Processing</Text>
                  <Switch
                    value={remoteSettings.transcriptPostProcessingEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('transcriptPostProcessingEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.transcriptPostProcessingEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Clean up transcripts before sending to LLM
                </Text>

                {remoteSettings.transcriptPostProcessingEnabled && (
                  <>
                    <Text style={styles.label}>Post-Processing Prompt</Text>
                    <TextInput
                      style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                      value={inputDrafts.transcriptPostProcessingPrompt ?? ''}
                      onChangeText={(v) => handleRemoteSettingUpdate('transcriptPostProcessingPrompt', v)}
                      placeholder="Custom instructions for transcript cleanup..."
                      placeholderTextColor={theme.colors.mutedForeground}
                      multiline
                      numberOfLines={3}
                    />
                  </>
                )}
              </CollapsibleSection>
            )}

            {/* 4d. Text-to-Speech */}
            {remoteSettings && (
              <CollapsibleSection id="textToSpeech" title="Text-to-Speech">
                <View style={styles.row}>
                  <Text style={styles.label}>TTS Enabled</Text>
                  <Switch
                    value={remoteSettings.ttsEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('ttsEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.ttsEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Enable text-to-speech for responses on desktop
                </Text>

                {remoteSettings.ttsEnabled && (
                  <>
                    <View style={styles.row}>
                      <Text style={styles.label}>Auto-Play</Text>
                      <Switch
                        value={remoteSettings.ttsAutoPlay ?? true}
                        onValueChange={(v) => handleRemoteSettingToggle('ttsAutoPlay', v)}
                        trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                        thumbColor={remoteSettings.ttsAutoPlay ? theme.colors.primaryForeground : theme.colors.background}
                      />
                    </View>

                    <View style={styles.row}>
                      <Text style={styles.label}>TTS Preprocessing</Text>
                      <Switch
                        value={remoteSettings.ttsPreprocessingEnabled ?? true}
                        onValueChange={(v) => handleRemoteSettingToggle('ttsPreprocessingEnabled', v)}
                        trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                        thumbColor={remoteSettings.ttsPreprocessingEnabled ? theme.colors.primaryForeground : theme.colors.background}
                      />
                    </View>
                    <Text style={styles.helperText}>
                      Clean up text before speaking
                    </Text>

                    {remoteSettings.ttsPreprocessingEnabled && (
                      <>
                        <View style={[styles.row, { paddingLeft: spacing.md }]}>
                          <Text style={styles.label}>Remove Code Blocks</Text>
                          <Switch
                            value={remoteSettings.ttsRemoveCodeBlocks ?? true}
                            onValueChange={(v) => handleRemoteSettingToggle('ttsRemoveCodeBlocks', v)}
                            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                            thumbColor={remoteSettings.ttsRemoveCodeBlocks ? theme.colors.primaryForeground : theme.colors.background}
                          />
                        </View>

                        <View style={[styles.row, { paddingLeft: spacing.md }]}>
                          <Text style={styles.label}>Remove URLs</Text>
                          <Switch
                            value={remoteSettings.ttsRemoveUrls ?? true}
                            onValueChange={(v) => handleRemoteSettingToggle('ttsRemoveUrls', v)}
                            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                            thumbColor={remoteSettings.ttsRemoveUrls ? theme.colors.primaryForeground : theme.colors.background}
                          />
                        </View>

                        <View style={[styles.row, { paddingLeft: spacing.md }]}>
                          <Text style={styles.label}>Convert Markdown</Text>
                          <Switch
                            value={remoteSettings.ttsConvertMarkdown ?? true}
                            onValueChange={(v) => handleRemoteSettingToggle('ttsConvertMarkdown', v)}
                            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                            thumbColor={remoteSettings.ttsConvertMarkdown ? theme.colors.primaryForeground : theme.colors.background}
                          />
                        </View>

                        <View style={[styles.row, { paddingLeft: spacing.md }]}>
                          <Text style={styles.label}>Use LLM Preprocessing</Text>
                          <Switch
                            value={remoteSettings.ttsUseLLMPreprocessing ?? false}
                            onValueChange={(v) => handleRemoteSettingToggle('ttsUseLLMPreprocessing', v)}
                            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                            thumbColor={remoteSettings.ttsUseLLMPreprocessing ? theme.colors.primaryForeground : theme.colors.background}
                          />
                        </View>
                      </>
                    )}
                  </>
                )}
              </CollapsibleSection>
            )}

            {/* 4e. Agent Settings */}
            {remoteSettings && (
              <CollapsibleSection id="agentSettings" title="Agent Settings">
                <Text style={styles.label}>Main Agent Mode</Text>
                <View style={styles.providerSelector}>
                  {(['api', 'acp'] as const).map((mode) => (
                    <Pressable
                      key={mode}
                      style={[
                        styles.providerOption,
                        remoteSettings.mainAgentMode === mode && styles.providerOptionActive,
                      ]}
                      onPress={() => handleRemoteSettingUpdate('mainAgentMode', mode)}
                    >
                      <Text style={[
                        styles.providerOptionText,
                        remoteSettings.mainAgentMode === mode && styles.providerOptionTextActive,
                      ]}>
                        {mode.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.helperText}>
                  API uses external LLMs, ACP routes to an ACP agent
                </Text>

                <View style={styles.row}>
                  <Text style={styles.label}>Message Queue</Text>
                  <Switch
                    value={remoteSettings.mcpMessageQueueEnabled ?? true}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpMessageQueueEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpMessageQueueEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Require Tool Approval</Text>
                  <Switch
                    value={remoteSettings.mcpRequireApprovalBeforeToolCall ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpRequireApprovalBeforeToolCall', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpRequireApprovalBeforeToolCall ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Require approval before executing MCP tools
                </Text>

                <View style={styles.row}>
                  <Text style={styles.label}>Verify Completion</Text>
                  <Switch
                    value={remoteSettings.mcpVerifyCompletionEnabled ?? true}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpVerifyCompletionEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpVerifyCompletionEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Final Summary</Text>
                  <Switch
                    value={remoteSettings.mcpFinalSummaryEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpFinalSummaryEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpFinalSummaryEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Generate a summary after completing a task
                </Text>

                <Text style={styles.label}>Max Iterations</Text>
                <TextInput
                  style={styles.input}
                  value={inputDrafts.mcpMaxIterations ?? '10'}
                  onChangeText={(v) => {
                    const num = parseInt(v, 10);
                    if (!isNaN(num) && num >= 1 && num <= 100) {
                      handleRemoteSettingUpdate('mcpMaxIterations', num);
                    } else {
                      setInputDrafts(prev => ({ ...prev, mcpMaxIterations: v }));
                    }
                  }}
                  placeholder="10"
                  placeholderTextColor={theme.colors.mutedForeground}
                  keyboardType="number-pad"
                />

                <View style={styles.row}>
                  <Text style={styles.label}>Unlimited Iterations</Text>
                  <Switch
                    value={remoteSettings.mcpUnlimitedIterations ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpUnlimitedIterations', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpUnlimitedIterations ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
              </CollapsibleSection>
            )}

            {/* 4f. Memory & Summarization */}
            {remoteSettings && (
              <CollapsibleSection id="memorySummarization" title="Memory & Summarization">
                <View style={styles.row}>
                  <Text style={styles.label}>Memory System</Text>
                  <Switch
                    value={remoteSettings.memoriesEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('memoriesEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.memoriesEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Enable memory features and save_memory tool
                </Text>

                {remoteSettings.memoriesEnabled && (
                  <View style={[styles.row, { paddingLeft: spacing.md }]}>
                    <Text style={styles.label}>Inject Memories</Text>
                    <Switch
                      value={remoteSettings.dualModelInjectMemories ?? false}
                      onValueChange={(v) => handleRemoteSettingToggle('dualModelInjectMemories', v)}
                      trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                      thumbColor={remoteSettings.dualModelInjectMemories ? theme.colors.primaryForeground : theme.colors.background}
                    />
                  </View>
                )}

                <View style={styles.row}>
                  <Text style={styles.label}>Summarization</Text>
                  <Switch
                    value={remoteSettings.dualModelEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('dualModelEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.dualModelEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Generate summaries of agent steps for the UI
                </Text>

                {remoteSettings.dualModelEnabled && remoteSettings.memoriesEnabled && (
                  <View style={[styles.row, { paddingLeft: spacing.md }]}>
                    <Text style={styles.label}>Auto-Save Important</Text>
                    <Switch
                      value={remoteSettings.dualModelAutoSaveImportant ?? false}
                      onValueChange={(v) => handleRemoteSettingToggle('dualModelAutoSaveImportant', v)}
                      trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                      thumbColor={remoteSettings.dualModelAutoSaveImportant ? theme.colors.primaryForeground : theme.colors.background}
                    />
                  </View>
                )}
              </CollapsibleSection>
            )}

            {/* 4g. Tool Execution */}
            {remoteSettings && (
              <CollapsibleSection id="toolExecution" title="Tool Execution">
                <View style={styles.row}>
                  <Text style={styles.label}>Context Reduction</Text>
                  <Switch
                    value={remoteSettings.mcpContextReductionEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpContextReductionEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpContextReductionEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Reduce context size for tool responses
                </Text>

                <View style={styles.row}>
                  <Text style={styles.label}>Tool Response Processing</Text>
                  <Switch
                    value={remoteSettings.mcpToolResponseProcessingEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpToolResponseProcessingEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpToolResponseProcessingEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Parallel Tool Execution</Text>
                  <Switch
                    value={remoteSettings.mcpParallelToolExecution ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('mcpParallelToolExecution', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.mcpParallelToolExecution ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Execute multiple tools in parallel when possible
                </Text>
              </CollapsibleSection>
            )}

            {/* 4h. MCP Servers */}
            {mcpServers.length > 0 && (
              <CollapsibleSection id="mcpServers" title="MCP Servers">
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
              </CollapsibleSection>
            )}

            {/* 4i. WhatsApp */}
            {remoteSettings && (
              <CollapsibleSection id="whatsapp" title="WhatsApp">
                <View style={styles.row}>
                  <Text style={styles.label}>WhatsApp Integration</Text>
                  <Switch
                    value={remoteSettings.whatsappEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('whatsappEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.whatsappEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>

                {remoteSettings.whatsappEnabled && (
                  <>
                    <Text style={styles.label}>Allowed Numbers</Text>
                    <TextInput
                      style={styles.input}
                      value={inputDrafts.whatsappAllowFrom ?? ''}
                      onChangeText={(v) => {
                        // Update the text draft immediately for responsive UI
                        setInputDrafts(prev => ({ ...prev, whatsappAllowFrom: v }));
                        // Parse comma-separated numbers and debounce the API update
                        // without overwriting the user's raw text input
                        const numbers = v.split(',').map(n => n.trim()).filter(n => n);
                        setRemoteSettings(prev => prev ? { ...prev, whatsappAllowFrom: numbers } : null);
                        if (inputTimeoutRefs.current.whatsappAllowFrom) {
                          clearTimeout(inputTimeoutRefs.current.whatsappAllowFrom);
                        }
                        inputTimeoutRefs.current.whatsappAllowFrom = setTimeout(async () => {
                          if (!settingsClient) return;
                          try {
                            await settingsClient.updateSettings({ whatsappAllowFrom: numbers });
                          } catch (error: any) {
                            console.error('[Settings] Failed to update whatsappAllowFrom:', error);
                            setRemoteError(error.message || 'Failed to update whatsappAllowFrom');
                            fetchRemoteSettings();
                          }
                        }, 1000);
                      }}
                      placeholder="1234567890, 0987654321"
                      placeholderTextColor={theme.colors.mutedForeground}
                      autoCapitalize='none'
                      keyboardType="phone-pad"
                    />
                    <Text style={styles.helperText}>
                      Comma-separated phone numbers (international format without +)
                    </Text>

                    <View style={styles.row}>
                      <Text style={styles.label}>Auto-Reply</Text>
                      <Switch
                        value={remoteSettings.whatsappAutoReply ?? false}
                        onValueChange={(v) => handleRemoteSettingToggle('whatsappAutoReply', v)}
                        trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                        thumbColor={remoteSettings.whatsappAutoReply ? theme.colors.primaryForeground : theme.colors.background}
                      />
                    </View>

                    <View style={styles.row}>
                      <Text style={styles.label}>Log Messages</Text>
                      <Switch
                        value={remoteSettings.whatsappLogMessages ?? false}
                        onValueChange={(v) => handleRemoteSettingToggle('whatsappLogMessages', v)}
                        trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                        thumbColor={remoteSettings.whatsappLogMessages ? theme.colors.primaryForeground : theme.colors.background}
                      />
                    </View>
                    <Text style={styles.helperText}>
                      Log message content (privacy concern)
                    </Text>
                  </>
                )}
              </CollapsibleSection>
            )}

            {/* 4j. Langfuse */}
            {remoteSettings && (
              <CollapsibleSection id="langfuse" title="Langfuse">
                <View style={styles.row}>
                  <Text style={styles.label}>Langfuse Observability</Text>
                  <Switch
                    value={remoteSettings.langfuseEnabled ?? false}
                    onValueChange={(v) => handleRemoteSettingToggle('langfuseEnabled', v)}
                    trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
                    thumbColor={remoteSettings.langfuseEnabled ? theme.colors.primaryForeground : theme.colors.background}
                  />
                </View>
                <Text style={styles.helperText}>
                  Enable tracing and observability via Langfuse
                </Text>

                {remoteSettings.langfuseEnabled && (
                  <>
                    <Text style={styles.label}>Public Key</Text>
                    <TextInput
                      style={styles.input}
                      value={inputDrafts.langfusePublicKey ?? ''}
                      onChangeText={(v) => handleRemoteSettingUpdate('langfusePublicKey', v)}
                      placeholder="pk-..."
                      placeholderTextColor={theme.colors.mutedForeground}
                      autoCapitalize='none'
                    />

                    <Text style={styles.label}>Secret Key</Text>
                    <TextInput
                      style={styles.input}
                      value={inputDrafts.langfuseSecretKey ?? ''}
                      onChangeText={(v) => handleRemoteSettingUpdate('langfuseSecretKey', v)}
                      placeholder="sk-..."
                      placeholderTextColor={theme.colors.mutedForeground}
                      autoCapitalize='none'
                      secureTextEntry
                    />

                    <Text style={styles.label}>Base URL</Text>
                    <TextInput
                      style={styles.input}
                      value={inputDrafts.langfuseBaseUrl ?? ''}
                      onChangeText={(v) => handleRemoteSettingUpdate('langfuseBaseUrl', v)}
                      placeholder="https://cloud.langfuse.com (default)"
                      placeholderTextColor={theme.colors.mutedForeground}
                      autoCapitalize='none'
                      keyboardType="url"
                    />
                    <Text style={styles.helperText}>
                      Leave empty for Langfuse Cloud
                    </Text>
                  </>
                )}
              </CollapsibleSection>
            )}
          </>
        )}

      </ScrollView>

      {/* Model Picker Modal */}
      <Modal
        visible={showModelPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowModelPicker(false);
          setModelSearchQuery('');
        }}
      >
        <View style={styles.modelPickerOverlay}>
          <View style={styles.modelPickerContainer}>
            <View style={styles.modelPickerHeader}>
              <Text style={styles.modelPickerTitle}>Select Model</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowModelPicker(false);
                  setModelSearchQuery('');
                }}
              >
                <Text style={styles.modelPickerClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.modelSearchContainer}>
              <TextInput
                style={styles.modelSearchInput}
                value={modelSearchQuery}
                onChangeText={setModelSearchQuery}
                placeholder="Search models..."
                placeholderTextColor={theme.colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Models List */}
            <ScrollView style={styles.modelList} keyboardShouldPersistTaps="handled">
              {filteredModels.length === 0 ? (
                <View style={styles.modelListEmpty}>
                  <Text style={styles.modelListEmptyText}>
                    {modelSearchQuery ? `No models match "${modelSearchQuery}"` : 'No models available'}
                  </Text>
                </View>
              ) : (
                filteredModels.map((model) => {
                  const isSelected = getCurrentModelValue() === model.id;
                  return (
                    <TouchableOpacity
                      key={model.id}
                      style={[
                        styles.modelItem,
                        isSelected && styles.modelItemActive,
                      ]}
                      onPress={() => handleModelSelect(model.id)}
                    >
                      <View style={styles.modelItemContent}>
                        <Text style={[
                          styles.modelItemName,
                          isSelected && styles.modelItemNameActive,
                        ]}>
                          {model.name}
                        </Text>
                        {model.id !== model.name && (
                          <Text style={styles.modelItemId}>{model.id}</Text>
                        )}
                      </View>
                      {isSelected && (
                        <Text style={styles.modelItemCheck}>✓</Text>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {/* Footer with model count */}
            <View style={styles.modelPickerFooter}>
              <Text style={styles.modelPickerFooterText}>
                {modelSearchQuery
                  ? `${filteredModels.length} of ${availableModels.length} models`
                  : `${availableModels.length} model${availableModels.length !== 1 ? 's' : ''} available`}
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Preset Picker Modal */}
      <Modal
        visible={showPresetPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPresetPicker(false)}
      >
        <View style={styles.modelPickerOverlay}>
          <View style={styles.modelPickerContainer}>
            <View style={styles.modelPickerHeader}>
              <Text style={styles.modelPickerTitle}>Select Endpoint</Text>
              <TouchableOpacity onPress={() => setShowPresetPicker(false)}>
                <Text style={styles.modelPickerClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modelList}>
              {remoteSettings?.availablePresets?.map((preset) => {
                const isSelected = remoteSettings.currentModelPresetId === preset.id;
                return (
                  <TouchableOpacity
                    key={preset.id}
                    style={[
                      styles.modelItem,
                      isSelected && styles.modelItemActive,
                    ]}
                    onPress={() => handlePresetChange(preset.id)}
                  >
                    <View style={styles.modelItemContent}>
                      <Text style={[
                        styles.modelItemName,
                        isSelected && styles.modelItemNameActive,
                      ]}>
                        {preset.name}
                      </Text>
                      <Text style={styles.modelItemId}>{preset.baseUrl}</Text>
                    </View>
                    {isSelected && (
                      <Text style={styles.modelItemCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modelPickerFooter}>
              <Text style={styles.modelPickerFooterText}>
                {remoteSettings?.availablePresets?.length || 0} endpoint{(remoteSettings?.availablePresets?.length || 0) !== 1 ? 's' : ''} available
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Profile Import Modal */}
      <Modal
        visible={showImportModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowImportModal(false);
          setImportJsonText('');
        }}
      >
        <View style={styles.importModalOverlay}>
          <View style={styles.importModalContainer}>
            <View style={styles.importModalHeader}>
              <Text style={styles.importModalTitle}>Import Profile</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowImportModal(false);
                  setImportJsonText('');
                }}
              >
                <Text style={styles.importModalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.importModalDescription}>
              Paste the profile JSON below to import it.
            </Text>

            <TextInput
              style={styles.importJsonInput}
              value={importJsonText}
              onChangeText={setImportJsonText}
              placeholder='{"name": "My Profile", ...}'
              placeholderTextColor={theme.colors.mutedForeground}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
            />

            <View style={styles.importModalActions}>
              <TouchableOpacity
                style={styles.importModalCancelButton}
                onPress={() => {
                  setShowImportModal(false);
                  setImportJsonText('');
                }}
              >
                <Text style={styles.importModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.importModalImportButton,
                  (!importJsonText.trim() || isImportingProfile) && styles.importModalImportButtonDisabled,
                ]}
                onPress={handleImportProfile}
                disabled={!importJsonText.trim() || isImportingProfile}
              >
                <Text style={styles.importModalImportText}>
                  {isImportingProfile ? 'Importing...' : 'Import'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
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
    // Connection card styles
    connectionCard: {
      backgroundColor: theme.colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    connectionCardContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    connectionCardLeft: {
      flex: 1,
    },
    connectionStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    connectionCardTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.foreground,
    },
    connectionCardUrl: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      marginTop: spacing.xs,
    },
    connectionCardChevron: {
      fontSize: 24,
      color: theme.colors.mutedForeground,
      marginLeft: spacing.sm,
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
    providerSelector: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    providerOption: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
    },
    providerOptionActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    providerOptionText: {
      fontSize: 14,
      color: theme.colors.foreground,
    },
    providerOptionTextActive: {
      color: theme.colors.primaryForeground,
      fontWeight: '600',
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
    profileActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    profileActionButton: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
    },
    profileActionButtonDisabled: {
      opacity: 0.5,
    },
    profileActionButtonText: {
      fontSize: 14,
      color: theme.colors.foreground,
      fontWeight: '500',
    },
    importModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.lg,
    },
    importModalContainer: {
      backgroundColor: theme.colors.background,
      borderRadius: radius.lg,
      padding: spacing.lg,
      width: '100%',
      maxWidth: 400,
    },
    importModalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    importModalTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.foreground,
    },
    importModalClose: {
      fontSize: 20,
      color: theme.colors.mutedForeground,
      padding: spacing.xs,
    },
    importModalDescription: {
      fontSize: 14,
      color: theme.colors.mutedForeground,
      marginBottom: spacing.md,
    },
    importJsonInput: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      fontSize: 14,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.muted,
      minHeight: 150,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    importModalActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    importModalCancelButton: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
    },
    importModalCancelText: {
      fontSize: 14,
      color: theme.colors.foreground,
      fontWeight: '500',
    },
    importModalImportButton: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
    },
    importModalImportButtonDisabled: {
      opacity: 0.5,
    },
    importModalImportText: {
      fontSize: 14,
      color: theme.colors.primaryForeground,
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
    // Model picker styles
    modelLabelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    modelActions: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    modelActionButton: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    modelActionText: {
      fontSize: 12,
      color: theme.colors.primary,
    },
    modelSelector: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius.md,
      backgroundColor: theme.colors.background,
      padding: spacing.md,
    },
    modelSelectorContent: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.sm,
    },
    modelSelectorText: {
      flex: 1,
      fontSize: 14,
      color: theme.colors.foreground,
    },
    modelSelectorPlaceholder: {
      color: theme.colors.mutedForeground,
    },
    modelSelectorChevron: {
      fontSize: 10,
      color: theme.colors.mutedForeground,
    },
    // Model Picker Modal styles
    modelPickerOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modelPickerContainer: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '80%',
    },
    modelPickerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    modelPickerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.foreground,
    },
    modelPickerClose: {
      fontSize: 20,
      color: theme.colors.mutedForeground,
      padding: spacing.sm,
    },
    modelSearchContainer: {
      padding: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    modelSearchInput: {
      ...theme.input,
      marginTop: 0,
    },
    modelList: {
      maxHeight: 400,
    },
    modelListEmpty: {
      padding: spacing.xl,
      alignItems: 'center',
    },
    modelListEmptyText: {
      color: theme.colors.mutedForeground,
      fontSize: 14,
    },
    modelItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    modelItemActive: {
      backgroundColor: theme.colors.primary + '10',
    },
    modelItemContent: {
      flex: 1,
    },
    modelItemName: {
      fontSize: 14,
      color: theme.colors.foreground,
    },
    modelItemNameActive: {
      fontWeight: '600',
      color: theme.colors.primary,
    },
    modelItemId: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      marginTop: 2,
    },
    modelItemCheck: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.primary,
      marginLeft: spacing.sm,
    },
    modelPickerFooter: {
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      alignItems: 'center',
    },
    modelPickerFooterText: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
    },
    // Collapsible section styles
    collapsibleSection: {
      marginTop: spacing.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius.md,
      backgroundColor: theme.colors.card,
      overflow: 'hidden',
    },
    collapsibleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.md,
      backgroundColor: theme.colors.muted,
    },
    collapsibleTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.foreground,
    },
    collapsibleChevron: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
    },
    collapsibleContent: {
      padding: spacing.md,
      paddingTop: spacing.sm,
    },
  });
}
