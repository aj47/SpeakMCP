import { useLayoutEffect, useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Platform, Image, ActivityIndicator, SectionList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme } from '../ui/theme';
import { useSessionContext, SessionStore } from '../store/sessions';
import { useConnectionManager } from '../store/connectionManager';
import { useTunnelConnection } from '../store/tunnelConnection';
import { useProfile } from '../store/profile';
import { useConfigContext } from '../store/config';
import { ConnectionStatusIndicator } from '../ui/ConnectionStatusIndicator';
import { ACPSessionBadge } from '../ui/ACPSessionBadge';
import { SessionListItem, ExternalSessionSource } from '../types/session';
import { ExtendedSettingsApiClient, UnifiedConversation, ExternalSessionProvider } from '../lib/settingsApi';

const staticIcon = require('../../assets/speakmcp-icon.png');

interface Props {
  navigation: any;
}

export default function SessionListScreen({ navigation }: Props) {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const connectionManager = useConnectionManager();
  const { connectionInfo } = useTunnelConnection();
  const { currentProfile } = useProfile();
  const { config } = useConfigContext();

  // External sessions state
  const [externalSessions, setExternalSessions] = useState<UnifiedConversation[]>([]);
  const [externalProviders, setExternalProviders] = useState<ExternalSessionProvider[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [showExternalSessions, setShowExternalSessions] = useState(false);

  // Fetch external sessions
  const fetchExternalSessions = useCallback(async () => {
    if (!config.baseUrl || !config.apiKey) return;
    setLoadingExternal(true);
    try {
      const client = new ExtendedSettingsApiClient(config.baseUrl, config.apiKey);
      const [sessionsRes, providersRes] = await Promise.allSettled([
        client.getUnifiedConversations(20),
        client.getExternalSessionProviders(),
      ]);
      if (sessionsRes.status === 'fulfilled') {
        setExternalSessions(sessionsRes.value.conversations.filter(c => c.source !== 'acp-remote'));
      }
      if (providersRes.status === 'fulfilled') {
        setExternalProviders(providersRes.value.providers);
      }
    } catch (error) {
      console.log('[SessionList] External sessions not available:', error);
    } finally {
      setLoadingExternal(false);
    }
  }, [config.baseUrl, config.apiKey]);

  useEffect(() => {
    fetchExternalSessions();
  }, [fetchExternalSessions]);

  useLayoutEffect(() => {
    navigation?.setOptions?.({
      headerTitle: () => (
        <View style={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: theme.colors.foreground }}>Chats</Text>
          {currentProfile && (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: theme.colors.primary + '33',
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 10,
              marginTop: 2,
            }}>
              <Text style={{
                fontSize: 11,
                color: theme.colors.primary,
                fontWeight: '500',
              }}>
                {currentProfile.name}
              </Text>
            </View>
          )}
        </View>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ConnectionStatusIndicator
            state={connectionInfo.state}
            retryCount={connectionInfo.retryCount}
            compact
          />
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={{ fontSize: 20, color: theme.colors.foreground }}>⚙️</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, theme, connectionInfo.state, connectionInfo.retryCount, currentProfile]);
  const insets = useSafeAreaInsets();
  const sessionStore = useSessionContext();
  const sessions = sessionStore.getSessionList();

  if (!sessionStore.ready) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <Image
          source={staticIcon}
          style={styles.spinner}
          resizeMode="contain"
        />
        <Text style={styles.loadingText}>Loading chats...</Text>
      </View>
    );
  }

  const handleCreateSession = () => {
    sessionStore.createNewSession();
    navigation.navigate('Chat');
  };

  const handleSelectSession = (sessionId: string) => {
    sessionStore.setCurrentSession(sessionId);
    navigation.navigate('Chat');
  };

  const handleDeleteSession = (session: SessionListItem) => {
    const doDelete = () => {
      // Clean up connection for this session (fixes #608)
      connectionManager.removeConnection(session.id);
      sessionStore.deleteSession(session.id);
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete "${session.title}"?`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Delete Session',
        `Are you sure you want to delete "${session.title}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  const handleClearAll = () => {
    const doClear = () => {
      // Clean up all connections (fixes #608)
      connectionManager.manager.cleanupAll();
      sessionStore.clearAllSessions();
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Delete all sessions? This cannot be undone.')) {
        doClear();
      }
    } else {
      Alert.alert(
        'Clear All Sessions',
        'Are you sure you want to delete all sessions? This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete All', style: 'destructive', onPress: doClear },
        ]
      );
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const renderSession = ({ item }: { item: SessionListItem }) => {
    const isActive = item.id === sessionStore.currentSessionId;
    
    return (
      <TouchableOpacity
        style={[styles.sessionItem, isActive && styles.sessionItemActive]}
        onPress={() => handleSelectSession(item.id)}
        onLongPress={() => handleDeleteSession(item)}
      >
        <View style={styles.sessionHeader}>
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.sessionDate}>{formatDate(item.updatedAt)}</Text>
        </View>
        <Text style={styles.sessionPreview} numberOfLines={2}>
          {item.preview || 'No messages yet'}
        </Text>
        <Text style={styles.sessionMeta}>
          {item.messageCount} message{item.messageCount !== 1 ? 's' : ''}
        </Text>
      </TouchableOpacity>
    );
  };

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>No Sessions Yet</Text>
      <Text style={styles.emptySubtitle}>
        Start a new chat to begin a conversation
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.newButton} onPress={handleCreateSession}>
          <Text style={styles.newButtonText}>+ New Chat</Text>
        </TouchableOpacity>
        {sessions.length > 0 && (
          <TouchableOpacity style={styles.clearButton} onPress={handleClearAll}>
            <Text style={styles.clearButtonText}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* External sessions toggle */}
      {externalSessions.length > 0 && (
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.externalToggle}
            onPress={() => setShowExternalSessions(!showExternalSessions)}
          >
            <Text style={styles.externalToggleText}>
              {showExternalSessions ? '▼' : '▶'} External Sessions ({externalSessions.length})
            </Text>
          </TouchableOpacity>
          {loadingExternal && <ActivityIndicator size="small" color={theme.colors.primary} />}
        </View>
      )}

      {/* External sessions list */}
      {showExternalSessions && externalSessions.length > 0 && (
        <FlatList
          data={externalSessions}
          renderItem={({ item }) => {
            const provider = externalProviders.find(p => p.source === item.source);
            return (
              <View style={[styles.sessionItem, styles.externalSessionItem]}>
                <View style={styles.sessionHeader}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[styles.sourceBadge, { backgroundColor: getSourceColor(item.source) + '22' }]}>
                      <Text style={[styles.sourceBadgeText, { color: getSourceColor(item.source) }]}>
                        {provider?.displayName || item.source}
                      </Text>
                    </View>
                    <Text style={styles.sessionTitle} numberOfLines={1}>{item.title}</Text>
                  </View>
                  <Text style={styles.sessionDate}>{formatDate(item.updatedAt)}</Text>
                </View>
                {item.preview && (
                  <Text style={styles.sessionPreview} numberOfLines={2}>{item.preview}</Text>
                )}
                <Text style={styles.sessionMeta}>
                  {item.messageCount} message{item.messageCount !== 1 ? 's' : ''}
                  {item.workspacePath ? ` • ${item.workspacePath.split('/').pop()}` : ''}
                </Text>
              </View>
            );
          }}
          keyExtractor={(item) => `ext-${item.source}-${item.id}`}
          contentContainerStyle={styles.list}
          style={{ maxHeight: 300 }}
        />
      )}

      <FlatList
        data={sessions}
        renderItem={renderSession}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sessions.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={EmptyState}
      />
    </View>
  );
}

function getSourceColor(source: ExternalSessionSource): string {
  switch (source) {
    case 'augment': return '#7c3aed'; // purple
    case 'claude-code': return '#f97316'; // orange
    case 'acp-remote': return '#3b82f6'; // blue
    default: return '#6b7280'; // gray
  }
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    loadingContainer: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    spinner: {
      width: 48,
      height: 48,
    },
    loadingText: {
      ...theme.typography.body,
      color: theme.colors.mutedForeground,
      marginTop: spacing.md,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.md,
      borderBottomWidth: theme.hairline,
      borderBottomColor: theme.colors.border,
    },
    newButton: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
    },
    newButtonText: {
      color: theme.colors.primaryForeground,
      fontWeight: '600',
    },
    clearButton: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    clearButtonText: {
      color: theme.colors.destructive,
      fontSize: 14,
    },
    list: {
      padding: spacing.md,
    },
    emptyList: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sessionItem: {
      backgroundColor: theme.colors.card,
      borderRadius: radius.xl,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    sessionItemActive: {
      borderColor: theme.colors.primary,
      borderWidth: 2,
    },
    sessionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    sessionTitle: {
      ...theme.typography.body,
      fontWeight: '600',
      flex: 1,
      marginRight: 8,
    },
    sessionDate: {
      ...theme.typography.caption,
      color: theme.colors.mutedForeground,
    },
    sessionPreview: {
      ...theme.typography.body,
      color: theme.colors.mutedForeground,
      marginBottom: 4,
    },
    sessionMeta: {
      ...theme.typography.caption,
      color: theme.colors.mutedForeground,
    },
    emptyState: {
      alignItems: 'center',
      padding: spacing.xl,
    },
    emptyTitle: {
      ...theme.typography.h2,
      marginBottom: spacing.sm,
    },
    emptySubtitle: {
      ...theme.typography.body,
      color: theme.colors.mutedForeground,
      textAlign: 'center',
    },
    externalToggle: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    externalToggleText: {
      ...theme.typography.body,
      color: theme.colors.primary,
      fontWeight: '500',
      fontSize: 14,
    },
    externalSessionItem: {
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.primary + '66',
    },
    sourceBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    sourceBadgeText: {
      fontSize: 10,
      fontWeight: '600',
    },
  });
}

