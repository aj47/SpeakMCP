/**
 * Source display utilities for SpeakMCP
 * Provides icon and label helpers for MessageSource types
 */

import { MessageSource } from './types';

/**
 * Configuration for source display
 */
export interface SourceConfig {
  /** Display icon (emoji or text) */
  icon: string;
  /** Display label */
  label: string;
  /** Color hex for UI theming */
  color: string;
}

/**
 * Source display configuration mapping
 */
export const SOURCE_CONFIGS: Record<MessageSource, SourceConfig> = {
  native: {
    icon: '🏠',
    label: 'Native',
    color: '#6366f1', // indigo
  },
  augment: {
    icon: 'A',
    label: 'Augment',
    color: '#8b5cf6', // purple
  },
  'claude-code': {
    icon: 'C',
    label: 'Claude Code',
    color: '#f97316', // orange
  },
  mobile: {
    icon: '📱',
    label: 'Mobile',
    color: '#10b981', // emerald
  },
  api: {
    icon: '🔌',
    label: 'API',
    color: '#6b7280', // gray
  },
};

/**
 * Get display icon for a message source
 */
export function getSourceIcon(source: MessageSource): string {
  return SOURCE_CONFIGS[source]?.icon ?? '❓';
}

/**
 * Get display label for a message source
 */
export function getSourceLabel(source: MessageSource): string {
  return SOURCE_CONFIGS[source]?.label ?? 'Unknown';
}

/**
 * Get full display configuration for a message source
 */
export function getSourceConfig(source: MessageSource): SourceConfig {
  return SOURCE_CONFIGS[source] ?? {
    icon: '❓',
    label: 'Unknown',
    color: '#374151',
  };
}

/**
 * Check if a source is an external source (not native)
 */
export function isExternalSource(source: MessageSource): boolean {
  return source !== 'native';
}

/**
 * Get sources that are considered "external"
 */
export const EXTERNAL_SOURCES: MessageSource[] = ['augment', 'claude-code', 'mobile', 'api'];

/**
 * Check if a source is an external source (convenience function)
 */
export function isExternal(source: MessageSource): boolean {
  return EXTERNAL_SOURCES.includes(source);
}

/**
 * Get CSS class name for a source (kebab-case for styling)
 */
export function getSourceCssClass(source: MessageSource): string {
  return `source-${source.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

/**
 * Format a source for display in UI
 */
export function formatSourceForDisplay(source: MessageSource): {
  icon: string;
  label: string;
  cssClass: string;
  color: string;
} {
  const config = getSourceConfig(source);
  return {
    icon: config.icon,
    label: config.label,
    cssClass: getSourceCssClass(source),
    color: config.color,
  };
}
