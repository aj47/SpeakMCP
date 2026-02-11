import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ScrollView, Modal } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Speech from 'expo-speech';
import { useTheme } from './ThemeProvider';
import { Theme, spacing, radius } from './theme';

export type Voice = {
  identifier: string;
  name: string;
  quality: string;
  language: string;
};

type TTSSettingsProps = {
  voiceId?: string;
  rate: number;
  pitch: number;
  onVoiceChange: (voiceId: string | undefined) => void;
  onRateChange: (rate: number) => void;
  onPitchChange: (pitch: number) => void;
};

export function TTSSettings({
  voiceId,
  rate,
  pitch,
  onVoiceChange,
  onRateChange,
  onPitchChange,
}: TTSSettingsProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);

  useEffect(() => {
    loadVoices();
  }, []);

  useEffect(() => {
    if (voiceId && voices.length > 0) {
      const voice = voices.find(v => v.identifier === voiceId);
      setSelectedVoice(voice || null);
    }
  }, [voiceId, voices]);

  const loadVoices = async () => {
    try {
      const availableVoices = await Speech.getAvailableVoicesAsync();
      // Filter to English voices and sort by quality/name
      const englishVoices = availableVoices
        .filter(v => v.language.startsWith('en'))
        .sort((a, b) => {
          // Prefer higher quality voices
          if (a.quality !== b.quality) {
            return a.quality === 'Enhanced' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      setVoices(englishVoices);
    } catch (error) {
      console.error('[TTS] Failed to load voices:', error);
    }
  };

  const handleVoiceSelect = (voice: Voice | null) => {
    setSelectedVoice(voice);
    onVoiceChange(voice?.identifier);
    setShowVoicePicker(false);
  };

  const testVoice = () => {
    const options: Speech.SpeechOptions = {
      language: 'en-US',
      rate,
      pitch,
    };
    if (selectedVoice) {
      options.voice = selectedVoice.identifier;
    }
    Speech.speak('Hello! This is a test of the text to speech voice.', options);
  };

  return (
    <View style={styles.container}>
      {/* Voice Selection */}
      <View style={styles.row}>
        <Text style={styles.label}>Voice</Text>
        <TouchableOpacity
          style={styles.voiceSelector}
          onPress={() => setShowVoicePicker(true)}
        >
          <Text style={styles.voiceSelectorText} numberOfLines={1}>
            {selectedVoice?.name || 'System Default'}
          </Text>
          <Text style={styles.chevron}>▼</Text>
        </TouchableOpacity>
      </View>

      {/* Speech Rate */}
      <View style={styles.sliderRow}>
        <View style={styles.sliderHeader}>
          <Text style={styles.label}>Speed</Text>
          <Text style={styles.sliderValue}>{rate.toFixed(1)}x</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0.5}
          maximumValue={2.0}
          step={0.1}
          value={rate}
          onValueChange={onRateChange}
          minimumTrackTintColor={theme.colors.primary}
          maximumTrackTintColor={theme.colors.muted}
          thumbTintColor={theme.colors.primary}
        />
      </View>

      {/* Pitch */}
      <View style={styles.sliderRow}>
        <View style={styles.sliderHeader}>
          <Text style={styles.label}>Pitch</Text>
          <Text style={styles.sliderValue}>{pitch.toFixed(1)}</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0.5}
          maximumValue={2.0}
          step={0.1}
          value={pitch}
          onValueChange={onPitchChange}
          minimumTrackTintColor={theme.colors.primary}
          maximumTrackTintColor={theme.colors.muted}
          thumbTintColor={theme.colors.primary}
        />
      </View>

      {/* Test Button */}
      <TouchableOpacity style={styles.testButton} onPress={testVoice}>
        <Text style={styles.testButtonText}>🔊 Test Voice</Text>
      </TouchableOpacity>

      {/* Voice Picker Modal */}
      <Modal
        visible={showVoicePicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowVoicePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Voice</Text>
              <TouchableOpacity onPress={() => setShowVoicePicker(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.voiceList}>
              {/* System Default Option */}
              <TouchableOpacity
                style={[
                  styles.voiceItem,
                  !selectedVoice && styles.voiceItemSelected,
                ]}
                onPress={() => handleVoiceSelect(null)}
              >
                <Text style={[
                  styles.voiceItemText,
                  !selectedVoice && styles.voiceItemTextSelected,
                ]}>
                  System Default
                </Text>
              </TouchableOpacity>

              {voices.map((voice) => (
                <TouchableOpacity
                  key={voice.identifier}
                  style={[
                    styles.voiceItem,
                    selectedVoice?.identifier === voice.identifier && styles.voiceItemSelected,
                  ]}
                  onPress={() => handleVoiceSelect(voice)}
                >
                  <View>
                    <Text style={[
                      styles.voiceItemText,
                      selectedVoice?.identifier === voice.identifier && styles.voiceItemTextSelected,
                    ]}>
                      {voice.name}
                    </Text>
                    <Text style={styles.voiceItemSubtext}>
                      {voice.language} {voice.quality === 'Enhanced' ? '• Enhanced' : ''}
                    </Text>
                  </View>
                  {selectedVoice?.identifier === voice.identifier && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      marginTop: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    label: {
      fontSize: 16,
      color: theme.colors.foreground,
    },
    voiceSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.muted,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      maxWidth: '60%',
    },
    voiceSelectorText: {
      fontSize: 14,
      color: theme.colors.foreground,
      marginRight: spacing.sm,
      flex: 1,
    },
    chevron: {
      fontSize: 10,
      color: theme.colors.mutedForeground,
    },
    sliderRow: {
      paddingVertical: spacing.sm,
    },
    sliderHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    sliderValue: {
      fontSize: 14,
      color: theme.colors.mutedForeground,
    },
    slider: {
      width: '100%',
      height: 40,
    },
    testButton: {
      backgroundColor: theme.colors.muted,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    testButtonText: {
      fontSize: 14,
      color: theme.colors.foreground,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: '70%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.foreground,
    },
    modalClose: {
      fontSize: 20,
      color: theme.colors.mutedForeground,
      padding: spacing.sm,
    },
    voiceList: {
      padding: spacing.md,
    },
    voiceItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
    },
    voiceItemSelected: {
      backgroundColor: theme.colors.primary + '20',
    },
    voiceItemText: {
      fontSize: 16,
      color: theme.colors.foreground,
    },
    voiceItemTextSelected: {
      color: theme.colors.primary,
      fontWeight: '600',
    },
    voiceItemSubtext: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      marginTop: 2,
    },
    checkmark: {
      fontSize: 18,
      color: theme.colors.primary,
    },
  });

