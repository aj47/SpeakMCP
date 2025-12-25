/**
 * SpeakMCP Shared Time Utilities
 *
 * Platform-agnostic time formatting utilities for both desktop and mobile apps.
 */

/**
 * Format duration in seconds to MM:SS format
 * @param seconds - Duration in seconds
 * @returns Formatted string like "1:05" or "0:30"
 * @example formatDuration(65) // "1:05"
 * @example formatDuration(30) // "0:30"
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format a Unix timestamp to locale time string (HH:MM format)
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted locale time string like "14:30" or "2:30 PM"
 * @example formatTimestamp(Date.now()) // "2:30 PM" (locale dependent)
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Status color classes for Tailwind CSS
 * Common status indicators used across the app
 */
export const statusColors = {
  success: {
    text: 'text-green-500',
    textDark: 'dark:text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    icon: 'text-green-500',
  },
  error: {
    text: 'text-red-500',
    textDark: 'dark:text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    icon: 'text-red-500',
  },
  warning: {
    text: 'text-yellow-500',
    textDark: 'dark:text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    icon: 'text-yellow-500',
  },
  info: {
    text: 'text-blue-500',
    textDark: 'dark:text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    icon: 'text-blue-500',
  },
  pending: {
    text: 'text-orange-500',
    textDark: 'dark:text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    icon: 'text-orange-500',
  },
  muted: {
    text: 'text-gray-500',
    textDark: 'dark:text-gray-400',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/20',
    icon: 'text-gray-500',
  },
} as const;

/**
 * Type for status color keys
 */
export type StatusColorKey = keyof typeof statusColors;

/**
 * Get combined text classes for a status (includes dark mode variant)
 */
export function getStatusTextClass(status: StatusColorKey): string {
  const colors = statusColors[status];
  return `${colors.text} ${colors.textDark}`;
}

/**
 * Get combined alert/banner classes for a status
 */
export function getStatusAlertClass(status: StatusColorKey): string {
  const colors = statusColors[status];
  return `${colors.bg} ${colors.border} ${colors.text} ${colors.textDark}`;
}
