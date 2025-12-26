import React, { useRef, useCallback, useEffect, useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Platform, GestureResponderEvent, NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../ui/ThemeProvider';
import { spacing, radius, Theme } from '../../../ui/theme';

interface InputControlsProps {
  input: string;
  setInput: (value: string) => void;
  listening: boolean;
  liveTranscript: string;
  handsFree: boolean;
  ttsEnabled: boolean;
  onSend: (text: string) => Promise<void>;
  onToggleTts: () => Promise<void>;
  startRecording: (e?: GestureResponderEvent) => Promise<void>;
  stopRecordingAndHandle: () => Promise<void>;
}

const minHoldMs = 200;

export function InputControls({
  input,
  setInput,
  listening,
  liveTranscript,
  handsFree,
  ttsEnabled,
  onSend,
  onToggleTts,
  startRecording,
  stopRecordingAndHandle,
}: InputControlsProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = createStyles(theme);

  const listeningRef = useRef<boolean>(listening);
  useEffect(() => { listeningRef.current = listening; }, [listening]);

  const lastGrantTimeRef = useRef(0);

  // Track modifier keys for keyboard shortcut handling
  const modifierKeysRef = useRef<{ shift: boolean; ctrl: boolean; meta: boolean }>({
    shift: false,
    ctrl: false,
    meta: false,
  });

  // Timeout ref for auto-resetting modifier state
  const modifierTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flag to suppress the next onChangeText update after native keyboard shortcut submission
  const suppressNextChangeRef = useRef(false);

  // Handle keyboard shortcuts for text submission
  const handleInputKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;

      // On web platform, we have access to modifier keys via nativeEvent
      if (Platform.OS === 'web') {
        const webEvent = e.nativeEvent as unknown as KeyboardEvent;
        const isEnter = key === 'Enter';
        const hasModifier = webEvent.shiftKey || webEvent.ctrlKey || webEvent.metaKey;

        if (isEnter && hasModifier) {
          e.preventDefault?.();
          webEvent.preventDefault?.();
          if (input.trim()) {
            onSend(input);
          }
        }
      } else {
        const setModifierWithTimeout = (modifier: 'shift' | 'ctrl' | 'meta') => {
          modifierKeysRef.current[modifier] = true;
          if (modifierTimeoutRef.current) {
            clearTimeout(modifierTimeoutRef.current);
          }
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
          if (modifierTimeoutRef.current) {
            clearTimeout(modifierTimeoutRef.current);
            modifierTimeoutRef.current = null;
          }
          const hasModifier =
            modifierKeysRef.current.shift ||
            modifierKeysRef.current.ctrl ||
            modifierKeysRef.current.meta;

          if (hasModifier) {
            suppressNextChangeRef.current = true;
            if (input.trim()) {
              onSend(input);
            }
          }
          modifierKeysRef.current = { shift: false, ctrl: false, meta: false };
        } else {
          if (modifierTimeoutRef.current) {
            clearTimeout(modifierTimeoutRef.current);
            modifierTimeoutRef.current = null;
          }
          modifierKeysRef.current = { shift: false, ctrl: false, meta: false };
        }
      }
    },
    [input, onSend]
  );

  const handleInputChange = useCallback((text: string) => {
    if (suppressNextChangeRef.current) {
      suppressNextChangeRef.current = false;
      return;
    }
    setInput(text);
  }, [setInput]);

  return (
    <View style={[styles.inputRow, { paddingBottom: 12 + insets.bottom }]}>
      <TouchableOpacity
        style={[styles.ttsToggle, ttsEnabled && styles.ttsToggleOn]}
        onPress={onToggleTts}
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
            if (!listeningRef.current) startRecording(e);
          } : undefined}
          onPressOut={!handsFree ? () => {
            const now = Date.now();
            const dt = now - lastGrantTimeRef.current;
            const delay = Math.max(0, minHoldMs - dt);
            if (delay > 0) {
              setTimeout(() => {
                if (listeningRef.current) stopRecordingAndHandle();
              }, delay);
            } else {
              if (listeningRef.current) stopRecordingAndHandle();
            }
          } : undefined}
          onPress={handsFree ? () => {
            if (!listeningRef.current) startRecording(); else stopRecordingAndHandle();
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
        onChangeText={handleInputChange}
        onKeyPress={handleInputKeyPress}
        placeholder={handsFree ? (listening ? 'Listening…' : 'Type or tap mic') : (listening ? 'Listening…' : 'Type or hold mic')}
        placeholderTextColor={theme.colors.mutedForeground}
        multiline
      />
      <TouchableOpacity style={styles.sendButton} onPress={() => onSend(input)}>
        <Text style={styles.sendButtonText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
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
  });
}
