import React from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet, Platform, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { ChatMessage } from '../../../lib/openaiClient';
import { useTheme } from '../../../ui/ThemeProvider';
import { spacing, radius, Theme } from '../../../ui/theme';
import { MarkdownRenderer } from '../../../ui/MarkdownRenderer';
import {
  COLLAPSED_LINES,
  getRoleIcon,
  getRoleLabel,
  shouldCollapseMessage,
  getToolResultsSummary,
  formatToolArguments,
  formatArgumentsPreview,
} from '@speakmcp/shared';

interface MessageListProps {
  messages: ChatMessage[];
  expandedMessages: Record<number, boolean>;
  onToggleExpansion: (index: number) => void;
  isDark: boolean;
  scrollViewRef: React.RefObject<ScrollView>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
}

const darkSpinner = require('../../../assets/loading-spinner.gif');
const lightSpinner = require('../../../assets/light-spinner.gif');

export function MessageList({
  messages,
  expandedMessages,
  onToggleExpansion,
  isDark,
  scrollViewRef,
  onScroll,
  onScrollBeginDrag,
  onScrollEndDrag,
}: MessageListProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      onScroll={onScroll}
      onScrollBeginDrag={onScrollBeginDrag}
      onScrollEndDrag={onScrollEndDrag}
      scrollEventThrottle={16}
    >
      {messages.map((m, i) => {
        const shouldCollapse = shouldCollapseMessage(m.content, m.toolCalls, m.toolResults);
        const isExpanded = expandedMessages[i] ?? false;
        const roleIcon = getRoleIcon(m.role as 'user' | 'assistant' | 'tool');
        const roleLabel = getRoleLabel(m.role as 'user' | 'assistant' | 'tool');

        const toolCallCount = m.toolCalls?.length ?? 0;
        const toolResultCount = m.toolResults?.length ?? 0;
        const hasToolResults = toolResultCount > 0;
        const allSuccess = hasToolResults && m.toolResults!.every(r => r.success);
        const hasErrors = hasToolResults && m.toolResults!.some(r => !r.success);
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
              onPress={shouldCollapse ? () => onToggleExpansion(i) : undefined}
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

                {/* Unified Tool Execution Display */}
                {((m.toolCalls?.length ?? 0) > 0 || (m.toolResults?.length ?? 0) > 0) && (
                  <View style={[
                    styles.toolExecutionCard,
                    isPending && styles.toolExecutionPending,
                    allSuccess && styles.toolExecutionSuccess,
                    hasErrors && styles.toolExecutionError,
                  ]}>
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

                    {isExpanded && (
                      <>
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

                        <View style={[
                          styles.toolResponseSection,
                          isPending && styles.toolResponsePending,
                          allSuccess && styles.toolResponseSuccess,
                          hasErrors && styles.toolResponseError,
                        ]}>
                          <Text style={styles.toolResponseSectionTitle}>Response</Text>
                          {(m.toolResults ?? []).map((result, idx) => (
                            <View key={idx} style={styles.toolResultItem}>
                              <View style={styles.toolResultHeader}>
                                <Text style={[
                                  styles.toolResultBadge,
                                  result.success ? styles.toolResultBadgeSuccess : styles.toolResultBadgeError
                                ]}>
                                  {result.success ? '✅ Success' : '❌ Error'}
                                </Text>
                                <Text style={styles.toolResultCharCount}>
                                  {(result.content?.length || 0).toLocaleString()} chars
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
                          {isPending && (
                            <Text style={styles.toolResponsePendingText}>
                              ⏳ Waiting for {toolCallCount - toolResultCount} more response{toolCallCount - toolResultCount > 1 ? 's' : ''}...
                            </Text>
                          )}
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
    </ScrollView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    scrollView: {
      flex: 1,
      padding: spacing.lg,
      backgroundColor: theme.colors.background,
    },
    contentContainer: {
      paddingBottom: spacing.lg,
    },
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
    messageHeaderClickable: {},
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
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    toolResultCharCount: {
      fontSize: 10,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      color: theme.colors.mutedForeground,
      opacity: 0.7,
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
