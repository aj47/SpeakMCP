import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { useTheme } from './ThemeProvider';
import { spacing, radius } from './theme';

interface TTSSettingsProps {
  voiceId?: string;
  rate: number;
  pitch: number;
  onVoiceChange: (voiceId: string | undefined) => void;
  onRateChange: (rate: number) => void;
  onPitchChange: (pitch: number) => void;
}

interface VoiceInfo {
  identifier: string;
  name: string;
  language: string;
  quality?: string;
}

/**
 * TTS voice settings component with voice selection, rate, and pitch controls.
 * Uses expo-speech for voice listing and preview.
 */
export function TTSSettings({ voiceId, rate, pitch, onVoiceChange, onRateChange, onPitchChange }: TTSSettingsProps) {
  const { theme } = useTheme();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadVoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const availableVoices = await Speech.getAvailableVoicesAsync();
      // Filter to English voices and sort by quality
      const englishVoices = availableVoices
        .filter(v => v.language.startsWith('en'))
        .map(v => ({
          identifier: v.identifier,
          name: v.name,
          language: v.language,
          quality: (v as any).quality,
        }))
        .sort((a, b) => {
          // Sort enhanced/premium voices first
          const aQuality = a.quality === 'Enhanced' || a.quality === 'Premium' ? 0 : 1;
          const bQuality = b.quality === 'Enhanced' || b.quality === 'Premium' ? 0 : 1;
          if (aQuality !== bQuality) return aQuality - bQuality;
          return a.name.localeCompare(b.name);
        });
      setVoices(englishVoices);
    } catch (error) {
      console.error('[TTSSettings] Failed to load voices:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  const testVoice = () => {
    Speech.stop();
    const options: Speech.SpeechOptions = {
      language: 'en-US',
      rate,
      pitch,
    };
    if (voiceId) {
      options.voice = voiceId;
    }
    Speech.speak('Hello! This is a test of the text to speech settings.', options);
  };

  const currentVoiceName = voiceId
    ? voices.find(v => v.identifier === voiceId)?.name || voiceId
    : 'System Default';

  // Simple rate/pitch controls using buttons
  const adjustRate = (delta: number) => {
    const newRate = Math.round(Math.max(0.5, Math.min(2.0, rate + delta)) * 10) / 10;
    onRateChange(newRate);
  };

  const adjustPitch = (delta: number) => {
    const newPitch = Math.round(Math.max(0.5, Math.min(2.0, pitch + delta)) * 10) / 10;
    onPitchChange(newPitch);
  };

  return (
    <View style={styles.container}>
      {/* Voice Selection */}
      <TouchableOpacity
        style={[styles.voiceSelector, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
        onPress={() => {
          loadVoices();
          setShowVoicePicker(true);
        }}
      >
        <View style={styles.voiceSelectorContent}>
          <Text style={[styles.voiceSelectorLabel, { color: theme.colors.mutedForeground }]}>Voice</Text>
          <View style={styles.voiceSelectorRight}>
            <Text style={[styles.voiceSelectorText, { color: theme.colors.foreground }]} numberOfLines={1}>
              {currentVoiceName}
            </Text>
            <Text style={[styles.voiceSelectorChevron, { color: theme.colors.mutedForeground }]}>▼</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Rate Control */}
      <View style={styles.sliderRow}>
        <Text style={[styles.sliderLabel, { color: theme.colors.foreground }]}>Speed</Text>
        <View style={styles.sliderControls}>
          <TouchableOpacity
            style={[styles.adjustButton, { borderColor: theme.colors.border }]}
            onPress={() => adjustRate(-0.1)}
          >
            <Text style={[styles.adjustButtonText, { color: theme.colors.foreground }]}>−</Text>
          </TouchableOpacity>
          <Text style={[styles.sliderValue, { color: theme.colors.foreground }]}>{rate.toFixed(1)}x</Text>
          <TouchableOpacity
            style={[styles.adjustButton, { borderColor: theme.colors.border }]}
            onPress={() => adjustRate(0.1)}
          >
            <Text style={[styles.adjustButtonText, { color: theme.colors.foreground }]}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Pitch Control */}
      <View style={styles.sliderRow}>
        <Text style={[styles.sliderLabel, { color: theme.colors.foreground }]}>Pitch</Text>
        <View style={styles.sliderControls}>
          <TouchableOpacity
            style={[styles.adjustButton, { borderColor: theme.colors.border }]}
            onPress={() => adjustPitch(-0.1)}
          >
            <Text style={[styles.adjustButtonText, { color: theme.colors.foreground }]}>−</Text>
          </TouchableOpacity>
          <Text style={[styles.sliderValue, { color: theme.colors.foreground }]}>{pitch.toFixed(1)}</Text>
          <TouchableOpacity
            style={[styles.adjustButton, { borderColor: theme.colors.border }]}
            onPress={() => adjustPitch(0.1)}
          >
            <Text style={[styles.adjustButtonText, { color: theme.colors.foreground }]}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Test Button */}
      <TouchableOpacity
        style={[styles.testButton, { borderColor: theme.colors.border }]}
        onPress={testVoice}
      >
        <Text style={[styles.testButtonText, { color: theme.colors.primary }]}>Test Voice</Text>
      </TouchableOpacity>

      {/* Voice Picker Modal */}
      <Modal
        visible={showVoicePicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowVoicePicker(false)}
      >
        <View style={[styles.modalOverlay]}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.foreground }]}>Select Voice</Text>
              <TouchableOpacity onPress={() => setShowVoicePicker(false)}>
                <Text style={[styles.modalClose, { color: theme.colors.mutedForeground }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* System Default option */}
            <TouchableOpacity
              style={[
                styles.voiceItem,
                !voiceId && { backgroundColor: theme.colors.primary + '22' },
                { borderBottomColor: theme.colors.border },
              ]}
              onPress={() => {
                onVoiceChange(undefined);
                setShowVoicePicker(false);
              }}
            >
              <Text style={[styles.voiceItemName, { color: theme.colors.foreground }]}>System Default</Text>
              {!voiceId && <Text style={[styles.voiceItemCheck, { color: theme.colors.primary }]}>✓</Text>}
            </TouchableOpacity>

            <FlatList
              data={voices}
              keyExtractor={(item) => item.identifier}
              renderItem={({ item }) => {
                const isSelected = voiceId === item.identifier;
                return (
                  <TouchableOpacity
                    style={[
                      styles.voiceItem,
                      isSelected && { backgroundColor: theme.colors.primary + '22' },
                      { borderBottomColor: theme.colors.border },
                    ]}
                    onPress={() => {
                      onVoiceChange(item.identifier);
                      setShowVoicePicker(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.voiceItemName, { color: theme.colors.foreground }]}>{item.name}</Text>
                      <Text style={[styles.voiceItemLang, { color: theme.colors.mutedForeground }]}>
                        {item.language}{item.quality ? ` • ${item.quality}` : ''}
                      </Text>
                    </View>
                    {isSelected && <Text style={[styles.voiceItemCheck, { color: theme.colors.primary }]}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyList}>
                  <Text style={[styles.emptyText, { color: theme.colors.mutedForeground }]}>
                    {isLoading ? 'Loading voices...' : 'No English voices available'}
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  voiceSelector: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  voiceSelectorContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  voiceSelectorLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  voiceSelectorRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
    justifyContent: 'flex-end',
  },
  voiceSelectorText: {
    fontSize: 14,
  },
  voiceSelectorChevron: {
    fontSize: 10,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  sliderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  adjustButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustButtonText: {
    fontSize: 18,
    fontWeight: '500',
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'center',
  },
  testButton: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  testButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalClose: {
    fontSize: 20,
    padding: spacing.sm,
  },
  voiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
  },
  voiceItemName: {
    fontSize: 14,
  },
  voiceItemLang: {
    fontSize: 12,
    marginTop: 2,
  },
  voiceItemCheck: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  emptyList: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
});

export default TTSSettings;
