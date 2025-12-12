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
import { OpenAIClient, ChatMessage, AgentProgressUpdate } from '../lib/openaiClient';
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

  const client = useMemo(() => {
    const openAIClient = new OpenAIClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      recoveryConfig: {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        heartbeatIntervalMs: 30000,
      },
    });

    openAIClient.setConnectionStatusCallback((state) => {
      setConnectionState(state);
      console.log('[ChatScreen] Connection status:', formatConnectionStatus(state));
    });

    return openAIClient;
  }, [config.baseUrl, config.apiKey, config.model]);

  useEffect(() => {
    return () => {
      client.cleanup();
    };
  }, [client]);

  const handleKillSwitch = async () => {
    console.log('[ChatScreen] Kill switch button pressed');

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

  // Auto-scroll state and ref for mobile chat
  const scrollViewRef = useRef<ScrollView>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  // Track pending scroll to avoid clearing timeout on rapid message updates
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrollPendingRef = useRef(false);
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
      isScrollPendingRef.current = false;
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
  // Uses a pending flag to avoid clearing timeout during rapid streaming updates
  useEffect(() => {
    if (shouldAutoScroll && scrollViewRef.current && !isScrollPendingRef.current) {
      isScrollPendingRef.current = true;
      // Use a small delay to ensure content has rendered
      scrollTimeoutRef.current = setTimeout(() => {
        // Double-check auto-scroll is still enabled before scrolling
        // This guards against race conditions where user scrolled up during the delay
        if (shouldAutoScrollRef.current) {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }
        isScrollPendingRef.current = false;
      }, 100);
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

    if (!currentSession) {
      currentSession = sessionStore.createNewSession();
    }

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
  }, [sessionStore.currentSessionId, sessionStore]);

  const prevMessagesLengthRef = useRef(0);
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentSessionId = sessionStore.currentSessionId;

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
  }, [messages, sessionStore, sessionStore.currentSessionId]);

  const [expandedMessages, setExpandedMessages] = useState<Record<number, boolean>>({});
  const toggleMessageExpansion = useCallback((index: number) => {
    setExpandedMessages(prev => ({ ...prev, [index]: !prev[index] }));
  }, []);

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

    setDebugInfo(`Starting request to ${config.baseUrl}...`);

    const userMsg: ChatMessage = { role: 'user', content: text };
    const messageCountBeforeTurn = messages.length;
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: 'Assistant is thinking...' }]);
    setResponding(true);

    // Generate a unique request ID and mark this request as the active one
    // This prevents cross-request race conditions on view-level state
    const thisRequestId = Date.now();
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

    try {
      let streamingText = '';

      const serverConversationId = sessionStore.getServerConversationId();
      console.log('[ChatScreen] Starting chat request with', messages.length + 1, 'messages, conversationId:', serverConversationId || 'new');
      setDebugInfo('Request sent, waiting for response...');

      const onProgress = (update: AgentProgressUpdate) => {
        // Guard: skip update if session has changed since request started
        if (sessionStore.currentSessionId !== requestSessionId) {
          console.log('[ChatScreen] Session changed, skipping onProgress update');
          return;
        }
        // Guard: skip update if this request is no longer the active one
        // This prevents concurrent sends within the same session from interleaving updates
        if (activeRequestIdRef.current !== thisRequestId) {
          console.log('[ChatScreen] Request superseded, skipping onProgress update');
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
        if (sessionStore.currentSessionId !== requestSessionId) {
          console.log('[ChatScreen] Session changed, skipping onToken update');
          return;
        }
        // Guard: skip update if this request is no longer the active one
        // This prevents concurrent sends within the same session from interleaving updates
        if (activeRequestIdRef.current !== thisRequestId) {
          console.log('[ChatScreen] Request superseded, skipping onToken update');
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
      setDebugInfo(`Completed!`);

      // Guard: skip final updates if session has changed since request started
      if (sessionStore.currentSessionId !== requestSessionId) {
        console.log('[ChatScreen] Session changed during request, skipping final message updates');
        return;
      }

      // Guard: skip final updates if this request is no longer the active one
      // This prevents older, superseded requests from clobbering messages when multiple sends occur within the same session
      if (activeRequestIdRef.current !== thisRequestId) {
        console.log('[ChatScreen] Request superseded, skipping final message updates', {
          thisRequestId,
          activeRequestId: activeRequestIdRef.current
        });
        return;
      }

      if (response.conversationId) {
        await sessionStore.setServerConversationId(response.conversationId);
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

        setMessages((m) => {
          console.log('[ChatScreen] Current messages before update:', m.length);
          const beforePlaceholder = m.slice(0, messageCountBeforeTurn + 1);
          console.log('[ChatScreen] beforePlaceholder count:', beforePlaceholder.length);
          const result = [...beforePlaceholder, ...newMessages];
          console.log('[ChatScreen] Final messages count:', result.length);
          return result;
        });
      } else if (finalText) {
        console.log('[ChatScreen] FALLBACK: No conversationHistory, using finalText only. response.conversationHistory:', response.conversationHistory);
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
      } else {
        console.log('[ChatScreen] WARNING: No conversationHistory and no finalText!');
      }

      if (response.conversationId) {
        console.log('[ChatScreen] Saving server conversation ID:', response.conversationId);
        sessionStore.setServerConversationId(response.conversationId);
      }

      if (finalText && config.ttsEnabled !== false) {
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
      if (sessionStore.currentSessionId !== requestSessionId) {
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
      // Only reset UI states if this request is still the active one
      // This prevents an old request from clobbering state if a new request started
      // (e.g., user switched sessions and started a new chat mid-request)
      if (activeRequestIdRef.current === thisRequestId) {
        setResponding(false);
        setConnectionState(null);
        // Guard the setTimeout callback: only clear debugInfo if this request
        // is still the active one when the timeout fires. This prevents an
        // old request's delayed clear from wiping debug info for a newer request.
        const capturedRequestId = thisRequestId;
        setTimeout(() => {
          if (activeRequestIdRef.current === capturedRequestId) {
            setDebugInfo('');
          }
        }, 5000);
      } else {
        console.log('[ChatScreen] Skipping finally state resets: newer request is active', {
          thisRequestId,
          activeRequestId: activeRequestIdRef.current
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
            const isExpanded = expandedMessages[i] ?? false;
            const roleIcon = getRoleIcon(m.role as 'user' | 'assistant' | 'tool');
            const roleLabel = getRoleLabel(m.role as 'user' | 'assistant' | 'tool');

            const hasToolResults = (m.toolResults?.length ?? 0) > 0;
            const allSuccess = hasToolResults && m.toolResults!.every(r => r.success);
            const hasErrors = hasToolResults && m.toolResults!.some(r => !r.success);
            const isPending = (m.toolCalls?.length ?? 0) > 0 && !hasToolResults;

            const toolPreview = !isExpanded && m.toolCalls && m.toolCalls.length > 0 && m.toolCalls[0]?.arguments
              ? formatArgumentsPreview(m.toolCalls[0].arguments)
              : null;

            return (
              <Pressable
                key={i}
                disabled={!shouldCollapse}
                onPress={shouldCollapse ? () => toggleMessageExpansion(i) : undefined}
                accessibilityRole={shouldCollapse ? 'button' : undefined}
                accessibilityHint={
                  shouldCollapse
                    ? (isExpanded ? 'Collapse message' : 'Expand message')
                    : undefined
                }
                accessibilityState={shouldCollapse ? { expanded: isExpanded } : undefined}
                style={({ pressed }) => [
                  styles.msg,
                  m.role === 'user' ? styles.user : styles.assistant,
                  shouldCollapse && !isExpanded && pressed && styles.msgPressed,
                ]}
              >
                <View style={styles.messageHeader}>
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
                </View>

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

                    {!isExpanded && m.toolCalls && m.toolCalls.length > 0 && (
                      <View style={styles.collapsedToolSummary}>
                        {toolPreview && (
                          <Text style={styles.collapsedToolPreview} numberOfLines={1}>
                            {toolPreview}
                          </Text>
                        )}
                      </View>
                    )}

                    {isExpanded && m.toolCalls && m.toolCalls.length > 0 && (
                      <View style={styles.toolSection}>
                        <Text style={styles.toolSectionTitle}>Tool Calls ({m.toolCalls.length}):</Text>
                        {m.toolCalls.map((toolCall, idx) => (
                          <View key={idx} style={styles.toolCallCard}>
                            <View style={styles.toolCallHeader}>
                              <Text style={styles.toolName}>{toolCall.name}</Text>
                              <Text style={styles.toolBadge}>Tool {idx + 1}</Text>
                            </View>
                            {toolCall.arguments && (
                              <View style={styles.toolParams}>
                                <Text style={styles.toolParamsLabel}>Parameters:</Text>
                                <ScrollView style={styles.toolParamsScroll} nestedScrollEnabled>
                                  <Text style={styles.toolParamsCode}>
                                    {formatToolArguments(toolCall.arguments)}
                                  </Text>
                                </ScrollView>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    {isExpanded && m.toolResults && m.toolResults.length > 0 && (
                      <View style={styles.toolSection}>
                        <Text style={styles.toolSectionTitle}>Tool Results ({m.toolResults.length}):</Text>
                        {m.toolResults.map((result, idx) => (
                          <View
                            key={idx}
                            style={[
                              styles.toolResultCard,
                              result.success ? styles.toolResultSuccess : styles.toolResultError
                            ]}
                          >
                            <View style={styles.toolResultHeader}>
                              <Text style={[
                                styles.toolResultBadge,
                                result.success ? styles.toolResultBadgeSuccess : styles.toolResultBadgeError
                              ]}>
                                {result.success ? '✅ Success' : '❌ Error'}
                              </Text>
                              <Text style={styles.toolResultIndex}>Result {idx + 1}</Text>
                            </View>
                            <View style={styles.toolResultContent}>
                              <Text style={styles.toolResultLabel}>Content:</Text>
                              <ScrollView style={styles.toolResultScroll} nestedScrollEnabled>
                                <Text style={styles.toolResultCode}>
                                  {result.content || 'No content returned'}
                                </Text>
                              </ScrollView>
                            </View>
                            {result.error && (
                              <View style={styles.toolResultErrorSection}>
                                <Text style={styles.toolResultErrorLabel}>Error Details:</Text>
                                <Text style={styles.toolResultErrorText}>{result.error}</Text>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    {!isExpanded && m.toolResults && m.toolResults.length > 0 && (
                      <View style={styles.collapsedResultsSummary}>
                        <Text style={[
                          styles.collapsedToolText,
                          allSuccess && styles.collapsedToolTextSuccess,
                          hasErrors && styles.collapsedToolTextError,
                        ]}>
                          {getToolResultsSummary(m.toolResults)}
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </Pressable>
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
    msgPressed: {
      opacity: 0.8,
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
    collapsedToolSummary: {
      marginTop: spacing.xs,
    },
    collapsedResultsSummary: {
      marginTop: spacing.xs,
      paddingTop: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    collapsedToolPreview: {
      fontSize: 11,
      color: theme.colors.mutedForeground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      opacity: 0.7,
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
    // Tool calls and results styles
    toolSection: {
      marginTop: spacing.md,
    },
    toolSectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.mutedForeground,
      marginBottom: spacing.sm,
    },
    toolCallCard: {
      backgroundColor: theme.colors.muted,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    toolCallHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    toolName: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontWeight: '600',
      color: theme.colors.primary,
      fontSize: 13,
    },
    toolBadge: {
      fontSize: 10,
      color: theme.colors.mutedForeground,
      backgroundColor: theme.colors.background,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    toolParams: {
      marginTop: spacing.xs,
    },
    toolParamsLabel: {
      fontSize: 11,
      fontWeight: '500',
      color: theme.colors.mutedForeground,
      marginBottom: 4,
    },
    toolParamsScroll: {
      maxHeight: 200,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    toolParamsCode: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.background,
      padding: spacing.sm,
      borderRadius: radius.sm,
    },
    toolResultCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    toolResultSuccess: {
      backgroundColor: 'rgba(34, 197, 94, 0.1)',
      borderColor: 'rgba(34, 197, 94, 0.3)',
    },
    toolResultError: {
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderColor: 'rgba(239, 68, 68, 0.3)',
    },
    toolResultHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
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
    toolResultIndex: {
      fontSize: 10,
      color: theme.colors.mutedForeground,
    },
    toolResultContent: {
      marginTop: spacing.xs,
    },
    toolResultLabel: {
      fontSize: 11,
      fontWeight: '500',
      color: theme.colors.mutedForeground,
      marginBottom: 4,
    },
    toolResultScroll: {
      maxHeight: 200,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    toolResultCode: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.background,
      padding: spacing.sm,
      borderRadius: radius.sm,
    },
    toolResultErrorSection: {
      marginTop: spacing.sm,
    },
    toolResultErrorLabel: {
      fontSize: 11,
      fontWeight: '500',
      color: '#ef4444',
      marginBottom: 4,
    },
    toolResultErrorText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: '#ef4444',
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      padding: spacing.sm,
      borderRadius: radius.sm,
    },
  });
}
