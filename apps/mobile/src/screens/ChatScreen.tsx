import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  GestureResponderEvent,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventEmitter } from 'expo-modules-core';
import { useConfigContext, saveConfig } from '../store/config';
import { useSessionContext } from '../store/sessions';
import { OpenAIClient, ChatMessage, AgentProgressUpdate, AgentProgressStep } from '../lib/openaiClient';
import * as Speech from 'expo-speech';
import { useHeaderHeight } from '@react-navigation/elements';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme } from '../ui/theme';

// Threshold for collapsing long content
const COLLAPSE_THRESHOLD = 200;

export default function ChatScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
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

  // Create client early so it's available for handleKillSwitch
  const client = new OpenAIClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  });

  const handleKillSwitch = async () => {
    console.log('[ChatScreen] Kill switch button pressed');

    // Alert.alert doesn't work on web, use window.confirm for web platform
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

    // Native platforms use Alert.alert
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
  }, [navigation, handsFree, handleKillSwitch, theme]);


  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [responding, setResponding] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('');

  // Load messages from current session on mount
  const sessionLoadedRef = useRef(false);
  useEffect(() => {
    if (sessionLoadedRef.current) return;
    const currentSession = sessionStore.getCurrentSession();
    if (currentSession && currentSession.messages.length > 0) {
      // Convert session messages to ChatMessage format
      const chatMessages: ChatMessage[] = currentSession.messages.map(m => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolResults: m.toolResults,
      }));
      setMessages(chatMessages);
    }
    sessionLoadedRef.current = true;
  }, [sessionStore]);

  // Save messages to session when they change
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    // Only save if messages have actually changed (not on initial load)
    if (messages.length > 0 && messages.length !== prevMessagesLengthRef.current) {
      sessionStore.setMessages(messages);
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages, sessionStore]);

  // Track expanded state for messages (by index)
  const [expandedMessages, setExpandedMessages] = useState<Record<number, boolean>>({});
  const toggleMessageExpansion = useCallback((index: number) => {
    setExpandedMessages(prev => ({ ...prev, [index]: !prev[index] }));
  }, []);

  const [willCancel, setWillCancel] = useState(false);
  const startYRef = useRef<number | null>(null);

  // Track if native speech recognition is unavailable (shown once per session)
  const nativeSRUnavailableShownRef = useRef(false);

  // Web fallback state/refs
  const webRecognitionRef = useRef<any>(null);
  const webFinalRef = useRef<string>('');
  const liveTranscriptRef = useRef<string>('');
  const willCancelRef = useRef<boolean>(false);
  useEffect(() => { liveTranscriptRef.current = liveTranscript; }, [liveTranscript]);
  useEffect(() => { willCancelRef.current = willCancel; }, [willCancel]);

  // Debounce/guard and timing refs for voice interaction
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const lastGrantTimeRef = useRef(0);
  const minHoldMs = 200;

  // Native SR event handling (lazy-loaded to avoid Expo Go crash)
  const srEmitterRef = useRef<any>(null);
  const srSubsRef = useRef<any[]>([]);
  const nativeFinalRef = useRef<string>('');
  const cleanupNativeSubs = () => {
    srSubsRef.current.forEach((sub) => sub?.remove?.());
    srSubsRef.current = [];
  };
  // Cleanup native subscriptions on unmount
  useEffect(() => {
    return () => {
      cleanupNativeSubs();
    };
  }, []);


  const convoRef = useRef<string | undefined>(undefined);

  /**
   * Convert agent progress steps to display messages in real-time
   */
  const convertProgressToMessages = useCallback((update: AgentProgressUpdate): ChatMessage[] => {
    const messages: ChatMessage[] = [];

    // First, try to use steps array (sent in progress events)
    if (update.steps && update.steps.length > 0) {
      // Group steps into messages - each thinking/tool_call/tool_result becomes part of the conversation
      let currentToolCalls: any[] = [];
      let currentToolResults: any[] = [];
      let thinkingContent = '';

      for (const step of update.steps) {
        const stepContent = step.content || step.llmContent;
        if (step.type === 'thinking' && stepContent) {
          thinkingContent = stepContent;
        } else if (step.type === 'tool_call') {
          // Tool call step - extract both toolCall and toolResult if present
          if (step.toolCall) {
            currentToolCalls.push(step.toolCall);
          }
          // Some tool_call steps also have toolResult when completed
          if (step.toolResult) {
            currentToolResults.push(step.toolResult);
          }
        } else if (step.type === 'tool_result' && step.toolResult) {
          currentToolResults.push(step.toolResult);
        } else if (step.type === 'completion' && stepContent) {
          // Final completion content
          thinkingContent = stepContent;
        }
      }

      // Create a message showing current agent activity
      if (currentToolCalls.length > 0 || currentToolResults.length > 0 || thinkingContent) {
        messages.push({
          role: 'assistant',
          content: thinkingContent || (currentToolCalls.length > 0 ? 'Executing tools...' : ''),
          toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
          toolResults: currentToolResults.length > 0 ? currentToolResults : undefined,
        });
      }
    }

    // Also process conversation history if available (more complete data)
    if (update.conversationHistory && update.conversationHistory.length > 0) {
      // Find the latest user message index to determine where current turn starts
      let currentTurnStartIndex = 0;
      for (let i = 0; i < update.conversationHistory.length; i++) {
        if (update.conversationHistory[i].role === 'user') {
          currentTurnStartIndex = i;
        }
      }

      // Only use conversation history if it has messages beyond the user message
      // Otherwise, keep the steps-based messages which have real-time tool call data
      const hasAssistantMessages = currentTurnStartIndex + 1 < update.conversationHistory.length;
      if (hasAssistantMessages) {
        // Clear steps-based messages and use conversation history instead
        messages.length = 0;

        // Add messages from the current turn (skip the user message)
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

    // If we have streaming content, add or update the last assistant message
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
    // Track the number of messages BEFORE this turn to avoid duplicates
    const messageCountBeforeTurn = messages.length;
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: 'Assistant is thinking...' }]);
    setResponding(true);

    setInput('');
    try {
      let streamingText = '';
      console.log('[ChatScreen] Starting chat request with', messages.length + 1, 'messages');
      setDebugInfo('Request sent, waiting for response...');

      // Handle real-time progress updates
      const onProgress = (update: AgentProgressUpdate) => {
        // Convert progress to messages and update UI in real-time
        const progressMessages = convertProgressToMessages(update);
        if (progressMessages.length > 0) {
          setMessages((m) => {
            // Keep messages up to and including the user message
            const beforePlaceholder = m.slice(0, messageCountBeforeTurn + 1);
            const newMessages = [...beforePlaceholder, ...progressMessages];
            return newMessages;
          });
        }
      };

      // Handle streaming text tokens
      const onToken = (tok: string) => {
        streamingText += tok;

        setMessages((m) => {
          const copy = [...m];
          // Update the last assistant message incrementally
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              copy[i] = { ...copy[i], content: streamingText };
              break;
            }
          }
          return copy;
        });
      };

      const response = await client.chat([...messages, userMsg], onToken, onProgress);
      const finalText = response.content || streamingText;
      console.log('[ChatScreen] Chat completed');
      setDebugInfo(`Completed!`);

      // Process conversation history to extract tool calls and results
      if (response.conversationHistory && response.conversationHistory.length > 0) {

        // Find where the current turn starts in the conversation history
        let currentTurnStartIndex = 0;
        for (let i = 0; i < response.conversationHistory.length; i++) {
          if (response.conversationHistory[i].role === 'user') {
            currentTurnStartIndex = i;
          }
        }

        // Build new messages only from the current turn (from user message onward)
        const newMessages: ChatMessage[] = [];
        for (let i = currentTurnStartIndex; i < response.conversationHistory.length; i++) {
          const historyMsg = response.conversationHistory[i];
          // Skip the user message (we already have it)
          if (historyMsg.role === 'user') continue;

          // Add assistant or tool messages with their tool data
          newMessages.push({
            role: historyMsg.role === 'tool' ? 'assistant' : historyMsg.role,
            content: historyMsg.content || '',
            toolCalls: historyMsg.toolCalls,
            toolResults: historyMsg.toolResults,
          });
        }

        // Replace only the placeholder with the new messages from this turn
        setMessages((m) => {
          const beforePlaceholder = m.slice(0, messageCountBeforeTurn + 1);
          return [...beforePlaceholder, ...newMessages];
        });
      } else if (finalText) {
        // Fallback: just update the assistant message content
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

      // Only speak the final response if TTS is enabled (default: true for backward compat)
      if (finalText && config.ttsEnabled !== false) {
        Speech.speak(finalText, { language: 'en-US' });
      }
    } catch (e: any) {
      console.error('[ChatScreen] Chat error:', e);
      console.error('[ChatScreen] Error details:', {
        message: e.message,
        stack: e.stack,
        name: e.name
      });
      setDebugInfo(`Error: ${e.message}`);
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      console.log('[ChatScreen] Chat request finished');
      setResponding(false);
      setTimeout(() => setDebugInfo(''), 3000); // Clear debug info after 3 seconds
    }
  };

  // Real-time speech results (web handled in ensureWebRecognizer; native listeners are attached on start)

  // Ensure Web Speech API recognizer exists and is wired
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
      rec.continuous = handsFreeRef.current;
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
            setLiveTranscript('');
            webFinalRef.current = '';
            const toSend = finalText.trim();
            if (toSend) send(toSend);
          } else {
            webFinalRef.current += finalText;
          }
        }
      };
      rec.onend = () => {
        const finalText = (webFinalRef.current || '').trim() || (liveTranscriptRef.current || '').trim();
        setListening(false);
        setLiveTranscript('');
        const willEdit = willCancelRef.current;
        if (!handsFreeRef.current && finalText) {
          if (willEdit) setInput((t) => (t ? `${t} ${finalText}` : finalText));
          else send(finalText);
        }
        webFinalRef.current = '';
      };
      webRecognitionRef.current = rec;
    }
    return true;
  };

  // Native 'end' event handled via lazy listener; web handled in ensureWebRecognizer onend

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
      if (e) startYRef.current = e.nativeEvent.pageY;

      // Try native first via dynamic import (avoids Expo Go crash when module is unavailable)
      if (Platform.OS !== 'web') {
        try {
          const SR: any = await import('expo-speech-recognition');
          if (SR?.ExpoSpeechRecognitionModule?.start) {
            // Attach listeners
            if (!srEmitterRef.current) {
              srEmitterRef.current = new EventEmitter(SR.ExpoSpeechRecognitionModule);
            }
            cleanupNativeSubs();
            const subResult = srEmitterRef.current.addListener('result', (event: any) => {
              const t = event?.results?.[0]?.transcript ?? event?.text ?? event?.transcript ?? '';
              if (t) setLiveTranscript(t);
              if (event?.isFinal && t) {
                if (handsFreeRef.current) {
                  const final = t.trim();
                  nativeFinalRef.current = '';
                  setLiveTranscript('');
                  if (final) send(final);
                } else {
                  nativeFinalRef.current = t;
                }
              }
            });
            const subError = srEmitterRef.current.addListener('error', (event: any) => {
              console.error('[Voice] Native recognition error:', JSON.stringify(event));
            });
            const subEnd = srEmitterRef.current.addListener('end', () => {
              setListening(false);
              const finalText = (nativeFinalRef.current || liveTranscriptRef.current || '').trim();
              setLiveTranscript('');
              const willEdit = willCancelRef.current;
              if (!handsFreeRef.current && finalText) {
                if (willEdit) setInput((t) => (t ? `${t} ${finalText}` : finalText));
                else send(finalText);
              }
              nativeFinalRef.current = '';
            });
            srSubsRef.current.push(subResult, subError, subEnd);

            // Permissions flow
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

            // Start recognition
            try {
              SR.ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: handsFreeRef.current, volumeChangeEventOptions: { enabled: handsFreeRef.current, intervalMillis: 250 } });
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

          // Show alert once per session if native module is missing
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

      // Web fallback
      if (ensureWebRecognizer()) {
        try {
          webFinalRef.current = '';
          if (webRecognitionRef.current) {
            try { webRecognitionRef.current.continuous = handsFreeRef.current; } catch {}
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
    try {
      // If nothing is recording, ignore
      const hasWeb = Platform.OS === 'web' && webRecognitionRef.current;
      if (!listening && !hasWeb) {
        return;
      }

      if (Platform.OS !== 'web') {
        try {
          const SR: any = await import('expo-speech-recognition');
          if (SR?.ExpoSpeechRecognitionModule?.stop) {
            SR.ExpoSpeechRecognitionModule.stop();
            // Finalization handled in 'end' listener
          }
        } catch (err) {
          console.warn('[Voice] Native stop unavailable (likely Expo Go):', (err as any)?.message || err);
        }
      }

      if (Platform.OS === 'web' && webRecognitionRef.current) {
        try {
          webRecognitionRef.current.stop();
          // onend will finalize
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
          style={{ flex: 1, padding: spacing.lg, backgroundColor: theme.colors.background }}
          contentContainerStyle={{ paddingBottom: insets.bottom }}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
        >
          {messages.map((m, i) => {
            const hasExtras = (m.toolCalls?.length ?? 0) > 0 || (m.toolResults?.length ?? 0) > 0;
            const shouldCollapse = (m.content?.length ?? 0) > COLLAPSE_THRESHOLD || hasExtras;
            const isExpanded = expandedMessages[i] ?? false;

            return (
              <View key={i} style={[styles.msg, m.role === 'user' ? styles.user : styles.assistant]}>
                {/* Header row with role and expand/collapse button */}
                <View style={styles.messageHeader}>
                  <Text style={styles.role}>{m.role}</Text>
                  {(m.toolCalls?.length ?? 0) > 0 && (
                    <View style={styles.toolBadgeSmall}>
                      <Text style={styles.toolBadgeSmallText}>{m.toolCalls!.length} tool{m.toolCalls!.length > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                  {(m.toolResults?.length ?? 0) > 0 && (
                    <View style={[styles.toolBadgeSmall, styles.resultBadgeSmall]}>
                      <Text style={styles.toolBadgeSmallText}>{m.toolResults!.length} result{m.toolResults!.length > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                  {shouldCollapse && (
                    <Pressable
                      onPress={() => toggleMessageExpansion(i)}
                      style={styles.expandButton}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={styles.expandButtonText}>
                        {isExpanded ? '▲ Collapse' : '▼ Expand'}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {m.role === 'assistant' && (!m.content || m.content.length === 0) && !m.toolCalls && !m.toolResults ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color={theme.colors.foreground} />
                    <Text style={{ color: theme.colors.foreground }}>Assistant is thinking</Text>
                  </View>
                ) : (
                  <>
                    {/* Content - truncate if not expanded and long */}
                    {m.content ? (
                      <Text
                        style={{ color: theme.colors.foreground }}
                        numberOfLines={!isExpanded && shouldCollapse ? 3 : undefined}
                      >
                        {m.content}
                      </Text>
                    ) : null}

                    {/* Tool Calls - only show when expanded */}
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
                                <ScrollView horizontal style={styles.toolParamsScroll}>
                                  <Text style={styles.toolParamsCode}>
                                    {JSON.stringify(toolCall.arguments, null, 2)}
                                  </Text>
                                </ScrollView>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Collapsed tool calls summary */}
                    {!isExpanded && m.toolCalls && m.toolCalls.length > 0 && (
                      <View style={styles.collapsedToolSummary}>
                        <Text style={styles.collapsedToolText}>
                          🔧 {m.toolCalls.map(tc => tc.name).join(', ')}
                        </Text>
                      </View>
                    )}

                    {/* Tool Results - only show when expanded */}
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
                              <ScrollView horizontal style={styles.toolResultScroll}>
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

                    {/* Collapsed tool results summary */}
                    {!isExpanded && m.toolResults && m.toolResults.length > 0 && (
                      <View style={styles.collapsedToolSummary}>
                        <Text style={styles.collapsedToolText}>
                          {m.toolResults.every(r => r.success) ? '✅' : '⚠️'} {m.toolResults.length} result{m.toolResults.length > 1 ? 's' : ''}
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </View>
            );
          })}
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
          {/* TTS Toggle Button */}
          <TouchableOpacity
            style={[styles.ttsToggle, ttsEnabled && styles.ttsToggleOn]}
            onPress={toggleTts}
            activeOpacity={0.7}
          >
            <Text style={styles.ttsToggleText}>{ttsEnabled ? '🔊' : '🔇'}</Text>
          </TouchableOpacity>
          {/* Large Mic Button */}
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

// Create dynamic styles based on theme
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
    role: {
      ...theme.typography.caption,
      marginBottom: spacing.xs,
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
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      borderRadius: radius.sm,
    },
    resultBadgeSmall: {
      backgroundColor: theme.colors.secondary,
    },
    toolBadgeSmallText: {
      fontSize: 10,
      color: theme.colors.mutedForeground,
    },
    expandButton: {
      marginLeft: 'auto',
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    expandButtonText: {
      fontSize: 11,
      color: theme.colors.primary,
      fontWeight: '500',
    },
    collapsedToolSummary: {
      marginTop: spacing.xs,
      paddingVertical: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    collapsedToolText: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
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
      maxHeight: 120,
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
      maxHeight: 120,
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
