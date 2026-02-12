import { useLayoutEffect, useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Platform, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme } from '../ui/theme';
import { useSessionContext, SessionStore } from '../store/sessions';
import { useConnectionManager } from '../store/connectionManager';
import { useTunnelConnection } from '../store/tunnelConnection';
import { useProfile } from '../store/profile';
import { useConfigContext } from '../store/config';
import { ConnectionStatusIndicator } from '../ui/ConnectionStatusIndicator';
import { SessionListItem, ExternalSessionSource, UnifiedSessionListItem } from '../types/session';
import { createExtendedSettingsApiClient, UnifiedConversation } from '../lib/settingsApi';

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

  // State for unified sessions (external + local)
  const [unifiedSessions, setUnifiedSessions] = useState<UnifiedSessionListItem[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);

  // Fetch unified conversation history from server
  const fetchUnifiedSessions = useCallback(async () => {
    if (!config.baseUrl || !config.apiKey) return;

    setLoadingExternal(true);
    try {
      const client = createExtendedSettingsApiClient(config.baseUrl, config.apiKey);
      const { conversations } = await client.getUnifiedConversations(100);

      // Transform to UnifiedSessionListItem format
      const items: UnifiedSessionListItem[] = conversations.map(conv => ({
        id: conv.id,
        title: conv.title || 'Untitled',
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messageCount || 0,
        lastMessage: conv.lastMessage || '',
        preview: conv.preview || '',
        source: conv.source,
        workspacePath: conv.workspacePath,
        filePath: conv.filePath,
      }));

      setUnifiedSessions(items);
    } catch (error) {
      console.warn('[SessionListScreen] Failed to fetch unified sessions:', error);
      // Fall back to empty - local sessions will still show
      setUnifiedSessions([]);
    } finally {
      setLoadingExternal(false);
    }
  }, [config.baseUrl, config.apiKey]);

  // Fetch unified sessions on mount and when config changes
  useEffect(() => {
    fetchUnifiedSessions();
  }, [fetchUnifiedSessions]);

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

  // Merge local sessions with unified sessions from server
  // Use unified sessions if available, otherwise fall back to local only
  const sessions: UnifiedSessionListItem[] = useMemo(() => {
    if (unifiedSessions.length > 0) {
      // Use unified sessions from server (already includes all sources)
      return unifiedSessions;
    }
    // Fall back to local sessions only (mark as speakmcp source)
    return sessionStore.getSessionList().map(s => ({
      ...s,
      source: 'speakmcp' as ExternalSessionSource,
    }));
  }, [unifiedSessions, sessionStore]);

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

  const handleSelectSession = async (item: UnifiedSessionListItem) => {
    if (item.source === 'speakmcp') {
      // Local/SpeakMCP session - use local session store
      sessionStore.setCurrentSession(item.id);
      navigation.navigate('Chat');
    } else {
      // External session (Augment/Claude Code) - continue via API
      if (!config.baseUrl || !config.apiKey) {
        Alert.alert('Error', 'Not connected to server');
        return;
      }

      try {
        const client = createExtendedSettingsApiClient(config.baseUrl, config.apiKey);
        const result = await client.continueExternalSession(item.id, item.source, item.workspacePath);

        if (result.success) {
          Alert.alert(
            'Session Continued',
            result.message || `${item.source === 'augment' ? 'Augment' : 'Claude Code'} session continued on desktop`
          );
        } else {
          Alert.alert('Error', result.error || 'Failed to continue session');
        }
      } catch (error: any) {
        Alert.alert('Error', error?.message || 'Failed to continue session');
      }
    }
  };

  const handleDeleteSession = (session: UnifiedSessionListItem) => {
    // Only allow deleting local/SpeakMCP sessions
    if (session.source !== 'speakmcp') {
      Alert.alert(
        'Cannot Delete',
        `${session.source === 'augment' ? 'Augment' : 'Claude Code'} sessions can only be deleted from the desktop app.`
      );
      return;
    }

    const doDelete = () => {
      // Clean up connection for this session (fixes #608)
      connectionManager.removeConnection(session.id);
      sessionStore.deleteSession(session.id);
      // Refresh unified sessions
      fetchUnifiedSessions();
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

  // Get source badge style
  const getSourceBadge = (source: ExternalSessionSource) => {
    switch (source) {
      case 'augment':
        return { label: 'A', color: '#8B5CF6' }; // Purple for Augment
      case 'claude-code':
        return { label: 'C', color: '#F97316' }; // Orange for Claude Code
      default:
        return null; // No badge for native speakmcp
    }
  };

  const renderSession = ({ item }: { item: UnifiedSessionListItem }) => {
    const isActive = item.source === 'speakmcp' && item.id === sessionStore.currentSessionId;
    const badge = getSourceBadge(item.source);

    return (
      <TouchableOpacity
        style={[styles.sessionItem, isActive && styles.sessionItemActive]}
        onPress={() => handleSelectSession(item)}
        onLongPress={() => handleDeleteSession(item)}
      >
        <View style={styles.sessionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            {badge && (
              <View style={[styles.sourceBadge, { backgroundColor: badge.color }]}>
                <Text style={styles.sourceBadgeText}>{badge.label}</Text>
              </View>
            )}
            <Text style={[styles.sessionTitle, { flex: 1 }]} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <Text style={styles.sessionDate}>{formatDate(item.updatedAt)}</Text>
        </View>
        {item.workspacePath && (
          <Text style={styles.workspacePath} numberOfLines={1}>
            📁 {item.workspacePath.split('/').slice(-2).join('/')}
          </Text>
        )}
        <Text style={styles.sessionPreview} numberOfLines={2}>
          {item.preview || 'No messages yet'}
        </Text>
        <Text style={styles.sessionMeta}>
          {item.messageCount} message{item.messageCount !== 1 ? 's' : ''}
          {item.source !== 'speakmcp' && ` • ${item.source === 'augment' ? 'Augment' : 'Claude Code'}`}
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
    sourceBadge: {
      width: 18,
      height: 18,
      borderRadius: 9,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 6,
    },
    sourceBadgeText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontWeight: '700',
    },
    workspacePath: {
      ...theme.typography.caption,
      color: theme.colors.mutedForeground,
      marginBottom: 4,
      opacity: 0.8,
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
  });
}

