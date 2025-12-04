import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventEmitter } from 'expo-modules-core';
import { useConfigContext, saveConfig } from '../store/config';
import { OpenAIClient, ChatMessage } from '../lib/openaiClient';
import * as Speech from 'expo-speech';
import { useHeaderHeight } from '@react-navigation/elements';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme } from '../ui/theme';

export default function ChatScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { config, setConfig } = useConfigContext();
  const handsFree = !!config.handsFree;
  const handsFreeRef = useRef<boolean>(handsFree);
  useEffect(() => { handsFreeRef.current = !!config.handsFree; }, [config.handsFree]);

  const toggleHandsFree = async () => {
    const next = !handsFreeRef.current;
    const nextCfg = { ...config, handsFree: next } as any;
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
        console.log('[ChatScreen] Kill switch confirmed (web), calling API...');
        try {
          const result = await client.killSwitch();
          console.log('[ChatScreen] Kill switch result:', result);
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
            console.log('[ChatScreen] Kill switch confirmed, calling API...');
            try {
              const result = await client.killSwitch();
              console.log('[ChatScreen] Kill switch result:', result);
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
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
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
        </View>
      ),
    });
  }, [navigation, handsFree, handleKillSwitch]);


  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [responding, setResponding] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('');

  const [willCancel, setWillCancel] = useState(false);
  const startYRef = useRef<number | null>(null);

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

  const send = async (text: string) => {
    if (!text.trim()) return;

    console.log('[ChatScreen] Sending message:', text);
    console.log('[ChatScreen] Platform:', Platform.OS);
    console.log('[ChatScreen] Current config:', {
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyLength: config.apiKey?.length || 0
    });

    setDebugInfo(`Starting request to ${config.baseUrl}...`);

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: '' }]);
    setResponding(true);

    setInput('');
    try {
      let full = '';
      console.log('[ChatScreen] Starting chat request with', messages.length + 1, 'messages');
      setDebugInfo('Request sent, waiting for response...');
      const reply = await client.chat([...messages, userMsg], (tok) => {
        full += tok;
        console.log('[ChatScreen] Token received:', tok);
        setDebugInfo(`Receiving tokens... (${full.length} chars so far)`);

        setMessages((m) => {
          const copy = [...m];
          // Update the last assistant message incrementally
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              copy[i] = { ...copy[i], content: (copy[i].content || '') + tok };
              break;
            }
          }
          return copy;
        });
      });
      const finalText = reply || full;
      console.log('[ChatScreen] Chat completed, final text length:', finalText?.length || 0);
      setDebugInfo(`Completed! Received ${finalText?.length || 0} characters`);

      if (finalText) {
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
      rec.onerror = (ev: any) => console.warn('[Voice] web recognition error', ev?.error || ev);
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
    if (startingRef.current || listening) { return; }
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
              console.warn('[Voice] recognition error', event);
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
              console.warn('[Voice] permission check/request failed', perr);
            }

            // Start recognition
            try {
              SR.ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: handsFreeRef.current, volumeChangeEventOptions: { enabled: handsFreeRef.current, intervalMillis: 250 } });
            } catch (serr) {
              console.warn('[Voice] native start error', serr);
              setListening(false);
            }
            startingRef.current = false;
            return;
          }
        } catch (err) {
          console.warn('[Voice] native SR unavailable (likely Expo Go):', (err as any)?.message || err);
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
          console.warn('[Voice] web start error', err);
          setListening(false);
          startingRef.current = false;
        }
      } else {
        setListening(false);
        startingRef.current = false;
      }
    } catch (err) {
      console.warn('[Voice] startRecording error', err);
      setListening(false);
      startingRef.current = false;
    }
  };

  const stopRecordingAndHandle = async () => {
    if (stoppingRef.current) { return; }
    stoppingRef.current = true;
    try {
      // If nothing is recording, ignore
      const hasWeb = Platform.OS === 'web' && webRecognitionRef.current;
      if (!listening && !hasWeb) return;

      if (Platform.OS !== 'web') {
        try {
          const SR: any = await import('expo-speech-recognition');
          if (SR?.ExpoSpeechRecognitionModule?.stop) {
            SR.ExpoSpeechRecognitionModule.stop();
            // Finalization handled in 'end' listener
          }
        } catch (err) {
          console.warn('[Voice] native stop unavailable (likely Expo Go):', (err as any)?.message || err);
        }
      }

      if (Platform.OS === 'web' && webRecognitionRef.current) {
        try {
          webRecognitionRef.current.stop();
          // onend will finalize
        } catch (err) {
          console.warn('[Voice] web stop error', err);
          setListening(false);
        }
      }
    } catch (err) {
      console.warn('[Voice] stopRecording error', err);
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
          {messages.map((m, i) => (
            <View key={i} style={[styles.msg, m.role === 'user' ? styles.user : styles.assistant]}>
              <Text style={styles.role}>{m.role}</Text>
              {m.role === 'assistant' && (!m.content || m.content.length === 0) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color={theme.colors.foreground} />
                  <Text style={{ color: theme.colors.foreground }}>Assistant is thinking</Text>
                </View>
              ) : (
                <Text style={{ color: theme.colors.foreground }}>{m.content}</Text>
              )}
            </View>
          ))}
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
              <Text style={{ color: listening ? theme.colors.primaryForeground : theme.colors.foreground }}>
                {handsFree ? (listening ? 'Listening… Tap to Stop' : 'Tap to Talk') : (listening ? 'Recording…' : 'Hold to Talk')}
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={handsFree ? (listening ? 'Listening…' : 'Type a message or tap the mic') : (listening ? 'Listening…' : 'Type a message or hold the mic')}
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
      borderRadius: radius.lg,
    },
    mic: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
    },
    micOn: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
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
  });
}
