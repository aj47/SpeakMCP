import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useTheme } from './ThemeProvider';
import { TunnelConnectionState } from '../lib/tunnelConnectionManager';

export interface ConnectionStatusIndicatorProps {
  state: TunnelConnectionState;
  retryCount?: number;
  compact?: boolean;
}

/**
 * Visual indicator for tunnel connection status.
 * Shows a colored dot and optional status text.
 */
export function ConnectionStatusIndicator({
  state,
  retryCount = 0,
  compact = false,
}: ConnectionStatusIndicatorProps) {
  const { theme } = useTheme();

  const getStatusColor = (): string => {
    switch (state) {
      case 'connected':
        return '#22c55e'; // green-500
      case 'connecting':
      case 'reconnecting':
        return '#f59e0b'; // amber-500
      case 'disconnected':
        return '#6b7280'; // gray-500
      case 'failed':
        return '#ef4444'; // red-500
      default:
        return '#6b7280';
    }
  };

  const getStatusText = (): string => {
    switch (state) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return retryCount > 0 ? `Reconnecting (${retryCount})...` : 'Reconnecting...';
      case 'disconnected':
        return 'Disconnected';
      case 'failed':
        return 'Connection failed';
      default:
        return 'Unknown';
    }
  };

  const isPulsing = state === 'connecting' || state === 'reconnecting';

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View style={styles.dotContainer}>
        <View
          style={[
            styles.dot,
            { backgroundColor: getStatusColor() },
            isPulsing && styles.dotPulsing,
          ]}
        />
        {isPulsing && (
          <View
            style={[
              styles.dotPulse,
              { backgroundColor: getStatusColor() },
            ]}
          />
        )}
      </View>
      {!compact && (
        <Text style={[styles.text, { color: theme.colors.mutedForeground }]}>
          {getStatusText()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  containerCompact: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  dotContainer: {
    position: 'relative',
    width: 10,
    height: 10,
    marginRight: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: 'absolute',
    top: 1,
    left: 1,
  },
  dotPulsing: {
    opacity: 1,
  },
  dotPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    opacity: 0.3,
    position: 'absolute',
    top: 0,
    left: 0,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default ConnectionStatusIndicator;

