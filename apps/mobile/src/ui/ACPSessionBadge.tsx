import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, ActivityIndicator } from 'react-native';
import { useTheme } from './ThemeProvider';
import { useConfigContext } from '../store/config';
import { ExtendedSettingsApiClient, ACPSessionInfo, ACPModelOrMode } from '../lib/settingsApi';

interface ACPSessionBadgeProps {
  compact?: boolean;
}

/**
 * Shows the current ACP session model/mode and allows changing them.
 * Fetches session info from the remote server and displays available options.
 */
export function ACPSessionBadge({ compact = false }: ACPSessionBadgeProps) {
  const { theme } = useTheme();
  const { config } = useConfigContext();
  const [sessionInfo, setSessionInfo] = useState<ACPSessionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'model' | 'mode'>('model');
  const [changing, setChanging] = useState(false);

  const client = new ExtendedSettingsApiClient(config.baseUrl, config.apiKey);

  const fetchSessionInfo = async () => {
    try {
      setLoading(true);
      const info = await client.getACPSession();
      setSessionInfo(info);
    } catch (error) {
      console.error('[ACPSessionBadge] Failed to fetch session info:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessionInfo();
    // Refresh periodically
    const interval = setInterval(fetchSessionInfo, 30000);
    return () => clearInterval(interval);
  }, [config.baseUrl, config.apiKey]);

  const hasMultipleModels = (sessionInfo?.availableModels?.length ?? 0) > 1;
  const hasMultipleModes = (sessionInfo?.availableModes?.length ?? 0) > 1;
  const canInteract = hasMultipleModels || hasMultipleModes;

  const handlePress = () => {
    if (!canInteract) return;
    setModalType(hasMultipleModels ? 'model' : 'mode');
    setModalVisible(true);
  };

  const handleSelect = async (item: ACPModelOrMode) => {
    if (!sessionInfo?.agentName || !sessionInfo?.sessionId) return;
    setChanging(true);
    try {
      if (modalType === 'model') {
        await client.setACPSessionModel(sessionInfo.agentName, sessionInfo.sessionId, item.id);
      } else {
        await client.setACPSessionMode(sessionInfo.agentName, sessionInfo.sessionId, item.id);
      }
      // Refresh session info
      await fetchSessionInfo();
    } catch (error) {
      console.error(`[ACPSessionBadge] Failed to set ${modalType}:`, error);
    } finally {
      setChanging(false);
      setModalVisible(false);
    }
  };

  if (!sessionInfo?.currentModel && !sessionInfo?.agentTitle) {
    return null;
  }

  const displayText = compact
    ? (sessionInfo.currentModel?.split('-').pop() ?? sessionInfo.agentTitle ?? '')
    : `${sessionInfo.currentModel ?? ''}${sessionInfo.currentMode ? ` • ${sessionInfo.currentMode}` : ''}`;

  const modalItems = modalType === 'model'
    ? sessionInfo?.availableModels ?? []
    : sessionInfo?.availableModes ?? [];
  const currentValue = modalType === 'model' ? sessionInfo?.currentModel : sessionInfo?.currentMode;

  return (
    <>
      <TouchableOpacity
        onPress={handlePress}
        disabled={!canInteract || loading}
        style={[styles.badge, { backgroundColor: theme.colors.muted }]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Text style={[styles.badgeText, { color: theme.colors.mutedForeground }]} numberOfLines={1}>
            {displayText}
          </Text>
        )}
        {canInteract && <Text style={[styles.chevron, { color: theme.colors.mutedForeground }]}>▼</Text>}
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalVisible(false)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.card }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.foreground }]}>
              Select {modalType === 'model' ? 'Model' : 'Mode'}
            </Text>
            {changing ? (
              <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginVertical: 20 }} />
            ) : (
              <FlatList
                data={modalItems}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.modalItem, item.id === currentValue && { backgroundColor: theme.colors.primary + '22' }]}
                    onPress={() => handleSelect(item)}
                  >
                    <Text style={[styles.modalItemText, { color: theme.colors.foreground }]}>{item.name || item.id}</Text>
                    {item.description && (
                      <Text style={[styles.modalItemDesc, { color: theme.colors.mutedForeground }]}>{item.description}</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
            {hasMultipleModels && hasMultipleModes && (
              <TouchableOpacity
                style={[styles.switchButton, { borderColor: theme.colors.border }]}
                onPress={() => setModalType(modalType === 'model' ? 'mode' : 'model')}
              >
                <Text style={{ color: theme.colors.primary }}>Switch to {modalType === 'model' ? 'Modes' : 'Models'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  badgeText: { fontSize: 11, fontWeight: '500' },
  chevron: { fontSize: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '80%', maxHeight: '60%', borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  modalItem: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  modalItemText: { fontSize: 14, fontWeight: '500' },
  modalItemDesc: { fontSize: 12, marginTop: 2 },
  switchButton: { marginTop: 12, paddingVertical: 10, borderTopWidth: 1, alignItems: 'center' },
});

export default ACPSessionBadge;
