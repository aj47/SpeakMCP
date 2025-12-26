import { useState, useRef, useCallback, useEffect } from 'react';
import { Platform, Alert, GestureResponderEvent } from 'react-native';
import { EventEmitter } from 'expo-modules-core';

export interface VoiceInputManagerResult {
  listening: boolean;
  liveTranscript: string;
  willCancel: boolean;
  startRecording: (e?: GestureResponderEvent) => Promise<void>;
  stopRecordingAndHandle: () => Promise<void>;
}

interface UseVoiceInputManagerProps {
  handsFree: boolean;
  onSend: (text: string) => Promise<void>;
  setInput: (value: string | ((prev: string) => string)) => void;
}

const handsFreeDebounceMs = 1500;
const minHoldMs = 200;

export function useVoiceInputManager({
  handsFree,
  onSend,
  setInput,
}: UseVoiceInputManagerProps): VoiceInputManagerResult {
  const [listening, setListening] = useState(false);
  const listeningRef = useRef<boolean>(listening);
  useEffect(() => { listeningRef.current = listening; }, [listening]);
  const setListeningValue = useCallback((v: boolean) => {
    listeningRef.current = v;
    setListening(v);
  }, []);

  const [liveTranscript, setLiveTranscript] = useState('');
  const liveTranscriptRef = useRef<string>('');
  useEffect(() => { liveTranscriptRef.current = liveTranscript; }, [liveTranscript]);
  const setLiveTranscriptValue = useCallback((t: string) => {
    liveTranscriptRef.current = t;
    setLiveTranscript(t);
  }, []);

  const [willCancel, setWillCancel] = useState(false);
  const willCancelRef = useRef<boolean>(false);
  useEffect(() => { willCancelRef.current = willCancel; }, [willCancel]);

  const handsFreeRef = useRef<boolean>(handsFree);
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);

  const sendRef = useRef<(text: string) => Promise<void>>(onSend);
  useEffect(() => { sendRef.current = onSend; }, [onSend]);

  // Voice debug logging (dev-only)
  const voiceLogSeqRef = useRef(0);
  const voiceLog = useCallback((msg: string, extra?: any) => {
    if (!__DEV__) return;
    voiceLogSeqRef.current += 1;
    const seq = voiceLogSeqRef.current;
    if (typeof extra !== 'undefined') console.log(`[Voice ${seq}] ${msg}`, extra);
    else console.log(`[Voice ${seq}] ${msg}`);
  }, []);

  const startYRef = useRef<number | null>(null);
  const nativeSRUnavailableShownRef = useRef(false);

  const webRecognitionRef = useRef<any>(null);
  const webFinalRef = useRef<string>('');
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

  // Merge accumulated final transcript with the latest live transcript
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

  // Used to dedupe push-to-talk finalization
  const voiceGestureIdRef = useRef(0);
  const voiceGestureFinalizedIdRef = useRef(0);

  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const lastGrantTimeRef = useRef(0);
  const userReleasedButtonRef = useRef(false);

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
            const accumulatedText = mergeVoiceText(webFinalRef.current, liveTranscriptRef.current);
            setLiveTranscriptValue('');
            if (accumulatedText) {
              setInput((t) => (t ? `${t} ${accumulatedText}` : accumulatedText));
            }
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
      // New push-to-talk gesture/session
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
                  const accumulatedText = mergeVoiceText(nativeFinalRef.current, liveTranscriptRef.current);
                  setLiveTranscriptValue('');
                  if (accumulatedText) {
                    setInput((t) => (t ? `${t} ${accumulatedText}` : accumulatedText));
                  }
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

  return {
    listening,
    liveTranscript,
    willCancel,
    startRecording,
    stopRecordingAndHandle,
  };
}
