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
} from 'react-native';

const darkSpinner = require('../../assets/loading-spinner.gif');
const lightSpinner = require('../../assets/light-spinner.gif');
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventEmitter } from 'expo-modules-core';
import { useConfigContext, saveConfig } from '../store/config';
import { useSessionContext } from '../store/sessions';
import { useConnectionManager } from '../store/connectionManager';
import { ChatMessage, AgentProgressUpdate } from '../lib/openaiClient';
import { RecoveryState, formatConnectionStatus } from '../lib/connectionRecovery';
import * as Speech from 'expo-speech';
import {
  preprocessTextForTTS,
  COLLAPSED_LINES,
  getRoleIcon,
  getRoleLabel,
  shouldCollapseMessage,
  getToolResultsSummary,
  formatToolArguments,
  formatArgumentsPreview,
} from '@speakmcp/shared';
import { useHeaderHeight } from '@react-navigation/elements';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme } from '../ui/theme';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';

export default function ChatScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { config, setConfig } = useConfigContext();
  const sessionStore = useSessionContext();
  const connectionManager = useConnectionManager();
  const handsFree = !!config.handsFree;
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
      setConnectionState(null);
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
          {responding && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
              <Image
                source={isDark ? darkSpinner : lightSpinner}
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
  }, [navigation, handsFree, handleKillSwitch, handleNewChat, responding, theme, isDark, sessionStore]);


  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [expandedMessages, setExpandedMessages] = useState<Record<number, boolean>>({});

  // Auto-scroll state and ref for mobile chat
  const scrollViewRef = useRef<ScrollView>(null);
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

    // Reset expandedMessages on session switch to ensure consistent "final response expanded"
    // behavior per chat and prevent stale entries from affecting the new session
    setExpandedMessages({});

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

  const send = async (text: string) => {
    if (!text.trim()) return;

    console.log('[ChatScreen] Sending message:', text);

    // Get client from connection manager (preserves connections across session switches)
    const client = getSessionClient();
    if (!client) {
      console.error('[ChatScreen] No client available for send');
      setDebugInfo('Error: No session available');
      return;
    }

    setDebugInfo(`Starting request to ${config.baseUrl}...`);

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
        streamingText += tok;

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
          // Persist to the original session without updating UI state
          console.log('[ChatScreen] Persisting completed response to background session:', requestSessionId);
          // Build the final messages array: messages before this turn + user message + new assistant messages
          const messagesBeforeTurn = messages.slice(0, messageCountBeforeTurn);
          const finalMessages = [...messagesBeforeTurn, userMsg, ...newMessages];
          await sessionStore.setMessagesForSession(requestSessionId, finalMessages);
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
          // Persist to the original session without updating UI state
          console.log('[ChatScreen] Persisting fallback response to background session:', requestSessionId);
          const messagesBeforeTurn = messages.slice(0, messageCountBeforeTurn);
          const finalMessages = [...messagesBeforeTurn, userMsg, { role: 'assistant' as const, content: finalText }];
          await sessionStore.setMessagesForSession(requestSessionId, finalMessages);
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

      const recoveryState = connectionState;
      let errorMessage = e.message;

      if (recoveryState?.status === 'failed') {
        errorMessage = `Connection failed after ${recoveryState.retryCount} retries. ${recoveryState.lastError || ''}`;
      } else if (recoveryState?.status === 'reconnecting') {
        errorMessage = `Connection lost. Attempted ${recoveryState.retryCount} reconnections. ${e.message}`;
      }

      setDebugInfo(`Error: ${errorMessage}`);
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${errorMessage}\n\nTip: Check your internet connection and try again.` }]);
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

  const ensureWebRecognizer = () => {
    if (Platform.OS !== 'web') return false;
    // @ts-ignore
    const SRClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SRClass) {
      console.warn('[Voice] Web Speech API not available (use Chrome/Edge over HTTPS).');
      return false;
    }
    if (!webRecognitionRef.current) {
      const rec = new SRClass();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onstart = () => {};
      rec.onerror = (ev: any) => {
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
        if (interim) setLiveTranscript(interim);
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
                setLiveTranscript('');
                if (toSend) send(toSend);
              }, handsFreeDebounceMs);
            }
          } else {
            webFinalRef.current += finalText;
          }
        }
      };
      rec.onend = () => {
        if (handsFreeDebounceRef.current) {
          clearTimeout(handsFreeDebounceRef.current);
          handsFreeDebounceRef.current = null;
        }

        if (!handsFreeRef.current && !userReleasedButtonRef.current && webRecognitionRef.current) {
          try {
            webRecognitionRef.current.start();
            return;
          } catch (restartErr) {
            console.warn('[Voice] Failed to restart web recognition after voice break:', restartErr);
            setListening(false);
            setLiveTranscript('');
            const accumulatedText = (webFinalRef.current || '').trim() || (liveTranscriptRef.current || '').trim();
            if (accumulatedText) {
              setInput((t) => (t ? `${t} ${accumulatedText}` : accumulatedText));
            }
            webFinalRef.current = '';
            pendingHandsFreeFinalRef.current = '';
            return;
          }
        }

        const finalText = (pendingHandsFreeFinalRef.current || webFinalRef.current || '').trim() || (liveTranscriptRef.current || '').trim();
        pendingHandsFreeFinalRef.current = '';
        setListening(false);
        setLiveTranscript('');
        const willEdit = willCancelRef.current;
        if (!handsFreeRef.current && finalText) {
          if (willEdit) setInput((t) => (t ? `${t} ${finalText}` : finalText));
          else send(finalText);
        } else if (handsFreeRef.current && finalText) {
          send(finalText);
        }
        webFinalRef.current = '';
      };
      webRecognitionRef.current = rec;
    }
    return true;
  };

  const startRecording = async (e?: GestureResponderEvent) => {
    if (startingRef.current || listening) {
      return;
    }
    startingRef.current = true;
    try {
      setWillCancel(false);
      setLiveTranscript('');
      setListening(true);
      nativeFinalRef.current = '';
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
            if (!srEmitterRef.current) {
              srEmitterRef.current = new EventEmitter(SR.ExpoSpeechRecognitionModule);
            }
            cleanupNativeSubs();
            const subResult = srEmitterRef.current.addListener('result', (event: any) => {
              const t = event?.results?.[0]?.transcript ?? event?.text ?? event?.transcript ?? '';
              if (t) setLiveTranscript(t);
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
                      setLiveTranscript('');
                      if (toSend) send(toSend);
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
              console.error('[Voice] Native recognition error:', JSON.stringify(event));
            });
            const subEnd = srEmitterRef.current.addListener('end', async () => {
              if (handsFreeDebounceRef.current) {
                clearTimeout(handsFreeDebounceRef.current);
                handsFreeDebounceRef.current = null;
              }

              if (!handsFreeRef.current && !userReleasedButtonRef.current) {
                try {
                  const SR: any = await import('expo-speech-recognition');
                  if (SR?.ExpoSpeechRecognitionModule?.start) {
                    SR.ExpoSpeechRecognitionModule.start({
                      lang: 'en-US',
                      interimResults: true,
                      continuous: true,
                      volumeChangeEventOptions: { enabled: false, intervalMillis: 250 }
                    });
                    return;
                  }
                } catch (restartErr) {
                  console.warn('[Voice] Failed to restart recognition after voice break:', restartErr);
                  setListening(false);
                  setLiveTranscript('');
                  const accumulatedText = (nativeFinalRef.current || '').trim() || (liveTranscriptRef.current || '').trim();
                  if (accumulatedText) {
                    setInput((t) => (t ? `${t} ${accumulatedText}` : accumulatedText));
                  }
                  nativeFinalRef.current = '';
                  pendingHandsFreeFinalRef.current = '';
                  return;
                }
              }

              setListening(false);
              const finalText = (pendingHandsFreeFinalRef.current || nativeFinalRef.current || liveTranscriptRef.current || '').trim();
              pendingHandsFreeFinalRef.current = '';
              setLiveTranscript('');
              const willEdit = willCancelRef.current;
              if (!handsFreeRef.current && finalText) {
                if (willEdit) setInput((t) => (t ? `${t} ${finalText}` : finalText));
                else send(finalText);
              } else if (handsFreeRef.current && finalText) {
                send(finalText);
              }
              nativeFinalRef.current = '';
            });
            srSubsRef.current.push(subResult, subError, subEnd);

            try {
              const perm = await SR.ExpoSpeechRecognitionModule.getPermissionsAsync();
              if (!perm?.granted) {
                const req = await SR.ExpoSpeechRecognitionModule.requestPermissionsAsync();
                if (!req?.granted) {
                  console.warn('[Voice] microphone/speech permission not granted; aborting');
                  setListening(false);
                  startingRef.current = false;
                  return;
                }
              }
            } catch (perr) {
              console.error('[Voice] Permission check/request failed:', perr);
            }

            try {
              SR.ExpoSpeechRecognitionModule.start({
                lang: 'en-US',
                interimResults: true,
                continuous: true,
                volumeChangeEventOptions: { enabled: handsFreeRef.current, intervalMillis: 250 }
              });
            } catch (serr) {
              console.error('[Voice] Native start error:', serr);
              setListening(false);
            }
            startingRef.current = false;
            return;
          }
        } catch (err) {
          const errorMsg = (err as any)?.message || String(err);
          console.warn('[Voice] Native SR unavailable (likely Expo Go):', errorMsg);

          if (!nativeSRUnavailableShownRef.current && errorMsg.includes('ExpoSpeechRecognition')) {
            nativeSRUnavailableShownRef.current = true;
            setListening(false);
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
          webFinalRef.current = '';
          pendingHandsFreeFinalRef.current = '';
          if (webRecognitionRef.current) {
            try { webRecognitionRef.current.continuous = true; } catch {}
          }
          webRecognitionRef.current?.start();
          startingRef.current = false;
        } catch (err) {
          console.error('[Voice] Web start error:', err);
          setListening(false);
          startingRef.current = false;
        }
      } else {
        setListening(false);
        startingRef.current = false;
      }
    } catch (err) {
      console.error('[Voice] startRecording error:', err);
      setListening(false);
      startingRef.current = false;
    }
  };

  const stopRecordingAndHandle = async () => {
    if (stoppingRef.current) {
      return;
    }
    stoppingRef.current = true;
    userReleasedButtonRef.current = true;
    try {
      const hasWeb = Platform.OS === 'web' && webRecognitionRef.current;
      if (!listening && !hasWeb) {
        return;
      }

      if (Platform.OS !== 'web') {
        try {
          const SR: any = await import('expo-speech-recognition');
          if (SR?.ExpoSpeechRecognitionModule?.stop) {
            SR.ExpoSpeechRecognitionModule.stop();
          }
        } catch (err) {
          console.warn('[Voice] Native stop unavailable (likely Expo Go):', (err as any)?.message || err);
        }
      }

      if (Platform.OS === 'web' && webRecognitionRef.current) {
        try {
          webRecognitionRef.current.stop();
        } catch (err) {
          console.error('[Voice] Web stop error:', err);
          setListening(false);
        }
      }
    } catch (err) {
      console.error('[Voice] stopRecording error:', err);
      setListening(false);
    } finally {
      startYRef.current = null;
      setWillCancel(false);
      stoppingRef.current = false;
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
          style={{ flex: 1, padding: spacing.lg, backgroundColor: theme.colors.background }}
          contentContainerStyle={{ paddingBottom: insets.bottom }}
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
            const roleIcon = getRoleIcon(m.role as 'user' | 'assistant' | 'tool');
            const roleLabel = getRoleLabel(m.role as 'user' | 'assistant' | 'tool');

            const toolCallCount = m.toolCalls?.length ?? 0;
            const toolResultCount = m.toolResults?.length ?? 0;
            const hasToolResults = toolResultCount > 0;
            const allSuccess = hasToolResults && m.toolResults!.every(r => r.success);
            const hasErrors = hasToolResults && m.toolResults!.some(r => !r.success);
            // isPending is true when there are more tool calls than results (including partial completion)
            const isPending = toolCallCount > 0 && toolCallCount > toolResultCount;

            const toolPreview = !isExpanded && m.toolCalls && m.toolCalls.length > 0 && m.toolCalls[0]?.arguments
              ? formatArgumentsPreview(m.toolCalls[0].arguments)
              : null;

            return (
              <View
                key={i}
                style={[
                  styles.msg,
                  m.role === 'user' ? styles.user : styles.assistant,
                ]}
              >
                {/* Clickable header for expand/collapse */}
                <Pressable
                  onPress={shouldCollapse ? () => toggleMessageExpansion(i) : undefined}
                  disabled={!shouldCollapse}
                  accessibilityRole={shouldCollapse ? 'button' : undefined}
                  accessibilityHint={
                    shouldCollapse
                      ? (isExpanded ? 'Collapse message' : 'Expand message')
                      : undefined
                  }
                  accessibilityState={shouldCollapse ? { expanded: isExpanded } : undefined}
                  style={({ pressed }) => [
                    styles.messageHeader,
                    shouldCollapse && styles.messageHeaderClickable,
                    shouldCollapse && pressed && styles.messageHeaderPressed,
                  ]}
                >
                  <Text style={styles.roleIcon} accessibilityLabel={roleLabel}>
                    {roleIcon}
                  </Text>
                  {(m.toolCalls?.length ?? 0) > 0 && (
                    <View style={[
                      styles.toolBadgeSmall,
                      isPending && styles.toolBadgePending,
                      allSuccess && styles.toolBadgeSuccess,
                      hasErrors && styles.toolBadgeError,
                    ]}>
                      <Text style={[
                        styles.toolBadgeSmallText,
                        isPending && styles.toolBadgePendingText,
                        allSuccess && styles.toolBadgeSuccessText,
                        hasErrors && styles.toolBadgeErrorText,
                      ]}>
                        {isPending ? '⏳ ' : allSuccess ? '✓ ' : hasErrors ? '✗ ' : ''}
                        {m.toolCalls!.map(tc => tc.name).join(', ')}
                      </Text>
                    </View>
                  )}
                  {shouldCollapse && (
                    <View style={styles.expandButton}>
                      <Text style={styles.expandButtonText}>
                        {isExpanded ? '▲' : '▼'}
                      </Text>
                    </View>
                  )}
                </Pressable>

                {m.role === 'assistant' && (!m.content || m.content.length === 0) && !m.toolCalls && !m.toolResults ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Image
                      source={isDark ? darkSpinner : lightSpinner}
                      style={{ width: 20, height: 20 }}
                      resizeMode="contain"
                    />
                    <Text style={{ color: theme.colors.foreground }}>Assistant is thinking</Text>
                  </View>
                ) : (
                  <>
                    {m.content ? (
                      isExpanded || !shouldCollapse ? (
                        <MarkdownRenderer content={m.content} />
                      ) : (
                        <Text
                          style={{ color: theme.colors.foreground }}
                          numberOfLines={COLLAPSED_LINES}
                        >
                          {m.content}
                        </Text>
                      )
                    ) : null}

                    {/* Unified Tool Execution Display - show when there are toolCalls OR toolResults */}
                    {((m.toolCalls?.length ?? 0) > 0 || (m.toolResults?.length ?? 0) > 0) && (
                      <View style={[
                        styles.toolExecutionCard,
                        isPending && styles.toolExecutionPending,
                        allSuccess && styles.toolExecutionSuccess,
                        hasErrors && styles.toolExecutionError,
                      ]}>
                        {/* Collapsed view - show preview */}
                        {!isExpanded && (
                          <View style={styles.toolExecutionCollapsed}>
                            {toolPreview && (
                              <Text style={styles.collapsedToolPreview} numberOfLines={1}>
                                {toolPreview}
                              </Text>
                            )}
                            {hasToolResults && (
                              <Text style={[
                                styles.collapsedToolText,
                                allSuccess && styles.collapsedToolTextSuccess,
                                hasErrors && styles.collapsedToolTextError,
                              ]}>
                                {getToolResultsSummary(m.toolResults!)}
                              </Text>
                            )}
                          </View>
                        )}

                        {/* Expanded view - show full details */}
                        {isExpanded && (
                          <>
                            {/* Call Parameters Section - only show if there are toolCalls */}
                            {(m.toolCalls?.length ?? 0) > 0 && (
                              <View style={styles.toolParamsSection}>
                                <Text style={styles.toolParamsSectionTitle}>Call Parameters</Text>
                                {m.toolCalls!.map((toolCall, idx) => (
                                  <View key={idx} style={styles.toolCallCard}>
                                    <Text style={styles.toolName}>{toolCall.name}</Text>
                                    {toolCall.arguments && (
                                      <ScrollView style={styles.toolParamsScroll} nestedScrollEnabled>
                                        <Text style={styles.toolParamsCode}>
                                          {formatToolArguments(toolCall.arguments)}
                                        </Text>
                                      </ScrollView>
                                    )}
                                  </View>
                                ))}
                              </View>
                            )}

                            {/* Response Section */}
                            <View style={[
                              styles.toolResponseSection,
                              isPending && styles.toolResponsePending,
                              allSuccess && styles.toolResponseSuccess,
                              hasErrors && styles.toolResponseError,
                            ]}>
                              <Text style={styles.toolResponseSectionTitle}>Response</Text>
                              {/* Show any received results first, even if more are pending */}
                              {(m.toolResults ?? []).map((result, idx) => (
                                <View key={idx} style={styles.toolResultItem}>
                                  <View style={styles.toolResultHeader}>
                                    <Text style={[
                                      styles.toolResultBadge,
                                      result.success ? styles.toolResultBadgeSuccess : styles.toolResultBadgeError
                                    ]}>
                                      {result.success ? '✅ Success' : '❌ Error'}
                                    </Text>
                                  </View>
                                  <ScrollView style={styles.toolResultScroll} nestedScrollEnabled>
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
                              ))}
                              {/* Show waiting indicator if more tool calls are pending */}
                              {isPending && (
                                <Text style={styles.toolResponsePendingText}>
                                  ⏳ Waiting for {toolCallCount - toolResultCount} more response{toolCallCount - toolResultCount > 1 ? 's' : ''}...
                                </Text>
                              )}
                              {/* Show message if no results yet at all */}
                              {toolResultCount === 0 && !isPending && (
                                <Text style={styles.toolResponsePendingText}>No responses received</Text>
                              )}
                            </View>
                          </>
                        )}
                      </View>
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
        <View style={[styles.inputRow, { paddingBottom: 12 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.ttsToggle, ttsEnabled && styles.ttsToggleOn]}
            onPress={toggleTts}
            activeOpacity={0.7}
          >
            <Text style={styles.ttsToggleText}>{ttsEnabled ? '🔊' : '🔇'}</Text>
          </TouchableOpacity>
          <View style={styles.micWrapper}>
            <TouchableOpacity
              style={[styles.mic, listening && styles.micOn]}
              activeOpacity={0.7}
              delayPressIn={0}
              onPressIn={!handsFree ? (e: GestureResponderEvent) => {
                lastGrantTimeRef.current = Date.now();
                if (!listening) startRecording(e);
              } : undefined}
              onPressOut={!handsFree ? () => {
                const now = Date.now();
                const dt = now - lastGrantTimeRef.current;
                const delay = Math.max(0, minHoldMs - dt);
                if (delay > 0) {
                  setTimeout(() => { if (listening) stopRecordingAndHandle(); }, delay);
                } else {
                  if (listening) stopRecordingAndHandle();
                }
              } : undefined}
              onPress={handsFree ? () => {
                if (!listening) startRecording(); else stopRecordingAndHandle();
              } : undefined}
            >
              <Text style={styles.micText}>
                {listening ? '🎙️' : '🎤'}
              </Text>
              <Text style={[styles.micLabel, listening && styles.micLabelOn]}>
                {handsFree ? (listening ? 'Stop' : 'Talk') : (listening ? '...' : 'Hold')}
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
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
    msg: {
      padding: spacing.md,
      borderRadius: radius.xl,
      marginBottom: spacing.sm,
      maxWidth: '85%',
    },
    user: {
      backgroundColor: theme.colors.secondary,
      alignSelf: 'flex-end',
    },
    assistant: {
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignSelf: 'flex-start',
    },
    roleIcon: {
      fontSize: 14,
      marginRight: 4,
    },
    messageHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginBottom: spacing.xs,
      paddingVertical: spacing.xs,
      marginHorizontal: -spacing.xs,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.sm,
    },
    messageHeaderClickable: {
      // Visual hint that header is clickable
    },
    messageHeaderPressed: {
      backgroundColor: theme.colors.muted,
    },
    toolBadgeSmall: {
      backgroundColor: theme.colors.muted,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexShrink: 1,
    },
    toolBadgePending: {
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      borderColor: 'rgba(59, 130, 246, 0.3)',
    },
    toolBadgeSuccess: {
      backgroundColor: 'rgba(34, 197, 94, 0.1)',
      borderColor: 'rgba(34, 197, 94, 0.3)',
    },
    toolBadgeError: {
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderColor: 'rgba(239, 68, 68, 0.3)',
    },
    toolBadgeSmallText: {
      fontSize: 11,
      color: theme.colors.mutedForeground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontWeight: '600',
    },
    toolBadgePendingText: {
      color: 'rgb(59, 130, 246)',
    },
    toolBadgeSuccessText: {
      color: 'rgb(34, 197, 94)',
    },
    toolBadgeErrorText: {
      color: 'rgb(239, 68, 68)',
    },
    expandButton: {
      marginLeft: 'auto',
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    expandButtonText: {
      fontSize: 12,
      color: theme.colors.primary,
      fontWeight: '600',
    },
    collapsedToolPreview: {
      fontSize: 11,
      color: theme.colors.mutedForeground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      opacity: 0.7,
      marginBottom: spacing.xs,
    },
    collapsedToolText: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
    },
    collapsedToolTextSuccess: {
      color: 'rgb(34, 197, 94)',
    },
    collapsedToolTextError: {
      color: 'rgb(239, 68, 68)',
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
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
      width: 64,
      height: 64,
      borderRadius: 32,
      borderWidth: 2,
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
      fontSize: 24,
    },
    micLabel: {
      fontSize: 10,
      color: theme.colors.mutedForeground,
      marginTop: 2,
    },
    micLabelOn: {
      color: theme.colors.primaryForeground,
    },
    ttsToggle: {
      width: 40,
      height: 40,
      borderRadius: 20,
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
      fontSize: 18,
    },
    sendButton: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
    },
    sendButtonText: {
      color: theme.colors.primaryForeground,
      fontWeight: '600',
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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      padding: spacing.sm,
      margin: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: 'rgba(245, 158, 11, 0.3)',
    },
    connectionBannerText: {
      fontSize: 13,
      color: '#f59e0b',
      fontWeight: '500',
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
      backgroundColor: 'rgba(0,0,0,0.75)',
      color: '#FFFFFF',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.xl,
      marginBottom: 6,
    },
    overlayTranscript: {
      backgroundColor: 'rgba(0,0,0,0.6)',
      color: '#FFFFFF',
      padding: 10,
      borderRadius: radius.lg,
      maxWidth: '90%',
    },
    // Unified Tool Execution Card styles
    toolExecutionCard: {
      marginTop: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    toolExecutionPending: {
      borderColor: 'rgba(59, 130, 246, 0.4)',
      backgroundColor: 'rgba(59, 130, 246, 0.05)',
    },
    toolExecutionSuccess: {
      borderColor: 'rgba(34, 197, 94, 0.4)',
      backgroundColor: 'rgba(34, 197, 94, 0.05)',
    },
    toolExecutionError: {
      borderColor: 'rgba(239, 68, 68, 0.4)',
      backgroundColor: 'rgba(239, 68, 68, 0.05)',
    },
    toolExecutionCollapsed: {
      padding: spacing.sm,
    },
    toolParamsSection: {
      padding: spacing.sm,
      backgroundColor: 'rgba(59, 130, 246, 0.08)',
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(59, 130, 246, 0.2)',
    },
    toolParamsSectionTitle: {
      fontSize: 11,
      fontWeight: '600',
      color: 'rgb(59, 130, 246)',
      marginBottom: spacing.sm,
    },
    toolCallCard: {
      backgroundColor: theme.colors.muted,
      borderRadius: radius.md,
      padding: spacing.sm,
      marginBottom: spacing.xs,
    },
    toolName: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontWeight: '600',
      color: theme.colors.primary,
      fontSize: 12,
      marginBottom: spacing.xs,
    },
    toolParamsScroll: {
      maxHeight: 150,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    toolParamsCode: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.background,
      padding: spacing.sm,
      borderRadius: radius.sm,
    },
    toolResponseSection: {
      padding: spacing.sm,
    },
    toolResponsePending: {
      backgroundColor: 'rgba(59, 130, 246, 0.05)',
    },
    toolResponseSuccess: {
      backgroundColor: 'rgba(34, 197, 94, 0.05)',
    },
    toolResponseError: {
      backgroundColor: 'rgba(239, 68, 68, 0.05)',
    },
    toolResponseSectionTitle: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.mutedForeground,
      marginBottom: spacing.sm,
    },
    toolResponsePendingText: {
      fontSize: 11,
      fontStyle: 'italic',
      color: theme.colors.mutedForeground,
      textAlign: 'center',
      paddingVertical: spacing.sm,
    },
    toolResultItem: {
      marginBottom: spacing.sm,
    },
    toolResultHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    toolResultBadge: {
      fontSize: 11,
      fontWeight: '600',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.sm,
    },
    toolResultBadgeSuccess: {
      backgroundColor: 'rgba(34, 197, 94, 0.2)',
      color: '#22c55e',
    },
    toolResultBadgeError: {
      backgroundColor: 'rgba(239, 68, 68, 0.2)',
      color: '#ef4444',
    },
    toolResultScroll: {
      maxHeight: 150,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    toolResultCode: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.muted,
      padding: spacing.sm,
      borderRadius: radius.sm,
    },
    toolResultErrorSection: {
      marginTop: spacing.xs,
    },
    toolResultErrorLabel: {
      fontSize: 10,
      fontWeight: '500',
      color: '#ef4444',
      marginBottom: 2,
    },
    toolResultErrorText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10,
      color: '#ef4444',
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      padding: spacing.sm,
      borderRadius: radius.sm,
    },
  });
}
