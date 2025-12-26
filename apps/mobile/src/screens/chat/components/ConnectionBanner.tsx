import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RecoveryState } from '../../../lib/connectionRecovery';
import { useTheme } from '../../../ui/ThemeProvider';
import { spacing, radius } from '../../../ui/theme';

interface ConnectionBannerProps {
  connectionState: RecoveryState | null;
  lastFailedMessage: string | null;
  responding: boolean;
  onRetry: () => void;
}

export function ConnectionBanner({
  connectionState,
  lastFailedMessage,
  responding,
  onRetry,
}: ConnectionBannerProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);

  if (connectionState && connectionState.status === 'reconnecting') {
    return (
      <View style={[styles.connectionBanner, styles.connectionBannerReconnecting]}>
        <View style={styles.connectionBannerContent}>
          <Text style={styles.connectionBannerIcon}>🔄</Text>
          <View style={styles.connectionBannerTextContainer}>
            <Text style={styles.connectionBannerText}>
              Reconnecting... (attempt {connectionState.retryCount})
            </Text>
            {connectionState.lastError && (
              <Text style={styles.connectionBannerSubtext} numberOfLines={1}>
                {connectionState.lastError}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  }

  if (lastFailedMessage && !responding) {
    return (
      <View style={[styles.connectionBanner, styles.connectionBannerFailed]}>
        <View style={styles.connectionBannerContent}>
          <Text style={styles.connectionBannerIcon}>⚠️</Text>
          <View style={styles.connectionBannerTextContainer}>
            <Text style={styles.connectionBannerText}>Message failed to send</Text>
            <Text style={styles.connectionBannerSubtext} numberOfLines={1}>
              Tap retry to try again
            </Text>
          </View>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onRetry}
            activeOpacity={0.7}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
}

function createStyles(theme: any) {
  return StyleSheet.create({
    connectionBanner: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
    },
    connectionBannerReconnecting: {
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      borderColor: 'rgba(59, 130, 246, 0.3)',
    },
    connectionBannerFailed: {
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderColor: 'rgba(239, 68, 68, 0.3)',
    },
    connectionBannerContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    connectionBannerIcon: {
      fontSize: 16,
      marginRight: spacing.sm,
    },
    connectionBannerTextContainer: {
      flex: 1,
    },
    connectionBannerText: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.foreground,
    },
    connectionBannerSubtext: {
      fontSize: 11,
      color: theme.colors.mutedForeground,
      marginTop: 2,
    },
    retryButton: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      marginLeft: spacing.sm,
    },
    retryButtonText: {
      color: theme.colors.primaryForeground,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
