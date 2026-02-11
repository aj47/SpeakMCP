import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View
        style={[
          styles.dot,
          { backgroundColor: getStatusColor() },
        ]}
      />
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
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default ConnectionStatusIndicator;

