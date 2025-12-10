import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { useTheme } from '../ui/ThemeProvider';
import { spacing, radius, Theme } from '../ui/theme';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';

interface StreamingContentProps {
  text: string;
  isStreaming: boolean;
}

interface RetryStatusProps {
  isRetrying: boolean;
  attempt: number;
  maxAttempts?: number;
  delaySeconds: number;
  reason: string;
  startedAt: number;
}

interface AgentProgressBannerProps {
  streamingContent?: StreamingContentProps;
  retryInfo?: RetryStatusProps;
}

/**
 * StreamingContentBubble - Shows real-time LLM response as it streams
 * Matches desktop's StreamingContentBubble component
 */
const StreamingContentBubble: React.FC<{ content: StreamingContentProps }> = ({ content }) => {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  // Pulsing animation for the cursor
  useEffect(() => {
    if (content.isStreaming) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    }
  }, [content.isStreaming, pulseAnim]);

  if (!content.text) return null;

  return (
    <View style={styles.streamingContainer}>
      <View style={styles.streamingHeader}>
        <Text style={styles.streamingIcon}>⚡</Text>
        <Text style={styles.streamingTitle}>
          {content.isStreaming ? 'Generating response...' : 'Response'}
        </Text>
        {content.isStreaming && (
          <Animated.View style={[styles.streamingIndicator, { opacity: pulseAnim }]} />
        )}
      </View>
      <View style={styles.streamingContent}>
        <MarkdownRenderer content={content.text} />
        {content.isStreaming && (
          <Animated.View style={[styles.cursor, { opacity: pulseAnim }]} />
        )}
      </View>
    </View>
  );
};

/**
 * RetryStatusBanner - Shows retry status with countdown timer
 * Matches desktop's RetryStatusBanner component
 */
const RetryStatusBanner: React.FC<{ retryInfo: RetryStatusProps }> = ({ retryInfo }) => {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [countdown, setCountdown] = useState(retryInfo.delaySeconds);

  // Update countdown timer
  useEffect(() => {
    if (!retryInfo.isRetrying) {
      setCountdown(0);
      return;
    }

    const updateCountdown = () => {
      const elapsed = Math.floor((Date.now() - retryInfo.startedAt) / 1000);
      const remaining = Math.max(0, retryInfo.delaySeconds - elapsed);
      setCountdown(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [retryInfo.isRetrying, retryInfo.startedAt, retryInfo.delaySeconds]);

  if (!retryInfo.isRetrying) return null;

  const attemptText = retryInfo.maxAttempts
    ? `Attempt ${retryInfo.attempt}/${retryInfo.maxAttempts}`
    : `Attempt ${retryInfo.attempt}`;

  return (
    <View style={styles.retryContainer}>
      <View style={styles.retryHeader}>
        <Text style={styles.retryIcon}>⏱️</Text>
        <Text style={styles.retryTitle}>{retryInfo.reason}</Text>
        <View style={styles.retrySpinner} />
      </View>
      <View style={styles.retryContent}>
        <Text style={styles.retryAttempt}>{attemptText}</Text>
        <View style={styles.retryCountdownBadge}>
          <Text style={styles.retryCountdownText}>Retrying in {countdown}s</Text>
        </View>
      </View>
      <Text style={styles.retryHint}>
        The agent will automatically retry when the API is available.
      </Text>
    </View>
  );
};

/**
 * AgentProgressBanner - Main component that shows streaming content and/or retry status
 */
export const AgentProgressBanner: React.FC<AgentProgressBannerProps> = ({
  streamingContent,
  retryInfo,
}) => {
  const showStreaming = streamingContent?.isStreaming && streamingContent?.text;
  const showRetry = retryInfo?.isRetrying;

  if (!showStreaming && !showRetry) return null;

  return (
    <View>
      {showRetry && retryInfo && <RetryStatusBanner retryInfo={retryInfo} />}
      {showStreaming && streamingContent && <StreamingContentBubble content={streamingContent} />}
    </View>
  );
};

function createStyles(theme: Theme) {
  return StyleSheet.create({
    // Streaming content styles
    streamingContainer: {
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      borderWidth: 1,
      borderColor: 'rgba(59, 130, 246, 0.3)',
      borderRadius: radius.lg,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      overflow: 'hidden',
    },
    streamingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: 'rgba(59, 130, 246, 0.15)',
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(59, 130, 246, 0.2)',
    },
    streamingIcon: {
      fontSize: 14,
      marginRight: spacing.xs,
    },
    streamingTitle: {
      fontSize: 12,
      fontWeight: '500',
      color: 'rgb(59, 130, 246)',
      flex: 1,
    },
    streamingIndicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: 'rgb(59, 130, 246)',
    },
    streamingContent: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
    },
    cursor: {
      width: 6,
      height: 14,
      backgroundColor: 'rgb(59, 130, 246)',
      marginLeft: 2,
      borderRadius: 1,
    },
    // Retry status styles
    retryContainer: {
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      borderWidth: 1,
      borderColor: 'rgba(245, 158, 11, 0.3)',
      borderRadius: radius.lg,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      overflow: 'hidden',
    },
    retryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(245, 158, 11, 0.2)',
    },
    retryIcon: {
      fontSize: 14,
      marginRight: spacing.xs,
    },
    retryTitle: {
      fontSize: 12,
      fontWeight: '500',
      color: 'rgb(245, 158, 11)',
      flex: 1,
    },
    retrySpinner: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: 'rgba(245, 158, 11, 0.3)',
      borderTopColor: 'rgb(245, 158, 11)',
    },
    retryContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    retryAttempt: {
      fontSize: 12,
      color: 'rgb(180, 120, 10)',
    },
    retryCountdownBadge: {
      backgroundColor: 'rgba(245, 158, 11, 0.2)',
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.sm,
    },
    retryCountdownText: {
      fontSize: 12,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      color: 'rgb(180, 120, 10)',
    },
    retryHint: {
      fontSize: 11,
      color: 'rgb(180, 120, 10)',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
  });
}

