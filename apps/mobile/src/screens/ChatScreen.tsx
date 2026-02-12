import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  GestureResponderEvent,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Pressable,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
} from 'react-native';

const staticIcon = require('../../assets/speakmcp-icon.png');
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventEmitter } from 'expo-modules-core';
import { useConfigContext, saveConfig } from '../store/config';
import { useSessionContext } from '../store/sessions';
import { useMessageQueueContext } from '../store/message-queue';
import { MessageQueuePanel } from '../ui/MessageQueuePanel';
import { useConnectionManager } from '../store/connectionManager';
import { useTunnelConnection } from '../store/tunnelConnection';
import { useProfile } from '../store/profile';
import { ConnectionStatusIndicator } from '../ui/ConnectionStatusIndicator';
import { ChatMessage, AgentProgressUpdate } from '../lib/openaiClient';
import { RecoveryState, formatConnectionStatus } from '../lib/connectionRecovery';
import * as Speech from 'expo-speech';
import {
  preprocessTextForTTS,
  shouldCollapseMessage,
  formatToolArguments,
  getToolResultsSummary,
} from '@speakmcp/shared';
import { useHeaderHeight } from '@react-navigation/elements';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme, hexToRgba } from '../ui/theme';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';

export default function ChatScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { config, setConfig } = useConfigContext();
  const sessionStore = useSessionContext();
  const messageQueue = useMessageQueueContext();
  const connectionManager = useConnectionManager();
  const { connectionInfo } = useTunnelConnection();
  const { currentProfile } = useProfile();
  const handsFree = !!config.handsFree;
  const messageQueueEnabled = config.messageQueueEnabled !== false; // default true
  const handsFreeRef = useRef<boolean>(handsFree);
  useEffect(() => { handsFreeRef.current = !!config.handsFree; }, [config.handsFree]);

  const toggleHandsFree = async () => {
    const next = !handsFreeRef.current;
    const nextCfg = { ...config, handsFree: next } as any;
    setConfig(nextCfg);
    try { await saveConfig(nextCfg); } catch {}
  };

  // TTS toggle
  const ttsEnabled = config.ttsEnabled !== false; // default true
  const toggleTts = async () => {
    const next = !ttsEnabled;
    // Stop any currently playing TTS when disabling
    if (!next) {
      Speech.stop();
    }
    const nextCfg = { ...config, ttsEnabled: next } as any;
    setConfig(nextCfg);
    try { await saveConfig(nextCfg); } catch {}
  };

  const [responding, setResponding] = useState(false);
  const [connectionState, setConnectionState] = useState<RecoveryState | null>(null);

  // Track the current active request to prevent cross-request state clobbering
  // Each request gets a unique ID; only the currently active request can reset UI states
  const activeRequestIdRef = useRef<number>(0);

  // Stable ref for current session ID to avoid stale closures in callbacks
  // This fixes the issue where useSessions() returns a new object each render
  const currentSessionIdRef = useRef<string | null>(sessionStore.currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = sessionStore.currentSessionId;
  }, [sessionStore.currentSessionId]);

  // Get or create a connection for the current session using the connection manager
  // This preserves connections when switching between sessions (fixes #608)
  const getSessionClient = useCallback(() => {
    const currentSessionId = sessionStore.currentSessionId;
    if (!currentSessionId) {
      console.warn('[ChatScreen] No current session ID, cannot get client');
      return null;
    }
    const connection = connectionManager.getOrCreateConnection(currentSessionId);
    // Note: Connection status callback is set up via subscribeToConnectionStatus in useEffect below
    // This avoids overwriting the SessionConnectionManager's internal callback (PR review fix)
    return connection.client;
  }, [connectionManager, sessionStore.currentSessionId]);

  // Subscribe to connection status changes for the current session
  // Uses subscribeToConnectionStatus to avoid overwriting the internal callback in SessionConnectionManager
  useEffect(() => {
    const currentSessionId = sessionStore.currentSessionId;
    if (!currentSessionId) {
      // Reset both connection state and responding state when there's no session
      // This prevents the UI from being stuck in "responding" state if the session
      // is deleted/cleared while ChatScreen remains mounted (PR review fix #15)
      setConnectionState(null);
      setResponding(false);
      return;
    }

    // Restore existing connection state when switching sessions
    const existingState = connectionManager.getConnectionState(currentSessionId);
    if (existingState) {
      setConnectionState(existingState);
    } else {
      setConnectionState(null);
    }

    // Check if there's an active request for this session
    const isActive = connectionManager.isConnectionActive(currentSessionId);
    setResponding(isActive);

    // Ensure connection exists for subscription
    connectionManager.getOrCreateConnection(currentSessionId);

    // Subscribe to connection status changes for this session
    // The callback uses currentSessionIdRef to always check against the latest session ID
    const unsubscribe = connectionManager.subscribeToConnectionStatus(
      currentSessionId,
      (state) => {
        // Only update UI if this is still the current session (using ref for latest value)
        if (currentSessionIdRef.current === currentSessionId) {
          setConnectionState(state);
          console.log('[ChatScreen] Connection status:', formatConnectionStatus(state));
        }
      }
    );

    return unsubscribe;
  }, [sessionStore.currentSessionId, connectionManager]);

  const handleKillSwitch = async () => {
    console.log('[ChatScreen] Kill switch button pressed');
    const client = getSessionClient();
    if (!client) {
      console.error('[ChatScreen] No client available for kill switch');
      return;
    }

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(
        '⚠️ Emergency Stop\n\nAre you sure you want to stop all agent sessions on the remote server? This will immediately terminate any running tasks.'
      );
      if (confirmed) {
        try {
          const result = await client.killSwitch();
          if (result.success) {
            window.alert(result.message || 'All sessions stopped');
          } else {
            window.alert('Error: ' + (result.error || 'Failed to stop sessions'));
          }
        } catch (e: any) {
          console.error('[ChatScreen] Kill switch error:', e);
          window.alert('Error: ' + (e.message || 'Failed to connect to server'));
        }
      }
      return;
    }

    Alert.alert(
      '⚠️ Emergency Stop',
      'Are you sure you want to stop all agent sessions on the remote server? This will immediately terminate any running tasks.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop All',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await client.killSwitch();
              if (result.success) {
                Alert.alert('Success', result.message || 'All sessions stopped');
              } else {
                Alert.alert('Error', result.error || 'Failed to stop sessions');
              }
            } catch (e: any) {
              console.error('[ChatScreen] Kill switch error:', e);
              Alert.alert('Error', e.message || 'Failed to connect to server');
            }
          },
        },
      ],
    );
  };

  const handleNewChat = useCallback(() => {
    // Reset all UI states unconditionally when creating a new chat
    // This ensures the new session starts with a clean slate, even if
    // an old request is still in-flight (its callbacks will be ignored
    // via the session/request guards)
    setResponding(false);
    setConnectionState(null);
    setDebugInfo('');
    sessionStore.createNewSession();
  }, [sessionStore]);

  useLayoutEffect(() => {
    navigation?.setOptions?.({
      headerTitle: () => (
        <View style={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: theme.colors.foreground }}>Chat</Text>
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
      headerLeft: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Sessions')}
            accessibilityRole="button"
            accessibilityLabel="Back to chat history"
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ fontSize: 20, color: theme.colors.foreground }}>←</Text>
          </TouchableOpacity>
        </View>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ConnectionStatusIndicator
            state={connectionInfo.state}
            retryCount={connectionInfo.retryCount}
            compact
          />
          {responding && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
              <Image
                source={staticIcon}
                style={{ width: 28, height: 28 }}
                resizeMode="contain"
              />
            </View>
          )}
          <TouchableOpacity
            onPress={handleNewChat}
            accessibilityRole="button"
            accessibilityLabel="Start new chat"
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
          >
            <Text style={{ fontSize: 18, color: theme.colors.foreground }}>✚</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleKillSwitch}
            accessibilityRole="button"
            accessibilityLabel="Emergency stop - kill all agent sessions"
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
          >
            <View style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: theme.colors.danger,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 14, color: '#FFFFFF' }}>⏹</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleHandsFree}
            accessibilityRole="button"
            accessibilityLabel={`Toggle hands-free (currently ${handsFree ? 'on' : 'off'})`}
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
          >
            <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18 }}>🎙️</Text>
              {!handsFree && (
                <View
                  style={{
                    position: 'absolute',
                    width: 20,
                    height: 2,
                    backgroundColor: theme.colors.danger,
                    transform: [{ rotate: '45deg' }],
                    borderRadius: 1,
                  }}
                />
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ fontSize: 18, color: theme.colors.foreground }}>⚙️</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, handsFree, handleKillSwitch, handleNewChat, responding, theme, isDark, sessionStore, connectionInfo.state, connectionInfo.retryCount, currentProfile]);


  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Keep a ref to messages to avoid stale closures in setTimeout callbacks (PR review fix)
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
	// Stable ref to the latest send() to avoid stale closures in speech callbacks
	const sendRef = useRef<(text: string) => Promise<void>>(async () => {});
	// Voice debug logging - only in dev mode
	const voiceLog = useCallback((msg: string, extra?: any) => {
		if (!__DEV__) return;
		if (typeof extra !== 'undefined') console.log(`[Voice] ${msg}`, extra);
		else console.log(`[Voice] ${msg}`);
	}, []);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
	const listeningRef = useRef<boolean>(listening);
	useEffect(() => { listeningRef.current = listening; }, [listening]);
	const setListeningValue = useCallback((v: boolean) => {
		listeningRef.current = v;
		setListening(v);
	}, []);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [expandedMessages, setExpandedMessages] = useState<Record<number, boolean>>({});
  // Track which individual tool calls are fully expanded to show all input/output details
  // Key format: "messageId-toolCallIndex" (messageId falls back to message array index if undefined)
  const [expandedToolCalls, setExpandedToolCalls] = useState<Record<string, boolean>>({});
  // Track the last failed message for retry functionality
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  // Auto-scroll state and ref for mobile chat
  const scrollViewRef = useRef<ScrollView>(null);

  // Ref for mic button to attach native DOM listeners on web
  const micButtonRef = useRef<View>(null);

  // Attach native DOM event listeners on web to prevent text selection on long press
  useEffect(() => {
    if (Platform.OS !== 'web' || !micButtonRef.current) return;

    // @ts-ignore - Get the underlying DOM element from React Native Web
    const domNode = micButtonRef.current as any;
    if (!domNode || typeof domNode.addEventListener !== 'function') return;

    const handleTouchStart = (e: TouchEvent) => {
      // Prevent default to stop text selection on long press
      if (e.cancelable) e.preventDefault();
    };

    const handleContextMenu = (e: Event) => {
      e.preventDefault();
    };

    // Use passive: false to allow preventDefault
    domNode.addEventListener('touchstart', handleTouchStart, { passive: false });
    domNode.addEventListener('contextmenu', handleContextMenu, { passive: false });

    return () => {
      domNode.removeEventListener('touchstart', handleTouchStart);
      domNode.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  // Track scroll timeout for debouncing rapid message updates
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track current auto-scroll state for use in timeout callbacks
  const shouldAutoScrollRef = useRef(true);
  // Track if user is actively dragging to distinguish from programmatic scrolls
  const isUserDraggingRef = useRef(false);
  // Track drag end timeout to prevent flaky behavior with rapid re-drags
  const dragEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    shouldAutoScrollRef.current = shouldAutoScroll;
    // Cancel any pending scroll when user disables auto-scroll
    if (!shouldAutoScroll && scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  }, [shouldAutoScroll]);

  // Handle user starting to drag the scroll view
  const handleScrollBeginDrag = useCallback(() => {
    // Clear any pending drag end timeout from previous drag
    if (dragEndTimeoutRef.current) {
      clearTimeout(dragEndTimeoutRef.current);
      dragEndTimeoutRef.current = null;
    }
    isUserDraggingRef.current = true;
  }, []);

  // Handle user ending drag - keep flag active briefly for momentum scroll
  const handleScrollEndDrag = useCallback(() => {
    // Clear any existing drag end timeout before scheduling a new one
    if (dragEndTimeoutRef.current) {
      clearTimeout(dragEndTimeoutRef.current);
    }
    // Clear the flag after a short delay to account for momentum scrolling
    dragEndTimeoutRef.current = setTimeout(() => {
      isUserDraggingRef.current = false;
      dragEndTimeoutRef.current = null;
    }, 150);
  }, []);

  // Handle scroll events to detect when user scrolls away from bottom
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    // Consider "at bottom" if within 50 pixels of the bottom
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;

    if (isAtBottom && !shouldAutoScroll) {
      // User scrolled back to bottom, resume auto-scroll
      setShouldAutoScroll(true);
    } else if (!isAtBottom && shouldAutoScroll && isUserDraggingRef.current) {
      // Only pause auto-scroll when user is actively dragging (not programmatic scroll)
      setShouldAutoScroll(false);
    }
  }, [shouldAutoScroll]);

  // Scroll to bottom when messages change and auto-scroll is enabled
  // Uses debouncing to handle rapid streaming updates efficiently
  useEffect(() => {
    if (shouldAutoScroll && scrollViewRef.current) {
      // Clear any pending scroll timeout to debounce rapid updates
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Schedule a new scroll with a short delay to batch rapid updates
      scrollTimeoutRef.current = setTimeout(() => {
        // Double-check auto-scroll is still enabled before scrolling
        if (shouldAutoScrollRef.current && scrollViewRef.current) {
          scrollViewRef.current.scrollToEnd({ animated: true });
        }
      }, 50);
    }
  }, [messages, shouldAutoScroll]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (dragEndTimeoutRef.current) {
        clearTimeout(dragEndTimeoutRef.current);
      }
    };
  }, []);

  // Reset auto-scroll when session changes
  useEffect(() => {
    setShouldAutoScroll(true);
    // Scroll to bottom when switching sessions
    const timeoutId = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: false });
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [sessionStore.currentSessionId]);

  const lastLoadedSessionIdRef = useRef<string | null>(null);

  // Load messages when currentSessionId changes (fixes #470)
  useEffect(() => {
    const currentSessionId = sessionStore.currentSessionId;

    if (lastLoadedSessionIdRef.current === currentSessionId) {
      return;
    }

    // Reset expandedMessages and expandedToolCalls on ANY session switch to ensure consistent
    // "final response expanded" behavior per chat and prevent stale UI state from leaking
    // across sessions (fixes review comment about keys like "0-0" leaking across chats)
    setExpandedMessages({});
    setExpandedToolCalls({});

    let currentSession = sessionStore.getCurrentSession();

    // If we have an existing session, always load its messages regardless of deletions
    if (currentSession) {
      lastLoadedSessionIdRef.current = currentSession.id;

      if (currentSession.messages.length > 0) {
        const chatMessages: ChatMessage[] = currentSession.messages.map(m => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          toolResults: m.toolResults,
        }));
        setMessages(chatMessages);
      } else {
        setMessages([]);
      }
      return;
    }

    // No current session - only auto-create if no deletions are in progress (fixes #571)
    // This prevents race conditions where a new session is created before the deletion completes
    if (sessionStore.deletingSessionIds.size > 0) {
      return;
    }

    currentSession = sessionStore.createNewSession();
    lastLoadedSessionIdRef.current = currentSession.id;

    if (currentSession.messages.length > 0) {
      const chatMessages: ChatMessage[] = currentSession.messages.map(m => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolResults: m.toolResults,
      }));
      setMessages(chatMessages);
    } else {
      setMessages([]);
    }
  }, [sessionStore.currentSessionId, sessionStore, sessionStore.deletingSessionIds.size]);

  const prevMessagesLengthRef = useRef(0);
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentSessionId = sessionStore.currentSessionId;

    // Don't save messages if the current session is being deleted (fixes #571)
    // Only skip if the current session is in the deleting set, not for any deletion
    if (currentSessionId && sessionStore.deletingSessionIds.has(currentSessionId)) {
      return;
    }

    const isSessionSwitch = prevSessionIdRef.current !== null && prevSessionIdRef.current !== currentSessionId;
    prevSessionIdRef.current = currentSessionId;

    if (isSessionSwitch) {
      prevMessagesLengthRef.current = messages.length;
      return;
    }

    if (messages.length > 0 && messages.length !== prevMessagesLengthRef.current) {
      sessionStore.setMessages(messages);
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages, sessionStore, sessionStore.currentSessionId, sessionStore.deletingSessionIds]);

  const toggleMessageExpansion = useCallback((index: number) => {
    setExpandedMessages(prev => ({ ...prev, [index]: !prev[index] }));
  }, []);

  // Toggle expansion of individual tool call details (input params and results)
  const toggleToolCallExpansion = useCallback((messageId: string, toolCallIndex: number) => {
    const key = `${messageId}-${toolCallIndex}`;
    setExpandedToolCalls(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Auto-expand only the final assistant message (the last one in the conversation)
  // Tool call messages (intermediate assistant messages with tool calls) should be collapsed by default
  // When a new message arrives, collapse previous assistant messages with tool calls
  useEffect(() => {
    const lastAssistantIndex = messages.reduce((lastIdx, m, i) =>
      m.role === 'assistant' ? i : lastIdx, -1);

    if (lastAssistantIndex >= 0) {
      setExpandedMessages(prev => {
        const updated = { ...prev };
        // Collapse all previous assistant messages that have tool calls/results
        // Only the final assistant message should remain expanded
        messages.forEach((m, i) => {
          if (i < lastAssistantIndex && m.role === 'assistant' &&
              ((m.toolCalls?.length ?? 0) > 0 || (m.toolResults?.length ?? 0) > 0)) {
            updated[i] = false;
          }
        });
        // Expand the last assistant message
        updated[lastAssistantIndex] = true;
        return updated;
      });
    }
  }, [messages]);

  const [willCancel, setWillCancel] = useState(false);
  const startYRef = useRef<number | null>(null);

  const nativeSRUnavailableShownRef = useRef(false);

  const webRecognitionRef = useRef<any>(null);
  const webFinalRef = useRef<string>('');
  const liveTranscriptRef = useRef<string>('');
  const willCancelRef = useRef<boolean>(false);
  useEffect(() => { liveTranscriptRef.current = liveTranscript; }, [liveTranscript]);
  useEffect(() => { willCancelRef.current = willCancel; }, [willCancel]);
	const setLiveTranscriptValue = useCallback((t: string) => {
		liveTranscriptRef.current = t;
		setLiveTranscript(t);
	}, []);

	// Merge accumulated final transcript with the latest live transcript.
	// This avoids "cut off" endings when the recognizer ends before producing a final segment,
	// and also helps dedupe overlaps when multiple callbacks fire.
	const normalizeVoiceText = (t?: string) => (t || '').replace(/\s+/g, ' ').trim();
	const mergeVoiceText = (base?: string, live?: string) => {
		const a = normalizeVoiceText(base);
		const b = normalizeVoiceText(live);
		if (!a) return b;
		if (!b) return a;
		if (a === b) return a;
		if (b.startsWith(a)) return b;
		if (a.startsWith(b)) return a;
		if (a.includes(b)) return a;
		if (b.includes(a)) return b;
		const aWords = a.split(' ');
		const bWords = b.split(' ');
		const maxOverlap = Math.min(aWords.length, bWords.length);
		for (let k = maxOverlap; k > 0; k--) {
			const aSuffix = aWords.slice(-k).join(' ');
			const bPrefix = bWords.slice(0, k).join(' ');
			if (aSuffix === bPrefix) {
				const prefix = aWords.slice(0, aWords.length - k).join(' ');
				return normalizeVoiceText(`${prefix} ${b}`);
			}
		}
		return normalizeVoiceText(`${a} ${b}`);
	};

	// Used to dedupe push-to-talk finalization when speech engines (or subscriptions)
	// emit multiple 'end' events for the same gesture.
	const voiceGestureIdRef = useRef(0);
	const voiceGestureFinalizedIdRef = useRef(0);

  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const lastGrantTimeRef = useRef(0);
  const minHoldMs = 200;

  const userReleasedButtonRef = useRef(false);

  const handsFreeDebounceMs = 1500;
  const handsFreeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHandsFreeFinalRef = useRef<string>('');

  const srEmitterRef = useRef<any>(null);
  const srSubsRef = useRef<any[]>([]);
  const nativeFinalRef = useRef<string>('');
  const cleanupNativeSubs = () => {
    srSubsRef.current.forEach((sub) => sub?.remove?.());
    srSubsRef.current = [];
  };
  useEffect(() => {
    return () => {
      cleanupNativeSubs();
      if (handsFreeDebounceRef.current) {
        clearTimeout(handsFreeDebounceRef.current);
      }
    };
  }, []);


  const convoRef = useRef<string | undefined>(undefined);

  const convertProgressToMessages = useCallback((update: AgentProgressUpdate): ChatMessage[] => {
    const messages: ChatMessage[] = [];
    console.log('[convertProgressToMessages] Processing update, steps:', update.steps?.length || 0, 'history:', update.conversationHistory?.length || 0, 'isComplete:', update.isComplete);

    if (update.steps && update.steps.length > 0) {
      let currentToolCalls: any[] = [];
      let currentToolResults: any[] = [];
      let thinkingContent = '';

      for (const step of update.steps) {
        const stepContent = step.content || step.llmContent;
        if (step.type === 'thinking' && stepContent) {
          thinkingContent = stepContent;
        } else if (step.type === 'tool_call') {
          if (step.toolCall) {
            currentToolCalls.push(step.toolCall);
          }
          if (step.toolResult) {
            currentToolResults.push(step.toolResult);
          }
        } else if (step.type === 'tool_result' && step.toolResult) {
          currentToolResults.push(step.toolResult);
        } else if (step.type === 'completion' && stepContent) {
          thinkingContent = stepContent;
        }
      }

      if (currentToolCalls.length > 0 || currentToolResults.length > 0 || thinkingContent) {
        messages.push({
          role: 'assistant',
          content: thinkingContent || (currentToolCalls.length > 0 ? 'Executing tools...' : ''),
          toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
          toolResults: currentToolResults.length > 0 ? currentToolResults : undefined,
        });
      }
    }

    if (update.conversationHistory && update.conversationHistory.length > 0) {
      let currentTurnStartIndex = 0;
      for (let i = 0; i < update.conversationHistory.length; i++) {
        if (update.conversationHistory[i].role === 'user') {
          currentTurnStartIndex = i;
        }
      }

      const hasAssistantMessages = currentTurnStartIndex + 1 < update.conversationHistory.length;
      if (hasAssistantMessages) {
        messages.length = 0;

        for (let i = currentTurnStartIndex + 1; i < update.conversationHistory.length; i++) {
          const historyMsg = update.conversationHistory[i];

          // Merge tool results into the preceding assistant message to avoid duplication
          // The server sends: assistant (with toolCalls) -> tool (with toolResults)
          // We want to display them as a single message with both toolCalls and toolResults
          if (historyMsg.role === 'tool' && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'assistant' && lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
              const hasToolResults = historyMsg.toolResults && historyMsg.toolResults.length > 0;
              const hasContent = historyMsg.content && historyMsg.content.trim().length > 0;

              if (hasToolResults) {
                // Merge toolResults into the existing assistant message
                lastMessage.toolResults = [
                  ...(lastMessage.toolResults || []),
                  ...(historyMsg.toolResults || []),
                ];
                // Also preserve any content from the tool message (e.g., error messages)
                if (hasContent) {
                  lastMessage.content = (lastMessage.content || '') +
                    (lastMessage.content ? '\n' : '') + historyMsg.content;
                }
                // Skip adding this as a separate message only when we merged results
                continue;
              }
              // If tool message has content but no toolResults, fall through to add it as a message
            }
          }

          messages.push({
            role: historyMsg.role === 'tool' ? 'assistant' : historyMsg.role,
            content: historyMsg.content || '',
            toolCalls: historyMsg.toolCalls,
            toolResults: historyMsg.toolResults,
          });
        }
      }
    }

    if (update.streamingContent?.text) {
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        messages[messages.length - 1].content = update.streamingContent.text;
      } else {
        messages.push({
          role: 'assistant',
          content: update.streamingContent.text,
        });
      }
    }

    return messages;
  }, []);

  // Get the current conversation ID for queue operations
  const currentConversationId = sessionStore.currentSessionId || 'default';

  // Get queued messages for the current conversation
  const queuedMessages = messageQueue.getQueue(currentConversationId);

  const send = async (text: string) => {
    if (!text.trim()) return;

    // If message queue is enabled and we're already responding, queue the message
    if (messageQueueEnabled && responding) {
      console.log('[ChatScreen] Agent busy, queuing message:', text);
      messageQueue.enqueue(currentConversationId, text);
      setInput('');
      return;
    }

    console.log('[ChatScreen] Sending message:', text);

    // Get client from connection manager (preserves connections across session switches)
    const client = getSessionClient();
    if (!client) {
      console.error('[ChatScreen] No client available for send');
      setDebugInfo('Error: No session available');
      return;
    }

    setDebugInfo(`Starting request to ${config.baseUrl}...`);
    // Clear any previous failed message when starting a new send
    setLastFailedMessage(null);

    const userMsg: ChatMessage = { role: 'user', content: text };
    const messageCountBeforeTurn = messages.length;
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: 'Assistant is thinking...' }]);
    setResponding(true);

    // Generate a unique request ID for this request
    // This prevents cross-request race conditions on view-level state
    const thisRequestId = Date.now();
    // Note: We keep activeRequestIdRef for backward compatibility and view-level state,
    // but the primary "superseded" check now uses per-session tracking (PR review fix #13)
    activeRequestIdRef.current = thisRequestId;

    const currentSession = sessionStore.getCurrentSession();
    const serverConversationId = currentSession?.serverConversationId;

    console.log('[ChatScreen] Session info:', {
      sessionId: currentSession?.id,
      serverConversationId: serverConversationId || 'new',
      requestId: thisRequestId
    });

    setInput('');

    // Capture the session ID at request start to guard against session changes
    const requestSessionId = sessionStore.currentSessionId;

    // Mark this request as the latest for this session in the connection manager
    // and increment active request count
    // This enables per-session request tracking to prevent cross-session superseding (PR review fix #13)
    if (requestSessionId) {
      connectionManager.setLatestRequestId(requestSessionId, thisRequestId);
      connectionManager.incrementActiveRequests(requestSessionId);
    }

    try {
      let streamingText = '';

      const serverConversationId = sessionStore.getServerConversationId();
      console.log('[ChatScreen] Starting chat request with', messages.length + 1, 'messages, conversationId:', serverConversationId || 'new');
      setDebugInfo('Request sent, waiting for response...');

      const onProgress = (update: AgentProgressUpdate) => {
        // Guard: skip update if session has changed since request started
        // Use currentSessionIdRef.current to avoid stale closure issue (useSessions returns new object each render)
        if (currentSessionIdRef.current !== requestSessionId) {
          console.log('[ChatScreen] Session changed, skipping onProgress update');
          return;
        }
        // Guard: skip update if this request is no longer the latest one for this session
        // Uses per-session tracking to prevent cross-session sends from incorrectly superseding (PR review fix #13)
        if (requestSessionId && connectionManager.getLatestRequestId(requestSessionId) !== thisRequestId) {
          console.log('[ChatScreen] Request superseded within same session, skipping onProgress update');
          return;
        }
        const progressMessages = convertProgressToMessages(update);
        if (progressMessages.length > 0) {
          setMessages((m) => {
            const beforePlaceholder = m.slice(0, messageCountBeforeTurn + 1);
            const newMessages = [...beforePlaceholder, ...progressMessages];
            return newMessages;
          });
        }
      };

      const onToken = (tok: string) => {
        // Guard: skip update if session has changed since request started
        // Use currentSessionIdRef.current to avoid stale closure issue (useSessions returns new object each render)
        if (currentSessionIdRef.current !== requestSessionId) {
          console.log('[ChatScreen] Session changed, skipping onToken update');
          return;
        }
        // Guard: skip update if this request is no longer the latest one for this session
        // Uses per-session tracking to prevent cross-session sends from incorrectly superseding (PR review fix #13)
        if (requestSessionId && connectionManager.getLatestRequestId(requestSessionId) !== thisRequestId) {
          console.log('[ChatScreen] Request superseded within same session, skipping onToken update');
          return;
        }
        // Handle both delta tokens and full-text updates:
        // - Delta tokens: small increments to append (e.g., "Hello", " world")
        // - Full-text updates: complete accumulated text from streamingContent.text
        // Detect full-text updates: if tok starts with or equals streamingText, it's a full replacement.
        // This prevents double-words when progress events send the full accumulated text.
        if (tok.startsWith(streamingText) && tok.length >= streamingText.length) {
          // Full-text update: replace instead of append
          streamingText = tok;
        } else {
          // Delta token: append
          streamingText += tok;
        }

        setMessages((m) => {
          const copy = [...m];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              copy[i] = { ...copy[i], content: streamingText };
              break;
            }
          }
          return copy;
        });
      };

      const response = await client.chat([...messages, userMsg], onToken, onProgress, serverConversationId);
      const finalText = response.content || streamingText;
      console.log('[ChatScreen] Chat completed, conversationId:', response.conversationId);

      // Guard: skip UI updates if session has changed, BUT still persist to the original session
      // Use currentSessionIdRef.current to avoid stale closure issue (useSessions returns new object each render)
      const sessionChanged = currentSessionIdRef.current !== requestSessionId;
      if (sessionChanged) {
        console.log('[ChatScreen] Session changed during request, persisting to original session without UI update');
      } else {
        setDebugInfo(`Completed!`);
      }

      // Guard: skip final updates if this request is no longer the latest one for this session
      // This prevents older, superseded requests from clobbering messages when multiple sends occur within the same session
      // Uses per-session tracking to prevent cross-session sends from incorrectly superseding (PR review fix #13)
      // Note: This guard only applies when session hasn't changed - if session changed, we still want to persist
      const isLatestForSession = requestSessionId
        ? connectionManager.getLatestRequestId(requestSessionId) === thisRequestId
        : true;
      if (!sessionChanged && !isLatestForSession) {
        console.log('[ChatScreen] Request superseded within same session, skipping final message updates', {
          thisRequestId,
          latestRequestId: requestSessionId ? connectionManager.getLatestRequestId(requestSessionId) : 'no-session'
        });
        return;
      }

      // Save conversation ID to the appropriate session
      if (response.conversationId) {
        if (sessionChanged && requestSessionId) {
          await sessionStore.setServerConversationIdForSession(requestSessionId, response.conversationId);
        } else {
          await sessionStore.setServerConversationId(response.conversationId);
        }
      }

      if (response.conversationHistory && response.conversationHistory.length > 0) {
        console.log('[ChatScreen] Processing final conversationHistory:', response.conversationHistory.length, 'messages');
        console.log('[ChatScreen] ConversationHistory roles:', response.conversationHistory.map(m => m.role).join(', '));

        let currentTurnStartIndex = 0;
        for (let i = 0; i < response.conversationHistory.length; i++) {
          if (response.conversationHistory[i].role === 'user') {
            currentTurnStartIndex = i;
          }
        }
        console.log('[ChatScreen] currentTurnStartIndex:', currentTurnStartIndex);

        const newMessages: ChatMessage[] = [];
        for (let i = currentTurnStartIndex; i < response.conversationHistory.length; i++) {
          const historyMsg = response.conversationHistory[i];
          if (historyMsg.role === 'user') continue;

          // Merge tool results into the preceding assistant message to avoid duplication
          // The server sends: assistant (with toolCalls) -> tool (with toolResults)
          // We want to display them as a single message with both toolCalls and toolResults
          if (historyMsg.role === 'tool' && newMessages.length > 0) {
            const lastMessage = newMessages[newMessages.length - 1];
            if (lastMessage.role === 'assistant' && lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
              const hasToolResults = historyMsg.toolResults && historyMsg.toolResults.length > 0;
              const hasContent = historyMsg.content && historyMsg.content.trim().length > 0;

              if (hasToolResults) {
                // Merge toolResults into the existing assistant message
                lastMessage.toolResults = [
                  ...(lastMessage.toolResults || []),
                  ...(historyMsg.toolResults || []),
                ];
                // Also preserve any content from the tool message (e.g., error messages)
                if (hasContent) {
                  lastMessage.content = (lastMessage.content || '') +
                    (lastMessage.content ? '\n' : '') + historyMsg.content;
                }
                // Skip adding this as a separate message only when we merged results
                continue;
              }
              // If tool message has content but no toolResults, fall through to add it as a message
            }
          }

          newMessages.push({
            role: historyMsg.role === 'tool' ? 'assistant' : historyMsg.role,
            content: historyMsg.content || '',
            toolCalls: historyMsg.toolCalls,
            toolResults: historyMsg.toolResults,
          });
        }
        console.log('[ChatScreen] newMessages count:', newMessages.length);
        console.log('[ChatScreen] newMessages roles:', newMessages.map(m => `${m.role}(toolCalls:${m.toolCalls?.length || 0},toolResults:${m.toolResults?.length || 0})`).join(', '));
        console.log('[ChatScreen] messageCountBeforeTurn:', messageCountBeforeTurn);

        if (sessionChanged && requestSessionId) {
          // Only persist to background session if this is still the latest request for that session
          // This prevents an older request from overwriting newer history (PR review fix #14)
          if (isLatestForSession) {
            console.log('[ChatScreen] Persisting completed response to background session:', requestSessionId);
            // Build the final messages array: messages before this turn + user message + new assistant messages
            const messagesBeforeTurn = messages.slice(0, messageCountBeforeTurn);
            const finalMessages = [...messagesBeforeTurn, userMsg, ...newMessages];
            await sessionStore.setMessagesForSession(requestSessionId, finalMessages);
          } else {
            console.log('[ChatScreen] Skipping background persistence - request superseded within session:', {
              thisRequestId,
              latestRequestId: connectionManager.getLatestRequestId(requestSessionId)
            });
          }
        } else {
          // Normal case: update UI state (persistence happens via useEffect)
          setMessages((m) => {
            console.log('[ChatScreen] Current messages before update:', m.length);
            const beforePlaceholder = m.slice(0, messageCountBeforeTurn + 1);
            console.log('[ChatScreen] beforePlaceholder count:', beforePlaceholder.length);
            const result = [...beforePlaceholder, ...newMessages];
            console.log('[ChatScreen] Final messages count:', result.length);
            return result;
          });
        }
      } else if (finalText) {
        console.log('[ChatScreen] FALLBACK: No conversationHistory, using finalText only. response.conversationHistory:', response.conversationHistory);
        if (sessionChanged && requestSessionId) {
          // Only persist to background session if this is still the latest request for that session
          // This prevents an older request from overwriting newer history (PR review fix #14)
          if (isLatestForSession) {
            console.log('[ChatScreen] Persisting fallback response to background session:', requestSessionId);
            const messagesBeforeTurn = messages.slice(0, messageCountBeforeTurn);
            const finalMessages = [...messagesBeforeTurn, userMsg, { role: 'assistant' as const, content: finalText }];
            await sessionStore.setMessagesForSession(requestSessionId, finalMessages);
          } else {
            console.log('[ChatScreen] Skipping fallback background persistence - request superseded within session:', {
              thisRequestId,
              latestRequestId: connectionManager.getLatestRequestId(requestSessionId)
            });
          }
        } else {
          // Normal case: update UI state
          setMessages((m) => {
            const copy = [...m];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === 'assistant') {
                copy[i] = { ...copy[i], content: finalText };
                break;
              }
            }
            return copy;
          });
        }
      } else {
        console.log('[ChatScreen] WARNING: No conversationHistory and no finalText!');
      }

      // Note: Removed duplicate setServerConversationId call that was after the message handling
      // The conversation ID is now saved once at the beginning of this block

      if (!sessionChanged && finalText && config.ttsEnabled !== false) {
        const processedText = preprocessTextForTTS(finalText);
        Speech.speak(processedText, { language: 'en-US' });
      }
    } catch (e: any) {
      console.error('[ChatScreen] Chat error:', e);
      console.error('[ChatScreen] Error details:', {
        message: e.message,
        stack: e.stack,
        name: e.name
      });

      // Guard: skip error message if session has changed since request started
      // Use currentSessionIdRef.current to avoid stale closure issue (useSessions returns new object each render)
      if (currentSessionIdRef.current !== requestSessionId) {
        console.log('[ChatScreen] Session changed during request, skipping error message');
        return;
      }

      // Guard: skip error handling if this request is no longer the active one
      // This prevents a superseded request from surfacing a retry banner for an older send
      if (activeRequestIdRef.current !== thisRequestId) {
        console.log('[ChatScreen] Request superseded, skipping error handling', {
          thisRequestId,
          activeRequestId: activeRequestIdRef.current
        });
        return;
      }

      const recoveryState = connectionState;
      let errorMessage = e.message;

      if (recoveryState?.status === 'failed') {
        errorMessage = `Connection failed after ${recoveryState.retryCount} retries. ${recoveryState.lastError || ''}`;
      } else if (recoveryState?.status === 'reconnecting') {
        errorMessage = `Connection lost. Attempted ${recoveryState.retryCount} reconnections. ${e.message}`;
      }

      // Save the failed message for retry
      setLastFailedMessage(text);

      // Check if there's partial content we can show
      const partialContent = client.getPartialContent();
      const hasPartialContent = partialContent && partialContent.length > 0;

      setDebugInfo(`Error: ${errorMessage}`);
      // Update the in-flight assistant message instead of appending a new one
      // This avoids duplicating the "Assistant is thinking..." message and ensures
      // the retry pop logic removes the correct items
      setMessages((m) => {
        const errorContent = hasPartialContent
          ? `${partialContent}\n\n---\n⚠️ Connection lost. Partial response shown above.\n\nError: ${errorMessage}`
          : `Error: ${errorMessage}\n\nTip: Check your internet connection and tap "Retry" to try again.`;
        // Find and update the last assistant message instead of appending
        const copy = [...m];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === 'assistant') {
            copy[i] = { ...copy[i], content: errorContent };
            break;
          }
        }
        return copy;
      });
    } finally {
      console.log('[ChatScreen] Chat request finished, requestId:', thisRequestId);

      // Decrement active request count in the connection manager
      if (requestSessionId) {
        connectionManager.decrementActiveRequests(requestSessionId);
      }

      // Only reset UI states if:
      // 1. This request is still the latest one for its session (per-session tracking, PR review fix #13)
      // 2. We're still on the same session (prevents background completions from affecting other sessions)
      // This addresses PR review comments #10 and #13
      const isLatestForThisSession = requestSessionId
        ? connectionManager.getLatestRequestId(requestSessionId) === thisRequestId
        : true;
      const isCurrentSession = currentSessionIdRef.current === requestSessionId;

      if (isLatestForThisSession && isCurrentSession) {
        setResponding(false);
        setConnectionState(null);
        // Guard the setTimeout callback: only clear debugInfo if this request
        // is still the latest one when the timeout fires. This prevents an
        // old request's delayed clear from wiping debug info for a newer request.
        const capturedRequestId = thisRequestId;
        const capturedSessionId = requestSessionId;
        setTimeout(() => {
          const stillLatest = capturedSessionId
            ? connectionManager.getLatestRequestId(capturedSessionId) === capturedRequestId
            : true;
          if (stillLatest && currentSessionIdRef.current === capturedSessionId) {
            setDebugInfo('');
          }
        }, 5000);

        // Process next queued message if any
        if (messageQueueEnabled) {
          const nextMessage = messageQueue.peek(currentConversationId);
          if (nextMessage) {
            console.log('[ChatScreen] Processing next queued message:', nextMessage.id);
            messageQueue.markProcessing(currentConversationId, nextMessage.id);
            // Use setTimeout to avoid recursive call stack issues
            setTimeout(() => {
              processQueuedMessage(nextMessage);
            }, 100);
          }
        }
      } else {
        console.log('[ChatScreen] Skipping finally state resets:', {
          thisRequestId,
          latestRequestId: requestSessionId ? connectionManager.getLatestRequestId(requestSessionId) : 'no-session',
          requestSessionId,
          currentSessionId: currentSessionIdRef.current,
          reason: !isLatestForThisSession ? 'newer request is active for this session' : 'session changed'
        });
      }
    }
  };

  // Process a queued message (similar to send but handles queue state)
  const processQueuedMessage = async (queuedMsg: { id: string; text: string }) => {
    const text = queuedMsg.text;
    if (!text.trim()) {
      messageQueue.markProcessed(currentConversationId, queuedMsg.id);
      return;
    }

    console.log('[ChatScreen] Processing queued message:', queuedMsg.id, text);

    // Get client from connection manager (preserves connections across session switches)
    const client = getSessionClient();
    if (!client) {
      console.error('[ChatScreen] No client available for processing queued message');
      messageQueue.markFailed(currentConversationId, queuedMsg.id, 'No session available');
      setDebugInfo('Error: No session available');
      return;
    }

    setDebugInfo(`Processing queued message...`);

    const userMsg: ChatMessage = { role: 'user', content: text };
    // Use ref to get latest messages to avoid stale closure when called via setTimeout (PR review fix)
    const currentMessages = messagesRef.current;
    const messageCountBeforeTurn = currentMessages.length;
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: 'Assistant is thinking...' }]);
    setResponding(true);

    const thisRequestId = Date.now();
    activeRequestIdRef.current = thisRequestId;

    const currentSession = sessionStore.getCurrentSession();
    const serverConversationId = currentSession?.serverConversationId;

    const requestSessionId = sessionStore.currentSessionId;

    try {
      let streamingText = '';

      const onProgress = (update: AgentProgressUpdate) => {
        if (sessionStore.currentSessionId !== requestSessionId) return;
        if (activeRequestIdRef.current !== thisRequestId) return;
        const progressMessages = convertProgressToMessages(update);
        if (progressMessages.length > 0) {
          setMessages((m) => {
            const beforePlaceholder = m.slice(0, messageCountBeforeTurn + 1);
            return [...beforePlaceholder, ...progressMessages];
          });
        }
      };

      const onToken = (tok: string) => {
        if (sessionStore.currentSessionId !== requestSessionId) return;
        if (activeRequestIdRef.current !== thisRequestId) return;
        // Handle both delta tokens and full-text updates:
        // - Delta tokens: small increments to append (e.g., "Hello", " world")
        // - Full-text updates: complete accumulated text from streamingContent.text
        // Detect full-text updates: if tok starts with or equals streamingText, it's a full replacement.
        // This prevents double-words when progress events send the full accumulated text.
        if (tok.startsWith(streamingText) && tok.length >= streamingText.length) {
          // Full-text update: replace instead of append
          streamingText = tok;
        } else {
          // Delta token: append
          streamingText += tok;
        }
        setMessages((m) => {
          const copy = [...m];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              copy[i] = { ...copy[i], content: streamingText };
              break;
            }
          }
          return copy;
        });
      };

      const response = await client.chat([...currentMessages, userMsg], onToken, onProgress, serverConversationId);
      const finalText = response.content || streamingText;

      // Early exit guards - finalize queue status before returning to prevent stuck 'processing' items
      if (sessionStore.currentSessionId !== requestSessionId) {
        // Session changed - mark as failed so user can retry in correct session
        messageQueue.markFailed(currentConversationId, queuedMsg.id, 'Session changed during processing');
        return;
      }
      if (activeRequestIdRef.current !== thisRequestId) {
        // Request superseded - mark as failed so user can retry
        messageQueue.markFailed(currentConversationId, queuedMsg.id, 'Request superseded');
        return;
      }

      if (response.conversationId) {
        await sessionStore.setServerConversationId(response.conversationId);
      }

      if (response.conversationHistory && response.conversationHistory.length > 0) {
        let currentTurnStartIndex = 0;
        for (let i = 0; i < response.conversationHistory.length; i++) {
          if (response.conversationHistory[i].role === 'user') {
            currentTurnStartIndex = i;
          }
        }

        const newMessages: ChatMessage[] = [];
        for (let i = currentTurnStartIndex; i < response.conversationHistory.length; i++) {
          const historyMsg = response.conversationHistory[i];
          if (historyMsg.role === 'user') continue;
          newMessages.push({
            role: historyMsg.role === 'tool' ? 'assistant' : historyMsg.role,
            content: historyMsg.content || '',
            toolCalls: historyMsg.toolCalls,
            toolResults: historyMsg.toolResults,
          });
        }

        setMessages((m) => {
          const beforePlaceholder = m.slice(0, messageCountBeforeTurn + 1);
          return [...beforePlaceholder, ...newMessages];
        });
      } else if (finalText) {
        setMessages((m) => {
          const copy = [...m];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              copy[i] = { ...copy[i], content: finalText };
              break;
            }
          }
          return copy;
        });
      }

      if (finalText && config.ttsEnabled !== false) {
        const processedText = preprocessTextForTTS(finalText);
        Speech.speak(processedText, { language: 'en-US' });
      }

      // Mark as processed on success
      messageQueue.markProcessed(currentConversationId, queuedMsg.id);
    } catch (e: any) {
      console.error('[ChatScreen] Queued message error:', e);
      messageQueue.markFailed(currentConversationId, queuedMsg.id, e.message || 'Unknown error');
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      if (activeRequestIdRef.current === thisRequestId) {
        setResponding(false);
        setConnectionState(null);
        setTimeout(() => {
          if (activeRequestIdRef.current === thisRequestId) {
            setDebugInfo('');
          }
        }, 5000);

        // Process next queued message if any
        const nextMessage = messageQueue.peek(currentConversationId);
        if (nextMessage) {
          console.log('[ChatScreen] Processing next queued message:', nextMessage.id);
          messageQueue.markProcessing(currentConversationId, nextMessage.id);
          setTimeout(() => {
            processQueuedMessage(nextMessage);
          }, 100);
        }
      }
    }
  };

	// Keep sendRef in sync with the latest send() implementation for speech callbacks.
	// IMPORTANT: This must live outside send() so voice callbacks can send even before any manual send() occurs.
	// We intentionally assign during render (not useEffect) so it is available immediately.
	sendRef.current = send;

  // Track modifier keys for keyboard shortcut handling
  const modifierKeysRef = useRef<{ shift: boolean; ctrl: boolean; meta: boolean }>({
    shift: false,
    ctrl: false,
    meta: false,
  });

  // Timeout ref for auto-resetting modifier state
  // This prevents "sticky" modifier state when a modifier is pressed then released before Enter
  const modifierTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flag to suppress the next onChangeText update after native keyboard shortcut submission
  // This prevents stray newlines from being added when Enter is pressed with a modifier
  const suppressNextChangeRef = useRef(false);

  // Handle keyboard shortcuts for text submission
  // Shift+Enter or Ctrl/Cmd+Enter to submit
  const handleInputKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;

      // On web platform, we have access to modifier keys via nativeEvent
      if (Platform.OS === 'web') {
        const webEvent = e.nativeEvent as unknown as KeyboardEvent;
        const isEnter = key === 'Enter';
        const hasModifier = webEvent.shiftKey || webEvent.ctrlKey || webEvent.metaKey;

        if (isEnter && hasModifier) {
          // Prevent default on both the synthetic event and the underlying keyboard event
          // to ensure the newline is not inserted after send() clears the input
          e.preventDefault?.();
          webEvent.preventDefault?.();
          if (input.trim()) {
            send(input);
          }
        }
      } else {
        // On native platforms, track modifier key state
        // Note: onKeyPress doesn't provide key-up events, so we use a timeout to auto-reset
        // modifier state. This prevents "sticky" modifiers where pressing Shift then releasing
        // it (without pressing another key) could cause a subsequent plain Enter to submit.
        const setModifierWithTimeout = (modifier: 'shift' | 'ctrl' | 'meta') => {
          modifierKeysRef.current[modifier] = true;
          // Clear any existing timeout
          if (modifierTimeoutRef.current) {
            clearTimeout(modifierTimeoutRef.current);
          }
          // Auto-reset modifier state after 500ms if no Enter is pressed
          // This matches the typical key repeat delay and prevents stickiness
          modifierTimeoutRef.current = setTimeout(() => {
            modifierKeysRef.current = { shift: false, ctrl: false, meta: false };
          }, 500);
        };

        if (key === 'Shift') {
          setModifierWithTimeout('shift');
        } else if (key === 'Control') {
          setModifierWithTimeout('ctrl');
        } else if (key === 'Meta') {
          setModifierWithTimeout('meta');
        } else if (key === 'Enter') {
          // Clear the timeout since we're processing the Enter now
          if (modifierTimeoutRef.current) {
            clearTimeout(modifierTimeoutRef.current);
            modifierTimeoutRef.current = null;
          }
          const hasModifier =
            modifierKeysRef.current.shift ||
            modifierKeysRef.current.ctrl ||
            modifierKeysRef.current.meta;

          if (hasModifier) {
            // Always suppress the newline that will be inserted by the native TextInput
            // when modifier+Enter is pressed, even if input is empty (matches web behavior)
            suppressNextChangeRef.current = true;
            if (input.trim()) {
              send(input);
            }
          }
          // Reset modifier state after Enter is processed
          modifierKeysRef.current = { shift: false, ctrl: false, meta: false };
        } else {
          // Reset modifier state on any other key
          if (modifierTimeoutRef.current) {
            clearTimeout(modifierTimeoutRef.current);
            modifierTimeoutRef.current = null;
          }
          modifierKeysRef.current = { shift: false, ctrl: false, meta: false };
        }
      }
    },
    [input, send]
  );

  // Wrapper for onChangeText that suppresses stray newlines after native keyboard shortcut submission
  const handleInputChange = useCallback((text: string) => {
    if (suppressNextChangeRef.current) {
      // Reset the flag and ignore this update (it's likely a stray newline from Enter)
      suppressNextChangeRef.current = false;
      return;
    }
    setInput(text);
  }, []);

  const ensureWebRecognizer = () => {
    if (Platform.OS !== 'web') return false;
    // @ts-ignore
    const SRClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SRClass) {
			voiceLog('ensureWebRecognizer: Web Speech API not available');
      console.warn('[Voice] Web Speech API not available (use Chrome/Edge over HTTPS).');
      return false;
    }
    if (!webRecognitionRef.current) {
			voiceLog('ensureWebRecognizer: creating web recognizer');
      const rec = new SRClass();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = true;
			rec.onstart = () => {
				voiceLog('web:onstart', {
					gestureId: voiceGestureIdRef.current,
					handsFree: handsFreeRef.current,
					userReleased: userReleasedButtonRef.current,
				});
			};
      rec.onerror = (ev: any) => {
				voiceLog('web:onerror', { error: ev?.error || ev });
        console.error('[Voice] Web recognition error:', ev?.error || ev);
      };
      rec.onresult = (ev: any) => {
        let interim = '';
        let finalText = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          const txt = res[0]?.transcript || '';
          if (res.isFinal) finalText += txt;
          else interim += txt;
        }
				voiceLog('web:onresult', {
					gestureId: voiceGestureIdRef.current,
					resultIndex: ev?.resultIndex,
					resultsLength: ev?.results?.length,
					interim: interim?.trim(),
					final: finalText?.trim(),
					handsFree: handsFreeRef.current,
				});
	        if (interim) setLiveTranscriptValue(interim);
        if (finalText) {
          if (handsFreeRef.current) {
            if (handsFreeDebounceRef.current) {
              clearTimeout(handsFreeDebounceRef.current);
            }
            const final = finalText.trim();
            if (final) {
              pendingHandsFreeFinalRef.current = pendingHandsFreeFinalRef.current
                ? `${pendingHandsFreeFinalRef.current} ${final}`
                : final;
              handsFreeDebounceRef.current = setTimeout(() => {
                const toSend = pendingHandsFreeFinalRef.current.trim();
                pendingHandsFreeFinalRef.current = '';
                webFinalRef.current = '';
	                setLiveTranscriptValue('');
	                if (toSend) void sendRef.current(toSend);
              }, handsFreeDebounceMs);
            }
          } else {
            webFinalRef.current += finalText;
          }
        }
      };
      rec.onend = () => {
				voiceLog('web:onend', {
					gestureId: voiceGestureIdRef.current,
					finalizedGestureId: voiceGestureFinalizedIdRef.current,
					handsFree: handsFreeRef.current,
					userReleased: userReleasedButtonRef.current,
					pendingHandsFreeFinal: pendingHandsFreeFinalRef.current,
					webFinal: webFinalRef.current,
					live: liveTranscriptRef.current,
				});
        if (handsFreeDebounceRef.current) {
          clearTimeout(handsFreeDebounceRef.current);
          handsFreeDebounceRef.current = null;
        }

        if (!handsFreeRef.current && !userReleasedButtonRef.current && webRecognitionRef.current) {
					voiceLog('web:onend -> attempting restart (user still holding)');
          try {
            webRecognitionRef.current.start();
						voiceLog('web:onend -> restart succeeded');
            return;
          } catch (restartErr) {
						voiceLog('web:onend -> restart failed', restartErr);
            console.warn('[Voice] Failed to restart web recognition after voice break:', restartErr);
	            setListeningValue(false);
	            // Capture liveTranscriptRef.current BEFORE clearing it, since setLiveTranscriptValue
	            // updates the ref synchronously and would cause mergeVoiceText to use stale value
	            const accumulatedText = mergeVoiceText(webFinalRef.current, liveTranscriptRef.current);
	            setLiveTranscriptValue('');
            if (accumulatedText) {
              setInput((t) => (t ? `${t} ${accumulatedText}` : accumulatedText));
            }
	            // Treat as finalized for this push-to-talk gesture to prevent duplicate sends.
	            voiceGestureFinalizedIdRef.current = voiceGestureIdRef.current;
            webFinalRef.current = '';
            pendingHandsFreeFinalRef.current = '';
            return;
          }
        }
			const gestureId = voiceGestureIdRef.current;
			const alreadyFinalizedPushToTalk = !handsFreeRef.current && voiceGestureFinalizedIdRef.current === gestureId;

	        const finalText = mergeVoiceText(
	          pendingHandsFreeFinalRef.current || webFinalRef.current,
	          liveTranscriptRef.current
	        );
				voiceLog('web:onend -> finalize', {
					gestureId,
					alreadyFinalizedPushToTalk,
					willEdit: willCancelRef.current,
					finalText,
				});
        pendingHandsFreeFinalRef.current = '';
	        setListeningValue(false);
	        setLiveTranscriptValue('');
        const willEdit = willCancelRef.current;
	        if (!handsFreeRef.current && finalText && !alreadyFinalizedPushToTalk) {
	          voiceGestureFinalizedIdRef.current = gestureId;
					if (willEdit) {
						voiceLog('web:onend -> willEdit=true (append to input)', { gestureId, finalText });
						setInput((t) => (t ? `${t} ${finalText}` : finalText));
					} else {
						voiceLog('web:onend -> sending', { gestureId, finalText });
						void sendRef.current(finalText);
					}
        } else if (handsFreeRef.current && finalText) {
					voiceLog('web:onend -> handsFree send', { gestureId, finalText });
	          void sendRef.current(finalText);
        }
        webFinalRef.current = '';
      };
      webRecognitionRef.current = rec;
    }
    return true;
  };

  const startRecording = async (e?: GestureResponderEvent) => {
			voiceLog('startRecording called', {
				starting: startingRef.current,
				listening: listeningRef.current,
				handsFree: handsFreeRef.current,
				platform: Platform.OS,
			});
			if (startingRef.current || listeningRef.current) {
				voiceLog('startRecording early return (already starting/listening)');
      return;
    }
    startingRef.current = true;
    try {
	      // New push-to-talk gesture/session.
	      voiceGestureIdRef.current += 1;
			voiceLog('startRecording init', {
				gestureId: voiceGestureIdRef.current,
				handsFree: handsFreeRef.current,
			});
      setWillCancel(false);
	      setLiveTranscriptValue('');
	      setListeningValue(true);
      nativeFinalRef.current = '';
	      webFinalRef.current = '';
      pendingHandsFreeFinalRef.current = '';
      userReleasedButtonRef.current = false;
      if (handsFreeDebounceRef.current) {
        clearTimeout(handsFreeDebounceRef.current);
        handsFreeDebounceRef.current = null;
      }
      if (e) startYRef.current = e.nativeEvent.pageY;

      if (Platform.OS !== 'web') {
        try {
          const SR: any = await import('expo-speech-recognition');
          if (SR?.ExpoSpeechRecognitionModule?.start) {
						voiceLog('native: module available, wiring listeners');
            if (!srEmitterRef.current) {
              srEmitterRef.current = new EventEmitter(SR.ExpoSpeechRecognitionModule);
            }
            cleanupNativeSubs();
						voiceLog('native: listeners cleaned', { count: srSubsRef.current.length });
            const subResult = srEmitterRef.current.addListener('result', (event: any) => {
              const t = event?.results?.[0]?.transcript ?? event?.text ?? event?.transcript ?? '';
							voiceLog('native:result', {
								gestureId: voiceGestureIdRef.current,
								isFinal: event?.isFinal,
								transcript: t,
							});
	                  if (t) setLiveTranscriptValue(t);
              if (event?.isFinal && t) {
                if (handsFreeRef.current) {
                  if (handsFreeDebounceRef.current) {
                    clearTimeout(handsFreeDebounceRef.current);
                  }
                  const final = t.trim();
                  if (final) {
                    pendingHandsFreeFinalRef.current = pendingHandsFreeFinalRef.current
                      ? `${pendingHandsFreeFinalRef.current} ${final}`
                      : final;
                    handsFreeDebounceRef.current = setTimeout(() => {
                      const toSend = pendingHandsFreeFinalRef.current.trim();
                      pendingHandsFreeFinalRef.current = '';
                      nativeFinalRef.current = '';
	                          setLiveTranscriptValue('');
	                          if (toSend) void sendRef.current(toSend);
                    }, handsFreeDebounceMs);
                  }
                } else {
                  nativeFinalRef.current = nativeFinalRef.current
                    ? `${nativeFinalRef.current} ${t}`
                    : t;
                }
              }
            });
            const subError = srEmitterRef.current.addListener('error', (event: any) => {
							voiceLog('native:error', event);
              console.error('[Voice] Native recognition error:', JSON.stringify(event));
            });
            const subEnd = srEmitterRef.current.addListener('end', async () => {
							voiceLog('native:end', {
								gestureId: voiceGestureIdRef.current,
								finalizedGestureId: voiceGestureFinalizedIdRef.current,
								handsFree: handsFreeRef.current,
								userReleased: userReleasedButtonRef.current,
								pendingHandsFreeFinal: pendingHandsFreeFinalRef.current,
								nativeFinal: nativeFinalRef.current,
								live: liveTranscriptRef.current,
							});
              if (handsFreeDebounceRef.current) {
                clearTimeout(handsFreeDebounceRef.current);
                handsFreeDebounceRef.current = null;
              }

              if (!handsFreeRef.current && !userReleasedButtonRef.current) {
								voiceLog('native:end -> attempting restart (user still holding)');
                try {
                  const SR: any = await import('expo-speech-recognition');
                  if (SR?.ExpoSpeechRecognitionModule?.start) {
                    SR.ExpoSpeechRecognitionModule.start({
                      lang: 'en-US',
                      interimResults: true,
                      continuous: true,
                      volumeChangeEventOptions: { enabled: false, intervalMillis: 250 }
                    });
										voiceLog('native:end -> restart succeeded');
                    return;
                  }
                } catch (restartErr) {
									voiceLog('native:end -> restart failed', restartErr);
                  console.warn('[Voice] Failed to restart recognition after voice break:', restartErr);
	                  setListeningValue(false);
	                  // Capture liveTranscriptRef.current BEFORE clearing it, since setLiveTranscriptValue
	                  // updates the ref synchronously and would cause mergeVoiceText to use stale value
	                  const accumulatedText = mergeVoiceText(nativeFinalRef.current, liveTranscriptRef.current);
	                  setLiveTranscriptValue('');
                  if (accumulatedText) {
                    setInput((t) => (t ? `${t} ${accumulatedText}` : accumulatedText));
                  }
	                  // Treat as finalized for this push-to-talk gesture to prevent duplicate sends.
	                  voiceGestureFinalizedIdRef.current = voiceGestureIdRef.current;
                  nativeFinalRef.current = '';
                  pendingHandsFreeFinalRef.current = '';
                  return;
                }
              }
					const gestureId = voiceGestureIdRef.current;
					const alreadyFinalizedPushToTalk = !handsFreeRef.current && voiceGestureFinalizedIdRef.current === gestureId;

	              setListeningValue(false);
	              const finalText = mergeVoiceText(
	                pendingHandsFreeFinalRef.current || nativeFinalRef.current,
	                liveTranscriptRef.current
	              );
							voiceLog('native:end -> finalize', {
								gestureId,
								alreadyFinalizedPushToTalk,
								willEdit: willCancelRef.current,
								finalText,
							});
              pendingHandsFreeFinalRef.current = '';
	              setLiveTranscriptValue('');
              const willEdit = willCancelRef.current;
	              if (!handsFreeRef.current && finalText && !alreadyFinalizedPushToTalk) {
	                voiceGestureFinalizedIdRef.current = gestureId;
								if (willEdit) {
									voiceLog('native:end -> willEdit=true (append to input)', { gestureId, finalText });
									setInput((t) => (t ? `${t} ${finalText}` : finalText));
								} else {
									voiceLog('native:end -> sending', { gestureId, finalText });
									void sendRef.current(finalText);
								}
              } else if (handsFreeRef.current && finalText) {
								voiceLog('native:end -> handsFree send', { gestureId, finalText });
	                void sendRef.current(finalText);
              }
              nativeFinalRef.current = '';
            });
            srSubsRef.current.push(subResult, subError, subEnd);

            try {
              const perm = await SR.ExpoSpeechRecognitionModule.getPermissionsAsync();
							voiceLog('native: getPermissionsAsync', perm);
              if (!perm?.granted) {
                const req = await SR.ExpoSpeechRecognitionModule.requestPermissionsAsync();
								voiceLog('native: requestPermissionsAsync', req);
                if (!req?.granted) {
                  console.warn('[Voice] microphone/speech permission not granted; aborting');
	                  setListeningValue(false);
                  startingRef.current = false;
                  return;
                }
              }
            } catch (perr) {
              console.error('[Voice] Permission check/request failed:', perr);
            }

            try {
							voiceLog('native: start()', {
								gestureId: voiceGestureIdRef.current,
								handsFree: handsFreeRef.current,
							});
              SR.ExpoSpeechRecognitionModule.start({
                lang: 'en-US',
                interimResults: true,
                continuous: true,
                volumeChangeEventOptions: { enabled: handsFreeRef.current, intervalMillis: 250 }
              });
            } catch (serr) {
              console.error('[Voice] Native start error:', serr);
	              setListeningValue(false);
            }
            startingRef.current = false;
            return;
          }
        } catch (err) {
          const errorMsg = (err as any)?.message || String(err);
					voiceLog('native: import/start failed', { errorMsg });
          console.warn('[Voice] Native SR unavailable (likely Expo Go):', errorMsg);

          if (!nativeSRUnavailableShownRef.current && errorMsg.includes('ExpoSpeechRecognition')) {
            nativeSRUnavailableShownRef.current = true;
	            setListeningValue(false);
            startingRef.current = false;
            Alert.alert(
              'Development Build Required',
              'Speech recognition requires a development build. Expo Go does not support native modules like expo-speech-recognition.\n\nRun "npx expo run:android" or "npx expo run:ios" to build and install the development app.',
              [{ text: 'OK' }]
            );
            return;
          }
        }
      }

      if (ensureWebRecognizer()) {
        try {
				voiceLog('web: start()', { gestureId: voiceGestureIdRef.current, handsFree: handsFreeRef.current });
          webFinalRef.current = '';
          pendingHandsFreeFinalRef.current = '';
          if (webRecognitionRef.current) {
            try { webRecognitionRef.current.continuous = true; } catch {}
          }
          webRecognitionRef.current?.start();
          startingRef.current = false;
        } catch (err) {
				voiceLog('web: start() failed', err);
          console.error('[Voice] Web start error:', err);
	          setListeningValue(false);
          startingRef.current = false;
        }
      } else {
	        setListeningValue(false);
        startingRef.current = false;
      }
    } catch (err) {
      console.error('[Voice] startRecording error:', err);
	      setListeningValue(false);
      startingRef.current = false;
    }
  };

  const stopRecordingAndHandle = async () => {
    if (stoppingRef.current) {
			voiceLog('stopRecordingAndHandle early return (already stopping)');
      return;
    }
    stoppingRef.current = true;
    userReleasedButtonRef.current = true;
		voiceLog('stopRecordingAndHandle called', {
			gestureId: voiceGestureIdRef.current,
			listening: listeningRef.current,
			handsFree: handsFreeRef.current,
			platform: Platform.OS,
		});
    try {
      const hasWeb = Platform.OS === 'web' && webRecognitionRef.current;
	      if (!listeningRef.current && !hasWeb) {
				voiceLog('stopRecordingAndHandle: nothing to stop (not listening and no web recognizer)');
        return;
      }

      if (Platform.OS !== 'web') {
        try {
          const SR: any = await import('expo-speech-recognition');
          if (SR?.ExpoSpeechRecognitionModule?.stop) {
						voiceLog('native: stop()');
            SR.ExpoSpeechRecognitionModule.stop();
          }
        } catch (err) {
          console.warn('[Voice] Native stop unavailable (likely Expo Go):', (err as any)?.message || err);
        }
      }

      if (Platform.OS === 'web' && webRecognitionRef.current) {
        try {
					voiceLog('web: stop()');
          webRecognitionRef.current.stop();
        } catch (err) {
          console.error('[Voice] Web stop error:', err);
	          setListeningValue(false);
        }
      }
    } catch (err) {
      console.error('[Voice] stopRecording error:', err);
	      setListeningValue(false);
    } finally {
      startYRef.current = null;
      setWillCancel(false);
      stoppingRef.current = false;
			voiceLog('stopRecordingAndHandle finished', {
				gestureId: voiceGestureIdRef.current,
				listening: listeningRef.current,
			});
    }
  };


  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
    >
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          style={{ flex: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: theme.colors.background }}
          contentContainerStyle={{ paddingBottom: insets.bottom, gap: spacing.xs }}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          scrollEventThrottle={16}
        >
          {messages.map((m, i) => {
            const shouldCollapse = shouldCollapseMessage(m.content, m.toolCalls, m.toolResults);
            // expandedMessages is auto-updated via useEffect to expand the last assistant message
            // and persist the expansion state so it doesn't collapse when new messages arrive
            const isExpanded = expandedMessages[i] ?? false;

            const toolCallCount = m.toolCalls?.length ?? 0;
            const toolResultCount = m.toolResults?.length ?? 0;
            const hasToolResults = toolResultCount > 0;
            const allSuccess = hasToolResults && m.toolResults!.every(r => r.success);
            const hasErrors = hasToolResults && m.toolResults!.some(r => !r.success);
            // isPending is true when there are more tool calls than results (including partial completion)
            const isPending = toolCallCount > 0 && toolCallCount > toolResultCount;

            return (
              <View
                key={i}
                style={[
                  styles.msg,
                  m.role === 'user' ? styles.user : styles.assistant,
                ]}
              >
                {/* Compact message header - no role labels, just tap to expand */}
                {shouldCollapse && (
                  <Pressable
                    onPress={() => toggleMessageExpansion(i)}
                    accessibilityRole="button"
                    accessibilityHint={isExpanded ? 'Collapse message' : 'Expand message'}
                    accessibilityState={{ expanded: isExpanded }}
                    style={({ pressed }) => [
                      styles.messageHeader,
                      styles.messageHeaderClickable,
                      pressed && styles.messageHeaderPressed,
                    ]}
                  >
                    <View style={styles.expandButton}>
                      <Text style={styles.expandButtonText}>
                        {isExpanded ? '▲' : '▼'}
                      </Text>
                    </View>
                  </Pressable>
                )}

                {m.role === 'assistant' && (!m.content || m.content.length === 0) && !m.toolCalls && !m.toolResults ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Image
                      source={staticIcon}
                      style={{ width: 14, height: 14 }}
                      resizeMode="contain"
                    />
                    <Text style={{ color: theme.colors.mutedForeground, fontSize: 11 }}>thinking...</Text>
                  </View>
                ) : (
                  <>
                    {m.content ? (
                      isExpanded || !shouldCollapse ? (
                        <MarkdownRenderer content={m.content} />
                      ) : (
                        // Only show collapsed content preview if there are NO tool calls
                        // Tool calls have their own compact summary row, so don't duplicate
                        !((m.toolCalls?.length ?? 0) > 0 || (m.toolResults?.length ?? 0) > 0) && (
                          <Text
                            style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 18 }}
                            numberOfLines={1}
                          >
                            {m.content}
                          </Text>
                        )
                      )
                    ) : null}

                    {/* Unified Tool Execution Display - show when there are toolCalls OR toolResults */}
                    {((m.toolCalls?.length ?? 0) > 0 || (m.toolResults?.length ?? 0) > 0) && (
                      <>
                        {/* Collapsed view - single line summary for all tools */}
                        {!isExpanded && (
                          <Pressable
                            onPress={() => toggleMessageExpansion(i)}
                            style={({ pressed }) => [
                              styles.toolCallCompactRow,
                              isPending && styles.toolCallCompactPending,
                              allSuccess && styles.toolCallCompactSuccess,
                              hasErrors && styles.toolCallCompactError,
                              pressed && styles.toolCallCompactPressed,
                            ]}
                          >
                            <Text style={[
                              styles.toolCallCompactIcon,
                              isPending && styles.toolCallCompactIconPending,
                              allSuccess && styles.toolCallCompactIconSuccess,
                              hasErrors && styles.toolCallCompactIconError,
                            ]}>🔧</Text>
                            <Text
                              style={[
                                styles.toolCallCompactName,
                                isPending && styles.toolCallCompactNamePending,
                                allSuccess && styles.toolCallCompactNameSuccess,
                                hasErrors && styles.toolCallCompactNameError,
                              ]}
                              numberOfLines={1}
                            >
                              {(m.toolCalls?.map(tc => tc.name) ?? []).join(', ')}
                            </Text>
                            <Text style={[
                              styles.toolCallCompactStatus,
                              isPending && styles.toolCallCompactStatusPending,
                              allSuccess && styles.toolCallCompactStatusSuccess,
                              hasErrors && styles.toolCallCompactStatusError,
                            ]}>
                              {isPending ? '⏳' : allSuccess ? '✓' : '✗'}
                            </Text>
                            {/* Result preview - show truncated result content like desktop */}
                            {!isPending && m.toolResults && m.toolResults.length > 0 && (
                              <Text
                                style={styles.toolCallCompactPreview}
                                numberOfLines={1}
                              >
                                {getToolResultsSummary(m.toolResults)}
                              </Text>
                            )}
                            <Text style={styles.toolCallCompactChevron}>▶</Text>
                          </Pressable>
                        )}

                        {/* Expanded view - each tool call with its own params + result */}
                        {isExpanded && (
                          <View style={[
                            styles.toolExecutionCard,
                            isPending && styles.toolExecutionPending,
                            allSuccess && styles.toolExecutionSuccess,
                            hasErrors && styles.toolExecutionError,
                          ]}>
                            {m.toolCalls?.map((toolCall, idx) => {
                              const result = m.toolResults?.[idx];
                              const isResultPending = !result && idx >= (m.toolResults?.length ?? 0);
                              // Use message id or fallback to array index to ensure stable, unique keys
                              // that won't collide when m.id is undefined (which is common)
                              const stableMessageKey = m.id ?? String(i);
                              const toolCallKey = `${stableMessageKey}-${idx}`;
                              const isToolCallFullyExpanded = expandedToolCalls[toolCallKey] ?? false;
                              return (
                                <View key={idx} style={styles.toolCallSection}>
                                  {/* Tool name heading - tappable to toggle full expansion */}
                                  <Pressable
                                    onPress={() => toggleToolCallExpansion(stableMessageKey, idx)}
                                    style={({ pressed }) => [
                                      styles.toolCallHeader,
                                      pressed && styles.toolCallHeaderPressed,
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded: isToolCallFullyExpanded }}
                                    accessibilityHint={isToolCallFullyExpanded ? 'Collapse tool details' : 'Expand to show full input/output'}
                                  >
                                    <Text style={styles.toolName}>{toolCall.name}</Text>
                                    <Text style={styles.toolCallExpandHint}>
                                      {isToolCallFullyExpanded ? '▼ Collapse' : '▶ Full Details'}
                                    </Text>
                                  </Pressable>

                                  {/* Parameters */}
                                  {toolCall.arguments && (
                                    <View style={styles.toolParamsSection}>
                                      <Text style={styles.toolSectionLabel}>Input:</Text>
                                      <ScrollView
                                        style={isToolCallFullyExpanded ? styles.toolParamsScrollExpanded : styles.toolParamsScroll}
                                        nestedScrollEnabled
                                      >
                                        <Text style={styles.toolParamsCode}>
                                          {formatToolArguments(toolCall.arguments)}
                                        </Text>
                                      </ScrollView>
                                    </View>
                                  )}

                                  {/* Result for this specific tool call */}
                                  {result ? (
                                    <View style={styles.toolResultItem}>
                                      <View style={styles.toolResultHeader}>
                                        <Text style={styles.toolSectionLabel}>Output:</Text>
                                        <Text style={[
                                          styles.toolResultBadge,
                                          result.success ? styles.toolResultBadgeSuccess : styles.toolResultBadgeError
                                        ]}>
                                          {result.success ? '✅ OK' : '❌ Error'}
                                        </Text>
                                        <Text style={styles.toolResultCharCount}>
                                          {(result.content?.length || 0).toLocaleString()} chars
                                        </Text>
                                      </View>
                                      <ScrollView
                                        style={isToolCallFullyExpanded ? styles.toolResultScrollExpanded : styles.toolResultScroll}
                                        nestedScrollEnabled
                                      >
                                        <Text style={styles.toolResultCode}>
                                          {result.content || 'No content returned'}
                                        </Text>
                                      </ScrollView>
                                      {result.error && (
                                        <View style={styles.toolResultErrorSection}>
                                          <Text style={styles.toolResultErrorLabel}>Error:</Text>
                                          <Text style={styles.toolResultErrorText}>{result.error}</Text>
                                        </View>
                                      )}
                                    </View>
                                  ) : isResultPending ? (
                                    <Text style={styles.toolResponsePendingText}>⏳ Waiting...</Text>
                                  ) : null}
                                </View>
                              );
                            })}
                            {/* Show message if no tool calls */}
                            {(m.toolCalls?.length ?? 0) === 0 && (
                              <Text style={styles.toolResponsePendingText}>No tool calls</Text>
                            )}
                          </View>
                        )}
                      </>
                    )}
                  </>
                )}
              </View>
            );
          })}
          {connectionState && connectionState.status === 'reconnecting' && (
            <View style={styles.connectionBanner}>
              <ActivityIndicator size="small" color="#f59e0b" style={{ marginRight: spacing.sm }} />
              <Text style={styles.connectionBannerText}>
                {formatConnectionStatus(connectionState)}
              </Text>
            </View>
          )}
          {debugInfo && (
            <View style={styles.debugInfo}>
              <Text style={styles.debugText}>{debugInfo}</Text>
            </View>
          )}
        </ScrollView>
        {/* Scroll to bottom button - appears when user scrolls up */}
        {!shouldAutoScroll && (
          <TouchableOpacity
            style={[styles.scrollToBottomButton, { bottom: 80 + insets.bottom }]}
            onPress={() => {
              setShouldAutoScroll(true);
              scrollViewRef.current?.scrollToEnd({ animated: true });
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Scroll to bottom"
            accessibilityHint="Scrolls to the latest messages"
          >
            <Text style={styles.scrollToBottomText}>↓</Text>
          </TouchableOpacity>
        )}
        {listening && (
          <View style={[styles.overlay, { bottom: 72 + insets.bottom }]} pointerEvents="none">
            <Text style={styles.overlayText}>
              {handsFree ? 'Listening...' : (willCancel ? 'Release to edit' : 'Release to send')}
            </Text>
            {!!liveTranscript && (
              <Text style={styles.overlayTranscript} numberOfLines={2}>
                {liveTranscript}
              </Text>
            )}
          </View>
        )}
        {/* Message Queue Panel */}
        {messageQueueEnabled && queuedMessages.length > 0 && (
          <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
            <MessageQueuePanel
              conversationId={currentConversationId}
              messages={queuedMessages}
              onRemove={(messageId) => messageQueue.removeFromQueue(currentConversationId, messageId)}
              onUpdate={(messageId, text) => messageQueue.updateText(currentConversationId, messageId, text)}
              onRetry={(messageId) => {
                messageQueue.resetToPending(currentConversationId, messageId);
                // If not already processing, trigger queue processing
                if (!responding) {
                  const nextMessage = messageQueue.peek(currentConversationId);
                  if (nextMessage) {
                    console.log('[ChatScreen] onRetry: Processing queue while idle, next message:', nextMessage.id);
                    messageQueue.markProcessing(currentConversationId, nextMessage.id);
                    setTimeout(() => {
                      processQueuedMessage(nextMessage);
                    }, 100);
                  }
                }
              }}
              onClear={() => messageQueue.clearQueue(currentConversationId)}
            />
          </View>
        )}
        {/* Connection status banner - shows when reconnecting */}
        {connectionState && connectionState.status === 'reconnecting' && (
          <View style={[styles.connectionBanner, styles.connectionBannerReconnecting]}>
            <View style={styles.connectionBannerContent}>
              <Text style={styles.connectionBannerIcon}>🔄</Text>
              <View style={styles.connectionBannerTextContainer}>
                <Text style={styles.connectionBannerText}>
                  Reconnecting... (attempt {connectionState.retryCount})
                </Text>
                {connectionState.lastError && (
                  <Text style={styles.connectionBannerSubtext} numberOfLines={1}>
                    {connectionState.lastError}
                  </Text>
                )}
              </View>
            </View>
          </View>
        )}
        {/* Retry banner - shows when there's a failed message that can be retried */}
        {lastFailedMessage && !responding && (
          <View style={[styles.connectionBanner, styles.connectionBannerFailed]}>
            <View style={styles.connectionBannerContent}>
              <Text style={styles.connectionBannerIcon}>⚠️</Text>
              <View style={styles.connectionBannerTextContainer}>
                <Text style={styles.connectionBannerText}>Message failed to send</Text>
                <Text style={styles.connectionBannerSubtext} numberOfLines={1}>
                  Tap retry to try again
                </Text>
              </View>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={async () => {
                  const messageToRetry = lastFailedMessage;
                  setLastFailedMessage(null);

                  // Use the recovery conversation ID if available, so the retry resumes
                  // the same server-created conversation when the first attempt failed mid-stream
                  const retryClient = getSessionClient();
                  const recoveryConversationId = retryClient?.getRecoveryConversationId();

                  // Try to recover conversation state from server first (fixes #815)
                  // If the server already processed the message, we should sync the state
                  // instead of re-sending the message
                  if (recoveryConversationId && retryClient) {
                    console.log('[ChatScreen] Retry: Checking server conversation state:', recoveryConversationId);
                    try {
                      const serverConversation = await retryClient.getConversation(recoveryConversationId);
                      if (serverConversation && serverConversation.messages.length > 0) {
                        // Check if the server has the user's message and a response
                        const serverMessages = serverConversation.messages;

                        // Find the index of the last user message
                        let lastUserMsgIndex = -1;
                        for (let i = serverMessages.length - 1; i >= 0; i--) {
                          if (serverMessages[i].role === 'user') {
                            lastUserMsgIndex = i;
                            break;
                          }
                        }

                        // Check if there's ANY assistant message with content after the last user message
                        // This handles cases where tool messages follow the assistant response
                        let hasAssistantResponse = false;
                        if (lastUserMsgIndex >= 0) {
                          for (let i = lastUserMsgIndex + 1; i < serverMessages.length; i++) {
                            if (serverMessages[i].role === 'assistant' && serverMessages[i].content) {
                              hasAssistantResponse = true;
                              break;
                            }
                          }
                        }

                        // If there's an assistant response after the last user message, server already processed the request
                        if (hasAssistantResponse) {
                          console.log('[ChatScreen] Retry: Server already has response, syncing state');

                          // Update the server conversation ID
                          await sessionStore.setServerConversationId(recoveryConversationId);

                          // Convert server messages to ChatMessage format, filtering out tool messages
                          // and merging their toolResults into the preceding assistant message
                          const recoveredMessages: ChatMessage[] = [];
                          for (const msg of serverMessages) {
                            // Only include 'user' and 'assistant' roles
                            if (msg.role === 'user' || msg.role === 'assistant') {
                              recoveredMessages.push({
                                id: msg.id,
                                role: msg.role,
                                content: msg.content,
                                toolCalls: msg.toolCalls,
                                toolResults: msg.toolResults,
                              });
                            } else if (msg.role === 'tool' && recoveredMessages.length > 0) {
                              // Merge tool message toolResults into the preceding assistant message
                              const lastMessage = recoveredMessages[recoveredMessages.length - 1];
                              if (lastMessage.role === 'assistant' && lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
                                const hasToolResults = msg.toolResults && msg.toolResults.length > 0;
                                const hasContent = msg.content && msg.content.trim().length > 0;

                                if (hasToolResults) {
                                  // Merge toolResults into the existing assistant message
                                  lastMessage.toolResults = [
                                    ...(lastMessage.toolResults || []),
                                    ...(msg.toolResults || []),
                                  ];
                                  // Also preserve any content from the tool message (e.g., error messages)
                                  if (hasContent) {
                                    lastMessage.content = (lastMessage.content || '') +
                                      (lastMessage.content ? '\n' : '') + msg.content;
                                  }
                                }
                              }
                            }
                          }

                          // Replace local messages with server state
                          setMessages(recoveredMessages);

                          // Also persist to session store
                          await sessionStore.setMessages(recoveredMessages);

                          console.log('[ChatScreen] Retry: Successfully recovered', recoveredMessages.length, 'messages from server');
                          return; // Don't retry, we've recovered the state
                        }
                      }
                    } catch (error) {
                      console.log('[ChatScreen] Retry: Could not fetch server state, will retry message:', error);
                    }

                    // If we couldn't recover, set the conversation ID for the retry
                    console.log('[ChatScreen] Retry: Using recovery conversationId:', recoveryConversationId);
                    await sessionStore.setServerConversationId(recoveryConversationId);
                  }

                  // Remove the last error message before retrying
                  setMessages((m) => {
                    // Remove the last assistant message (error) and user message
                    const newMessages = [...m];
                    if (newMessages.length >= 2) {
                      newMessages.pop(); // Remove error message
                      newMessages.pop(); // Remove user message
                    }
                    return newMessages;
                  });
                  // Use setTimeout to ensure setMessages completes before send() reads the updated state.
                  // React batches state updates, so send() would otherwise read stale messages.
                  setTimeout(() => send(messageToRetry), 0);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={[styles.inputRow, { paddingBottom: 12 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.ttsToggle, ttsEnabled && styles.ttsToggleOn]}
            onPress={toggleTts}
            activeOpacity={0.7}
          >
            <Text style={styles.ttsToggleText}>{ttsEnabled ? '🔊' : '🔇'}</Text>
          </TouchableOpacity>
          <View 
            style={styles.micWrapper}
          >
            <Pressable
              style={[
                styles.mic,
                listening && styles.micOn,
                // @ts-ignore - Web-specific CSS to prevent text selection
                Platform.OS === 'web' && { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation' },
              ]}
              onPressIn={!handsFree ? (e: GestureResponderEvent) => {
                lastGrantTimeRef.current = Date.now();
                voiceLog('mic:onPressIn');
                if (!listeningRef.current) startRecording(e);
              } : undefined}
              onPressOut={!handsFree ? () => {
                const now = Date.now();
                const dt = now - lastGrantTimeRef.current;
                const delay = Math.max(0, minHoldMs - dt);
                voiceLog('mic:onPressOut');
                if (delay > 0) {
                  setTimeout(() => {
                    if (listeningRef.current) stopRecordingAndHandle();
                  }, delay);
                } else {
                  if (listeningRef.current) stopRecordingAndHandle();
                }
              } : undefined}
              onPress={handsFree ? () => {
                voiceLog('mic:onPress (handsFree)');
                if (!listeningRef.current) startRecording(); else stopRecordingAndHandle();
              } : undefined}
            >
              <Text style={styles.micText} selectable={false}>
                {listening ? '🎙️' : '🎤'}
              </Text>
              <Text style={[styles.micLabel, listening && styles.micLabelOn]} selectable={false}>
                {handsFree ? (listening ? 'Stop' : 'Talk') : (listening ? '...' : 'Hold')}
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={handleInputChange}
            onKeyPress={handleInputKeyPress}
            placeholder={handsFree ? (listening ? 'Listening…' : 'Type or tap mic') : (listening ? 'Listening…' : 'Type or hold mic')}
            placeholderTextColor={theme.colors.mutedForeground}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={() => send(input)}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    // Compact desktop-style messages: left-border accent, full width, no bubbles
    msg: {
      paddingLeft: spacing.xs,
      paddingVertical: 2,
      marginBottom: 0,
      width: '100%',
    },
    user: {
      // User messages: subtle left border accent
      borderLeftWidth: 2,
      borderLeftColor: hexToRgba(theme.colors.info, 0.4),
      paddingLeft: spacing.xs,
    },
    assistant: {
      // Assistant messages: subtle left-border accent like desktop
      borderLeftWidth: 2,
      borderLeftColor: hexToRgba(theme.colors.mutedForeground, 0.3),
      paddingLeft: spacing.xs,
    },
    messageHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 2,
      marginBottom: 1,
      paddingVertical: 1,
      marginHorizontal: -1,
      paddingHorizontal: 1,
      borderRadius: radius.sm,
    },
    messageHeaderClickable: {
      // Visual hint that header is clickable
    },
    messageHeaderPressed: {
      backgroundColor: theme.colors.muted,
    },
    expandButton: {
      marginLeft: 'auto',
      paddingHorizontal: 2,
      paddingVertical: 1,
    },
    expandButtonText: {
      fontSize: 8,
      color: theme.colors.primary,
      fontWeight: '500',
    },

    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderTopWidth: theme.hairline,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
    },
    input: {
      ...theme.input,
      flex: 1,
      maxHeight: 120,
    },
    micWrapper: {
      borderRadius: radius.full,
    },
    mic: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    micOn: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },

    micText: {
      fontSize: 18,
    },
    micLabel: {
      fontSize: 9,
      color: theme.colors.mutedForeground,
      marginTop: 1,
    },
    micLabelOn: {
      color: theme.colors.primaryForeground,
    },
    ttsToggle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ttsToggleOn: {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.primary,
    },
    ttsToggleText: {
      fontSize: 14,
    },
    sendButton: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
    },
    sendButtonText: {
      color: theme.colors.primaryForeground,
      fontWeight: '600',
      fontSize: 13,
    },
    debugInfo: {
      backgroundColor: theme.colors.muted,
      padding: spacing.sm,
      margin: spacing.sm,
      borderRadius: radius.lg,
      borderLeftWidth: 4,
      borderLeftColor: theme.colors.primary,
    },
    debugText: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    connectionBanner: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
    },
    connectionBannerReconnecting: {
      backgroundColor: hexToRgba(theme.colors.info, 0.1),
      borderColor: hexToRgba(theme.colors.info, 0.3),
    },
    connectionBannerFailed: {
      backgroundColor: hexToRgba(theme.colors.destructive, 0.1),
      borderColor: hexToRgba(theme.colors.destructive, 0.3),
    },
    connectionBannerContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    connectionBannerIcon: {
      fontSize: 16,
      marginRight: spacing.sm,
    },
    connectionBannerTextContainer: {
      flex: 1,
    },
    connectionBannerText: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.foreground,
    },
    connectionBannerSubtext: {
      fontSize: 11,
      color: theme.colors.mutedForeground,
      marginTop: 2,
    },
    retryButton: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      marginLeft: spacing.sm,
    },
    retryButtonText: {
      color: theme.colors.primaryForeground,
      fontSize: 13,
      fontWeight: '600',
    },
    scrollToBottomButton: {
      position: 'absolute',
      right: spacing.lg,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
    scrollToBottomText: {
      fontSize: 20,
      color: theme.colors.primaryForeground,
      fontWeight: '600',
    },
    overlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 72,
      alignItems: 'center',
      padding: spacing.md,
    },
    overlayText: {
      ...theme.typography.caption,
      backgroundColor: hexToRgba(theme.colors.foreground, 0.75),
      color: theme.colors.background,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.xl,
      marginBottom: 6,
    },
    overlayTranscript: {
      backgroundColor: hexToRgba(theme.colors.foreground, 0.6),
      color: theme.colors.background,
      padding: 10,
      borderRadius: radius.lg,
      maxWidth: '90%',
    },
    // Unified Tool Execution Card styles - compact left-accent design matching desktop
    toolExecutionCard: {
      marginTop: 2,
      borderRadius: radius.sm,
      borderLeftWidth: 1.5,
      borderLeftColor: hexToRgba(theme.colors.mutedForeground, 0.5),
      backgroundColor: hexToRgba(theme.colors.mutedForeground, 0.02),
      overflow: 'hidden',
    },
    toolExecutionPending: {
      borderLeftColor: hexToRgba(theme.colors.info, 0.5),
      backgroundColor: hexToRgba(theme.colors.info, 0.02),
    },
    toolExecutionSuccess: {
      borderLeftColor: hexToRgba(theme.colors.success, 0.5),
      backgroundColor: hexToRgba(theme.colors.success, 0.02),
    },
    toolExecutionError: {
      borderLeftColor: hexToRgba(theme.colors.destructive, 0.5),
      backgroundColor: hexToRgba(theme.colors.destructive, 0.02),
    },
    toolCallCompactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 2,
      paddingHorizontal: 3,
      borderRadius: radius.sm,
      gap: 3,
    },
    toolCallCompactPending: {
      backgroundColor: hexToRgba(theme.colors.info, 0.05),
    },
    toolCallCompactSuccess: {
      backgroundColor: hexToRgba(theme.colors.mutedForeground, 0.03),
    },
    toolCallCompactError: {
      backgroundColor: hexToRgba(theme.colors.mutedForeground, 0.03),
    },
    toolCallCompactPressed: {
      opacity: 0.7,
    },
    toolCallCompactIcon: {
      fontSize: 8,
    },
    toolCallCompactIconPending: {
      // uses default
    },
    toolCallCompactIconSuccess: {
      color: theme.colors.mutedForeground,
    },
    toolCallCompactIconError: {
      color: theme.colors.mutedForeground,
    },
    toolCallCompactName: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10,
      fontWeight: '500',
      flexShrink: 1,
    },
    toolCallCompactNamePending: {
      color: theme.colors.info,
    },
    toolCallCompactNameSuccess: {
      color: theme.colors.mutedForeground,
    },
    toolCallCompactNameError: {
      color: theme.colors.mutedForeground,
    },
    toolCallCompactStatus: {
      fontSize: 9,
      marginLeft: 1,
    },
    toolCallCompactStatusPending: {
      color: theme.colors.info,
    },
    toolCallCompactStatusSuccess: {
      color: theme.colors.mutedForeground,
    },
    toolCallCompactStatusError: {
      color: theme.colors.mutedForeground,
    },
    toolCallCompactChevron: {
      fontSize: 8,
      color: theme.colors.mutedForeground,
      opacity: 0.4,
      marginLeft: 'auto',
    },
    toolCallCompactPreview: {
      fontSize: 9,
      color: theme.colors.mutedForeground,
      opacity: 0.6,
      flex: 1,
      marginLeft: 2,
    },
    toolParamsSection: {
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
    },
    toolParamsSectionTitle: {
      fontSize: 9,
      fontWeight: '600',
      color: theme.colors.mutedForeground,
      marginBottom: 2,
      opacity: 0.7,
    },
    toolCallCard: {
      backgroundColor: hexToRgba(theme.colors.foreground, 0.02),
      borderRadius: radius.sm,
      padding: 3,
      marginBottom: 2,
    },
    toolCallSection: {
      marginBottom: spacing.xs,
      paddingBottom: spacing.xs,
      borderBottomWidth: 0.5,
      borderBottomColor: hexToRgba(theme.colors.mutedForeground, 0.15),
    },
    toolName: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontWeight: '600',
      color: theme.colors.primary,
      fontSize: 10,
      flex: 1,
    },
    toolCallHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
      marginBottom: spacing.xs,
    },
    toolCallHeaderPressed: {
      opacity: 0.7,
    },
    toolCallExpandHint: {
      fontSize: 9,
      color: theme.colors.mutedForeground,
      fontWeight: '500',
    },
    toolSectionLabel: {
      fontSize: 8,
      fontWeight: '600',
      color: theme.colors.mutedForeground,
      marginBottom: 2,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    toolParamsScroll: {
      maxHeight: 80,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    toolParamsScrollExpanded: {
      maxHeight: 400,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    toolParamsCode: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 8,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.muted,
      padding: 3,
      borderRadius: radius.sm,
    },
    toolResponseSection: {
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
    },
    toolResponsePending: {
      // No background - let parent handle it
    },
    toolResponseSuccess: {
      // No background - let parent handle it
    },
    toolResponseError: {
      // No background - let parent handle it
    },
    toolResponseSectionTitle: {
      fontSize: 9,
      fontWeight: '600',
      color: theme.colors.mutedForeground,
      marginBottom: 2,
      opacity: 0.7,
    },
    toolResponsePendingText: {
      fontSize: 9,
      fontStyle: 'italic',
      color: theme.colors.mutedForeground,
      textAlign: 'center',
      paddingVertical: 2,
    },
    toolResultItem: {
      marginBottom: 2,
    },
    toolResultHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 1,
    },
    toolResultCharCount: {
      fontSize: 8,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      color: theme.colors.mutedForeground,
      opacity: 0.6,
    },
    toolResultBadge: {
      fontSize: 9,
      fontWeight: '600',
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    toolResultBadgeSuccess: {
      backgroundColor: hexToRgba(theme.colors.success, 0.12),
      color: theme.colors.success,
    },
    toolResultBadgeError: {
      backgroundColor: hexToRgba(theme.colors.destructive, 0.12),
      color: theme.colors.destructive,
    },
    toolResultScroll: {
      maxHeight: 80,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    toolResultScrollExpanded: {
      maxHeight: 400,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    toolResultCode: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 8,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.muted,
      padding: 3,
      borderRadius: radius.sm,
    },
    toolResultErrorSection: {
      marginTop: 1,
    },
    toolResultErrorLabel: {
      fontSize: 8,
      fontWeight: '500',
      color: theme.colors.destructive,
      marginBottom: 1,
    },
    toolResultErrorText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 8,
      color: theme.colors.destructive,
      backgroundColor: hexToRgba(theme.colors.destructive, 0.06),
      padding: 3,
      borderRadius: radius.sm,
    },
  });
}
