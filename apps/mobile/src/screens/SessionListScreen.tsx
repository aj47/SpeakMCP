import { useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Pressable, StyleSheet, Alert, Platform, Image, GestureResponderEvent, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventEmitter } from 'expo-modules-core';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme } from '../ui/theme';
import { useSessionContext, SessionStore } from '../store/sessions';
import { useConnectionManager } from '../store/connectionManager';
import { useTunnelConnection } from '../store/tunnelConnection';
import { useProfile } from '../store/profile';
import { ConnectionStatusIndicator } from '../ui/ConnectionStatusIndicator';
import { SessionListItem, isStubSession } from '../types/session';

const darkSpinner = require('../../assets/loading-spinner.gif');
const lightSpinner = require('../../assets/light-spinner.gif');

interface Props {
  navigation: any;
}

export default function SessionListScreen({ navigation }: Props) {
  const { theme, isDark } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme, screenHeight), [theme, screenHeight]);
  const connectionManager = useConnectionManager();
  const { connectionInfo } = useTunnelConnection();
  const { currentProfile } = useProfile();

  // ── Rapid Fire voice state ─────────────────────────────────────────────────
  const [rfListening, setRfListening] = useState(false);
  const [rfTranscript, setRfTranscript] = useState('');
  const [rfStatus, setRfStatus] = useState<
    'idle' | 'listening' | 'sending' | 'sent' | 'empty' | 'permissionDenied' | 'unavailable' | 'error'
  >('idle');
  const rfListeningRef = useRef(false);
  const rfStartingRef = useRef(false);
  const rfStoppingRef = useRef(false);
  const rfFinalRef = useRef('');
  const rfLiveRef = useRef('');
  const rfSrEmitterRef = useRef<any>(null);
  const rfSrSubsRef = useRef<any[]>([]);
  const rfGrantTimeRef = useRef(0);
  const rfUserReleasedRef = useRef(false);
  const rfWebRecRef = useRef<any>(null);
  const rfMinHoldMs = 200;
  const sessionStoreRef = useRef<SessionStore | null>(null);
  const rfStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rfSetListening = useCallback((v: boolean) => {
    rfListeningRef.current = v;
    setRfListening(v);
  }, []);

  const rfCleanupSubs = useCallback(() => {
    for (const sub of rfSrSubsRef.current) {
      try { sub.remove(); } catch {}
    }
    rfSrSubsRef.current = [];
  }, []);

  const rfSetTransientStatus = useCallback((
    status: 'sent' | 'empty' | 'permissionDenied' | 'unavailable' | 'error',
    clearAfterMs = 2500
  ) => {
    if (rfStatusTimeoutRef.current) {
      clearTimeout(rfStatusTimeoutRef.current);
      rfStatusTimeoutRef.current = null;
    }
    setRfStatus(status);
    rfStatusTimeoutRef.current = setTimeout(() => {
      setRfStatus('idle');
      rfStatusTimeoutRef.current = null;
    }, clearAfterMs);
  }, []);

  const rfStartRecording = useCallback(async (e?: GestureResponderEvent) => {
    if (rfStartingRef.current || rfListeningRef.current) return;
    rfStartingRef.current = true;
    rfStoppingRef.current = false;
    rfUserReleasedRef.current = false;
    rfFinalRef.current = '';
    rfLiveRef.current = '';
    setRfTranscript('');
    setRfStatus('listening');
    rfGrantTimeRef.current = Date.now();
    rfSetListening(true);
    try {
      if (Platform.OS !== 'web') {
        const SR: any = await import('expo-speech-recognition');
        if (SR?.ExpoSpeechRecognitionModule?.start) {
          if (!rfSrEmitterRef.current) {
            rfSrEmitterRef.current = new EventEmitter(SR.ExpoSpeechRecognitionModule);
          }
          rfCleanupSubs();
          const subResult = rfSrEmitterRef.current.addListener('result', (event: any) => {
            const t = event?.results?.[0]?.transcript ?? event?.text ?? event?.transcript ?? '';
            if (t) { rfLiveRef.current = t; setRfTranscript(t); }
            if (event?.isFinal && t) { rfFinalRef.current = rfFinalRef.current ? `${rfFinalRef.current} ${t}` : t; }
          });
          const subError = rfSrEmitterRef.current.addListener('error', (event: any) => {
            console.error('[RapidFire] SR error:', JSON.stringify(event));
            rfSetTransientStatus('error');
          });
          const subEnd = rfSrEmitterRef.current.addListener('end', async () => {
            // If user hasn't released, SR ended spuriously – try to restart
            if (!rfUserReleasedRef.current && !rfStoppingRef.current) {
              try {
                const SRInner: any = await import('expo-speech-recognition');
                if (SRInner?.ExpoSpeechRecognitionModule?.start) {
                  SRInner.ExpoSpeechRecognitionModule.start({
                    lang: 'en-US', interimResults: true, continuous: true,
                    volumeChangeEventOptions: { enabled: false, intervalMillis: 250 },
                  });
                  return; // restarted – stay in listening state
                }
              } catch {}
            }
            rfSetListening(false);
          });
          rfSrSubsRef.current.push(subResult, subError, subEnd);
          try {
            const perm = await SR.ExpoSpeechRecognitionModule.getPermissionsAsync();
            if (!perm?.granted) {
              const req = await SR.ExpoSpeechRecognitionModule.requestPermissionsAsync();
              if (!req?.granted) {
                rfSetListening(false);
                rfStartingRef.current = false;
                rfSetTransientStatus('permissionDenied', 4000);
                Alert.alert(
                  'Microphone Permission Required',
                  'Rapid Fire needs microphone permission. Enable it in system settings and try again.',
                  [{ text: 'OK' }]
                );
                return;
              }
            }
          } catch {}
          SR.ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: true,
            volumeChangeEventOptions: { enabled: false, intervalMillis: 250 } });
          rfStartingRef.current = false;
          return;
        }
      }
      // Web fallback – use Web Speech API
      if (Platform.OS === 'web') {
        const SRClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SRClass) {
          const rec = new SRClass();
          rec.lang = 'en-US';
          rec.interimResults = true;
          rec.continuous = true;
          rec.onresult = (ev: any) => {
            let interim = '';
            let finalText = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const res = ev.results[i];
              const txt = res[0]?.transcript || '';
              if (res.isFinal) finalText += txt;
              else interim += txt;
            }
            if (interim) { rfLiveRef.current = interim; setRfTranscript(interim); }
            if (finalText) {
              rfFinalRef.current = rfFinalRef.current ? `${rfFinalRef.current} ${finalText}` : finalText;
            }
          };
          rec.onerror = (ev: any) => {
            console.error('[RapidFire] Web SR error:', ev?.error || ev);
            rfSetTransientStatus('error');
          };
          rec.onend = () => {
            // If user hasn't released, SR ended spuriously – try to restart
            if (!rfUserReleasedRef.current && !rfStoppingRef.current && rfWebRecRef.current) {
              try { rfWebRecRef.current.start(); return; } catch {}
            }
            rfSetListening(false);
          };
          rfWebRecRef.current = rec;
          rec.start();
          rfStartingRef.current = false;
          return;
        }
      }
    } catch (err) {
      console.warn('[RapidFire] SR unavailable:', (err as any)?.message || err);
      rfSetTransientStatus('unavailable', 4000);
    }
    rfSetListening(false);
    rfStartingRef.current = false;
  }, [rfCleanupSubs, rfSetListening, rfSetTransientStatus]);

  const rfStopAndFire = useCallback(async () => {
    if (rfStoppingRef.current) return;
    rfStoppingRef.current = true;
    rfUserReleasedRef.current = true;
    try {
      if (Platform.OS !== 'web') {
        const SR: any = await import('expo-speech-recognition');
        if (SR?.ExpoSpeechRecognitionModule?.stop) SR.ExpoSpeechRecognitionModule.stop();
      }
      if (Platform.OS === 'web' && rfWebRecRef.current) {
        try { rfWebRecRef.current.stop(); } catch {}
        rfWebRecRef.current = null;
      }
    } catch {}
    rfCleanupSubs();
    rfSetListening(false);
    setRfStatus('sending');
    const finalText = (rfFinalRef.current || rfLiveRef.current).trim();
    rfFinalRef.current = '';
    rfLiveRef.current = '';
    setRfTranscript('');
    if (finalText) {
      // Create a new session and persist transcript, but keep user on Sessions screen.
      const ss = sessionStoreRef.current;
      if (ss) {
        try {
          // Save previous currentSessionId — createNewSession() will switch it,
          // but we need to restore it so the (possibly mounted) ChatScreen doesn't
          // race-load the new session while it still has 0 messages.
          const prevSessionId = ss.currentSessionId;
          const newSession = ss.createNewSession();
          // Restore immediately so ChatScreen's useEffect doesn't prematurely load
          // the new empty session. When the user later taps the session,
          // setCurrentSession(newId) will properly trigger the load with messages.
          ss.setCurrentSession(prevSessionId);
          await ss.setMessagesForSession(newSession.id, [{ role: 'user', content: finalText }]);
          setRfTranscript(finalText);
          rfSetTransientStatus('sent');
        } catch (err) {
          console.error('[RapidFire] Failed to persist transcript:', err);
          rfSetTransientStatus('error');
        }
      } else {
        rfSetTransientStatus('error');
      }
    } else {
      rfSetTransientStatus('empty');
    }
  }, [rfCleanupSubs, rfSetListening, rfSetTransientStatus]);
  // ── end Rapid Fire ─────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    return () => {
      rfCleanupSubs();
      if (rfWebRecRef.current) {
        try { rfWebRecRef.current.stop(); } catch {}
        rfWebRecRef.current = null;
      }
      if (rfStatusTimeoutRef.current) {
        clearTimeout(rfStatusTimeoutRef.current);
      }
    };
  }, [rfCleanupSubs]);

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
  sessionStoreRef.current = sessionStore;
  const sessions = sessionStore.getSessionList();

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

  // Build a set of stub session IDs for display purposes
  const stubSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessionStore.sessions) {
      if (isStubSession(s)) ids.add(s.id);
    }
    return ids;
  }, [sessionStore.sessions]);

  const renderSession = ({ item }: { item: SessionListItem }) => {
    const isActive = item.id === sessionStore.currentSessionId;
    const isStub = stubSessionIds.has(item.id);

    return (
      <TouchableOpacity
        style={[styles.sessionItem, isActive && styles.sessionItemActive]}
        onPress={() => handleSelectSession(item.id)}
        onLongPress={() => handleDeleteSession(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.messageCount} message${item.messageCount !== 1 ? 's' : ''}`}
      >
        <View style={styles.sessionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            {isStub && (
              <Text style={{ fontSize: 12, marginRight: 4 }}>💻</Text>
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
          {isStub ? ' · from desktop' : ''}
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

  const rfHintText = rfStatus === 'listening'
    ? 'Release to send...'
    : rfStatus === 'sending'
      ? 'Sending...'
      : rfStatus === 'sent'
        ? 'Sent to a new chat. Tap it to open.'
        : rfStatus === 'empty'
          ? 'No speech detected. Try again.'
          : rfStatus === 'permissionDenied'
            ? 'Microphone permission denied. Enable it in settings.'
            : rfStatus === 'unavailable'
              ? 'Speech recognition unavailable on this build/device.'
              : rfStatus === 'error'
                ? 'Rapid Fire failed. Try again.'
                : 'Hold to talk (Rapid Fire)';

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.newButton} onPress={handleCreateSession} accessibilityRole="button" accessibilityLabel="New Chat">
          <Text style={styles.newButtonText}>+ New Chat</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {sessionStore.isSyncing && (
            <Image
              source={isDark ? darkSpinner : lightSpinner}
              style={{ width: 16, height: 16, marginRight: 8 }}
              resizeMode="contain"
            />
          )}
          {sessions.length > 0 && (
            <TouchableOpacity style={styles.clearButton} onPress={handleClearAll} accessibilityRole="button" accessibilityLabel="Clear All">
              <Text style={styles.clearButtonText}>Clear All</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={sessions}
        renderItem={renderSession}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sessions.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={EmptyState}
      />

      {/* Rapid Fire hold-to-speak button */}
      <View style={styles.rfContainer}>
        {(rfListening || rfStatus === 'sent') && rfTranscript ? (
          <Text style={styles.rfTranscript} numberOfLines={2}>{rfTranscript}</Text>
        ) : null}
        <Text style={styles.rfHint}>
          {rfHintText}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rfListening ? 'Release to send' : 'Hold to talk, Rapid Fire'}
          style={({ pressed }) => [
            styles.rfButton,
            rfListening && styles.rfButtonOn,
            pressed && !rfListening && { opacity: 0.8 },
          ]}
          onPressIn={(e: GestureResponderEvent) => {
            rfGrantTimeRef.current = Date.now();
            if (!rfListeningRef.current) { void rfStartRecording(e); }
          }}
          onPressOut={() => {
            const dt = Date.now() - rfGrantTimeRef.current;
            const delay = Math.max(0, rfMinHoldMs - dt);
            if (delay > 0) {
              setTimeout(() => { if (rfListeningRef.current) { void rfStopAndFire(); } }, delay);
            } else {
              if (rfListeningRef.current) { void rfStopAndFire(); }
            }
          }}
        >
          <Text style={styles.rfButtonText}>{rfListening ? '\uD83C\uDF99\uFE0F' : '\uD83C\uDFA4'}</Text>
          <Text style={styles.rfButtonLabel}>
            {rfListening ? '...' : (rfStatus === 'sending' ? 'Sending' : 'Hold')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: Theme, screenHeight: number) {
  const rfButtonHeight = Math.round(screenHeight * 0.18);
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
    rfContainer: {
      borderTopWidth: theme.hairline,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
      alignItems: 'center',
    },
    rfHint: {
      ...theme.typography.caption,
      color: theme.colors.mutedForeground,
      marginBottom: spacing.xs,
      textAlign: 'center',
    },
    rfTranscript: {
      ...theme.typography.body,
      color: theme.colors.foreground,
      textAlign: 'center',
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.md,
    },
    rfButton: {
      width: '100%' as any,
      height: rfButtonHeight,
      borderRadius: radius.xl,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rfButtonOn: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    rfButtonText: {
      fontSize: 36,
    },
    rfButtonLabel: {
      fontSize: 13,
      color: theme.colors.mutedForeground,
      marginTop: 4,
      fontWeight: '600',
    },
  });
}
