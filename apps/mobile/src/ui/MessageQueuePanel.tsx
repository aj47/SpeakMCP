/**
 * MessageQueuePanel - React Native version of the message queue panel UI
 * 
 * Displays queued messages with options to view, edit, remove, and retry.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QueuedMessage, formatTime } from '@speakmcp/shared';
import { useTheme } from './ThemeProvider';

interface MessageQueuePanelProps {
  conversationId: string;
  messages: QueuedMessage[];
  onRemove: (messageId: string) => void;
  onUpdate: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  onClear: () => void;
  compact?: boolean;
}

interface QueuedMessageItemProps {
  message: QueuedMessage;
  onRemove: () => void;
  onUpdate: (text: string) => void;
  onRetry: () => void;
}

function QueuedMessageItem({ message, onRemove, onUpdate, onRetry }: QueuedMessageItemProps) {
  const { theme } = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);

  // Sync editText with message.text when it changes (only when not editing)
  useEffect(() => {
    if (!isEditing) {
      setEditText(message.text);
    }
  }, [message.text, isEditing]);

  // Exit edit mode when the message starts processing
  useEffect(() => {
    if (message.status === 'processing') {
      setIsEditing(false);
      setEditText(message.text);
    }
  }, [message.status, message.text]);

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.text) {
      onUpdate(trimmed);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditText(message.text);
  };

  const isLongMessage = message.text.length > 100;
  const isFailed = message.status === 'failed';
  const isProcessing = message.status === 'processing';
  const isAddedToHistory = message.addedToHistory === true;

  const styles = StyleSheet.create({
    container: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: isFailed
        ? `${theme.colors.destructive}15`
        : isProcessing
        ? `${theme.colors.primary}15`
        : 'transparent',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    content: {
      flex: 1,
    },
    messageText: {
      fontSize: 14,
      color: isFailed
        ? theme.colors.destructive
        : isProcessing
        ? theme.colors.primary
        : theme.colors.foreground,
    },
    errorText: {
      fontSize: 12,
      color: `${theme.colors.destructive}CC`,
      marginTop: 4,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    metaText: {
      fontSize: 12,
      color: isFailed
        ? `${theme.colors.destructive}B3`
        : isProcessing
        ? `${theme.colors.primary}B3`
        : theme.colors.mutedForeground,
    },
    expandButton: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    expandText: {
      fontSize: 12,
      color: theme.colors.mutedForeground,
      marginLeft: 2,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    actionButton: {
      padding: 4,
    },
    editContainer: {
      gap: 8,
    },
    editInput: {
      minHeight: 60,
      padding: 8,
      fontSize: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      color: theme.colors.foreground,
      textAlignVertical: 'top',
    },
    editActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
    },
    editButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    cancelButton: {
      backgroundColor: 'transparent',
    },
    saveButton: {
      backgroundColor: theme.colors.primary,
    },
    buttonText: {
      fontSize: 12,
      color: theme.colors.foreground,
    },
    saveButtonText: {
      fontSize: 12,
      color: theme.colors.primaryForeground,
    },
  });

  if (isEditing) {
    return (
      <View style={styles.container}>
        <View style={styles.editContainer}>
          <TextInput
            style={styles.editInput}
            value={editText}
            onChangeText={setEditText}
            multiline
            autoFocus
          />
          <View style={styles.editActions}>
            <TouchableOpacity
              style={[styles.editButton, styles.cancelButton]}
              onPress={handleCancelEdit}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.editButton, styles.saveButton]}
              onPress={handleSaveEdit}
              disabled={!editText.trim()}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {isFailed && (
          <Ionicons name="alert-circle" size={16} color={theme.colors.destructive} />
        )}
        {isProcessing && (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        )}
        <View style={styles.content}>
          <Text
            style={styles.messageText}
            numberOfLines={isExpanded ? undefined : 2}
          >
            {message.text}
          </Text>
          {isFailed && message.errorMessage && (
            <Text style={styles.errorText}>Error: {message.errorMessage}</Text>
          )}
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {formatTime(message.createdAt)} •{' '}
              {isFailed ? 'Failed' : isProcessing ? 'Processing...' : 'Queued'}
            </Text>
            {isLongMessage && (
              <TouchableOpacity
                style={styles.expandButton}
                onPress={() => setIsExpanded(!isExpanded)}
              >
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color={theme.colors.mutedForeground}
                />
                <Text style={styles.expandText}>
                  {isExpanded ? 'Less' : 'More'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {!isProcessing && (
          <View style={styles.actions}>
            {isFailed && (
              <TouchableOpacity style={styles.actionButton} onPress={onRetry}>
                <Ionicons name="refresh" size={16} color={theme.colors.foreground} />
              </TouchableOpacity>
            )}
            {!isAddedToHistory && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => setIsEditing(true)}
              >
                <Ionicons name="pencil" size={16} color={theme.colors.foreground} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionButton} onPress={onRemove}>
              <Ionicons name="close" size={16} color={theme.colors.foreground} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Panel component for displaying and managing queued messages.
 */
export function MessageQueuePanel({
  conversationId,
  messages,
  onRemove,
  onUpdate,
  onRetry,
  onClear,
  compact = false,
}: MessageQueuePanelProps) {
  const { theme } = useTheme();

  const hasProcessingMessage = messages.some((m) => m.status === 'processing');

  if (messages.length === 0) {
    return null;
  }

  const styles = StyleSheet.create({
    container: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: `${theme.colors.muted}30`,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      backgroundColor: `${theme.colors.muted}50`,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerTitle: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.foreground,
    },
    clearButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    clearButtonText: {
      fontSize: 12,
      color: hasProcessingMessage
        ? theme.colors.mutedForeground
        : theme.colors.foreground,
    },
    list: {
      maxHeight: 200,
    },
    separator: {
      height: 1,
      backgroundColor: theme.colors.border,
    },
    compactContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 4,
      gap: 8,
    },
    compactText: {
      flex: 1,
      fontSize: 12,
      color: theme.colors.mutedForeground,
    },
  });

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <Ionicons name="time-outline" size={12} color={theme.colors.mutedForeground} />
        <Text style={styles.compactText}>
          {messages.length} queued message{messages.length > 1 ? 's' : ''}
        </Text>
        <TouchableOpacity
          onPress={onClear}
          disabled={hasProcessingMessage}
        >
          <Ionicons
            name="trash-outline"
            size={14}
            color={hasProcessingMessage ? theme.colors.mutedForeground : theme.colors.foreground}
          />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="time-outline" size={16} color={theme.colors.mutedForeground} />
          <Text style={styles.headerTitle}>
            Queued Messages ({messages.length})
          </Text>
        </View>
        <TouchableOpacity
          style={styles.clearButton}
          onPress={onClear}
          disabled={hasProcessingMessage}
        >
          <Text style={styles.clearButtonText}>Clear All</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.list}>
        {messages.map((msg, index) => (
          <React.Fragment key={msg.id}>
            {index > 0 && <View style={styles.separator} />}
            <QueuedMessageItem
              message={msg}
              onRemove={() => onRemove(msg.id)}
              onUpdate={(text) => onUpdate(msg.id, text)}
              onRetry={() => onRetry(msg.id)}
            />
          </React.Fragment>
        ))}
      </ScrollView>
    </View>
  );
}

