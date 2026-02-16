import { useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Platform, Image, ScrollView, TextInput, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme } from '../ui/theme';
import { useSessionContext, SessionStore } from '../store/sessions';
import { useConnectionManager } from '../store/connectionManager';
import { useTunnelConnection } from '../store/tunnelConnection';
import { useProfile } from '../store/profile';
import { ConnectionStatusIndicator } from '../ui/ConnectionStatusIndicator';
import { SessionListItem } from '../types/session';
import type { ChatGroup } from '@speakmcp/shared';

const darkSpinner = require('../../assets/loading-spinner.gif');
const lightSpinner = require('../../assets/light-spinner.gif');

const GROUP_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

interface Props {
  navigation: any;
}

export default function SessionListScreen({ navigation }: Props) {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const connectionManager = useConnectionManager();
  const { connectionInfo } = useTunnelConnection();
  const { currentProfile } = useProfile();

  // Group state
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null); // null = "All"
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [showMoveToGroupModal, setShowMoveToGroupModal] = useState(false);
  const [movingSessionId, setMovingSessionId] = useState<string | null>(null);

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
  const groups = sessionStore.groups;

  // Filter sessions by selected group
  const filteredSessions = useMemo(() => {
    if (selectedGroupId === null) return sessions;
    if (selectedGroupId === '__ungrouped__') return sessions.filter(s => !s.groupId);
    return sessions.filter(s => s.groupId === selectedGroupId);
  }, [sessions, selectedGroupId]);

  if (!sessionStore.ready) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <Image
          source={isDark ? darkSpinner : lightSpinner}
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

  const handleLongPress = (session: SessionListItem) => {
    if (Platform.OS === 'web') {
      // On web, just delete
      handleDeleteSession(session);
      return;
    }

    const options: Array<{ text: string; style?: 'cancel' | 'destructive' | 'default'; onPress?: () => void }> = [];

    if (groups.length > 0) {
      options.push({
        text: 'Move to Group',
        onPress: () => {
          setMovingSessionId(session.id);
          setShowMoveToGroupModal(true);
        },
      });

      if (session.groupId) {
        options.push({
          text: 'Remove from Group',
          onPress: () => sessionStore.setSessionGroup(session.id, undefined),
        });
      }
    }

    options.push({
      text: 'Delete',
      style: 'destructive',
      onPress: () => {
        connectionManager.removeConnection(session.id);
        sessionStore.deleteSession(session.id);
      },
    });

    options.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(session.title, undefined, options);
  };

  const handleClearAll = () => {
    const doClear = () => {
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

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await sessionStore.createGroup(newGroupName.trim(), newGroupColor);
    setNewGroupName('');
    setNewGroupColor(GROUP_COLORS[0]);
    setShowCreateGroupModal(false);
  };

  const handleDeleteGroup = (group: ChatGroup) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete group "${group.name}"? Sessions will be moved to ungrouped.`)) {
        sessionStore.deleteGroup(group.id);
        if (selectedGroupId === group.id) setSelectedGroupId(null);
      }
    } else {
      Alert.alert(
        'Delete Group',
        `Delete "${group.name}"? Sessions will be moved to ungrouped.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              sessionStore.deleteGroup(group.id);
              if (selectedGroupId === group.id) setSelectedGroupId(null);
            },
          },
        ]
      );
    }
  };

  const handleMoveSessionToGroup = (groupId: string | undefined) => {
    if (movingSessionId) {
      sessionStore.setSessionGroup(movingSessionId, groupId);
    }
    setShowMoveToGroupModal(false);
    setMovingSessionId(null);
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
    const group = item.groupId ? groups.find(g => g.id === item.groupId) : null;

    return (
      <TouchableOpacity
        style={[styles.sessionItem, isActive && styles.sessionItemActive]}
        onPress={() => handleSelectSession(item.id)}
        onLongPress={() => handleLongPress(item)}
      >
        <View style={styles.sessionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            {group && (
              <View style={[styles.groupBadge, { backgroundColor: (group.color || '#6b7280') + '22' }]}>
                <View style={[styles.groupDot, { backgroundColor: group.color || '#6b7280' }]} />
                <Text style={[styles.groupBadgeText, { color: group.color || '#6b7280' }]} numberOfLines={1}>
                  {group.name}
                </Text>
              </View>
            )}
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
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

      {/* Group filter chips */}
      {groups.length > 0 && (
        <View style={styles.groupFilterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupFilterScroll}>
            <TouchableOpacity
              style={[styles.groupChip, selectedGroupId === null && styles.groupChipActive]}
              onPress={() => setSelectedGroupId(null)}
            >
              <Text style={[styles.groupChipText, selectedGroupId === null && styles.groupChipTextActive]}>All</Text>
            </TouchableOpacity>
            {groups.map((group) => (
              <TouchableOpacity
                key={group.id}
                style={[
                  styles.groupChip,
                  selectedGroupId === group.id && styles.groupChipActive,
                  selectedGroupId === group.id && { borderColor: group.color || theme.colors.primary },
                ]}
                onPress={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}
                onLongPress={() => handleDeleteGroup(group)}
              >
                <View style={[styles.groupDot, { backgroundColor: group.color || '#6b7280' }]} />
                <Text
                  style={[
                    styles.groupChipText,
                    selectedGroupId === group.id && { color: group.color || theme.colors.primary },
                  ]}
                  numberOfLines={1}
                >
                  {group.name}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.groupChip}
              onPress={() => setShowCreateGroupModal(true)}
            >
              <Text style={styles.groupChipText}>+</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Add group button when no groups exist */}
      {groups.length === 0 && sessions.length > 0 && (
        <TouchableOpacity
          style={styles.createGroupBanner}
          onPress={() => setShowCreateGroupModal(true)}
        >
          <Text style={styles.createGroupBannerText}>+ Create a group to organize chats</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={filteredSessions}
        renderItem={renderSession}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filteredSessions.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={EmptyState}
      />

      {/* Create Group Modal */}
      <Modal
        visible={showCreateGroupModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateGroupModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCreateGroupModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalContent} onPress={() => {}}>
            <Text style={styles.modalTitle}>Create Group</Text>
            <TextInput
              style={styles.modalInput}
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder="Group name..."
              placeholderTextColor={theme.colors.mutedForeground}
              autoFocus
              onSubmitEditing={handleCreateGroup}
            />
            <View style={styles.colorPicker}>
              {GROUP_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorDot,
                    { backgroundColor: color },
                    newGroupColor === color && styles.colorDotSelected,
                  ]}
                  onPress={() => setNewGroupColor(color)}
                />
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowCreateGroupModal(false)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButtonCreate, !newGroupName.trim() && { opacity: 0.5 }]}
                onPress={handleCreateGroup}
                disabled={!newGroupName.trim()}
              >
                <Text style={styles.modalButtonCreateText}>Create</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Move to Group Modal */}
      <Modal
        visible={showMoveToGroupModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoveToGroupModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMoveToGroupModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalContent} onPress={() => {}}>
            <Text style={styles.modalTitle}>Move to Group</Text>
            <TouchableOpacity
              style={styles.moveGroupOption}
              onPress={() => handleMoveSessionToGroup(undefined)}
            >
              <Text style={styles.moveGroupOptionText}>Ungrouped</Text>
            </TouchableOpacity>
            {groups.map((group) => (
              <TouchableOpacity
                key={group.id}
                style={styles.moveGroupOption}
                onPress={() => handleMoveSessionToGroup(group.id)}
              >
                <View style={[styles.groupDot, { backgroundColor: group.color || '#6b7280' }]} />
                <Text style={styles.moveGroupOptionText}>{group.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalButtonCancel, { marginTop: spacing.md }]}
              onPress={() => setShowMoveToGroupModal(false)}
            >
              <Text style={styles.modalButtonCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
    // Group filter bar
    groupFilterContainer: {
      borderBottomWidth: theme.hairline,
      borderBottomColor: theme.colors.border,
    },
    groupFilterScroll: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.xs,
    },
    groupChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs + 1,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginRight: spacing.xs,
    },
    groupChipActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary + '15',
    },
    groupChipText: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      fontWeight: '500',
    },
    groupChipTextActive: {
      color: theme.colors.primary,
    },
    groupDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: 4,
    },
    createGroupBanner: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: theme.hairline,
      borderBottomColor: theme.colors.border,
    },
    createGroupBannerText: {
      fontSize: 13,
      color: theme.colors.primary,
      textAlign: 'center',
    },
    // Session list
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
    groupBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 8,
      marginRight: 6,
    },
    groupBadgeText: {
      fontSize: 10,
      fontWeight: '600',
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
    // Modals
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.card,
      borderRadius: radius.xl,
      padding: spacing.lg,
      width: '85%',
      maxWidth: 360,
    },
    modalTitle: {
      ...theme.typography.h3,
      marginBottom: spacing.md,
    },
    modalInput: {
      ...theme.typography.body,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius.md,
      padding: spacing.sm,
      color: theme.colors.foreground,
      marginBottom: spacing.md,
    },
    colorPicker: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    colorDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    colorDotSelected: {
      borderWidth: 3,
      borderColor: theme.colors.foreground,
    },
    modalButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
    },
    modalButtonCancel: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    modalButtonCancelText: {
      color: theme.colors.mutedForeground,
      fontWeight: '500',
    },
    modalButtonCreate: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
    },
    modalButtonCreateText: {
      color: theme.colors.primaryForeground,
      fontWeight: '600',
    },
    moveGroupOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.sm,
      borderBottomWidth: theme.hairline,
      borderBottomColor: theme.colors.border,
    },
    moveGroupOptionText: {
      ...theme.typography.body,
      color: theme.colors.foreground,
    },
  });
}
