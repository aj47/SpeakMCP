/**
 * Shared chat display utilities for SpeakMCP apps (desktop and mobile)
 * 
 * This module provides platform-agnostic logic for displaying chat messages,
 * tool calls, and formatting that can be used by both desktop (React) and
 * mobile (React Native) applications.
 */

import type { BaseChatMessage, ToolCall, ToolResult } from './types';

/**
 * Constants for chat message display
 */
export const COLLAPSE_THRESHOLD = 200;

/**
 * Role types for chat messages
 */
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

/**
 * Role display configuration (platform-agnostic)
 */
export interface RoleDisplayConfig {
  /** Display name for the role */
  name: string;
  /** Emoji icon for the role (for mobile/text displays) */
  emoji: string;
  /** Icon name for lucide-react (for desktop) */
  iconName: 'User' | 'Bot' | 'Wrench' | 'Settings';
  /** Color scheme identifier */
  colorScheme: 'blue' | 'green' | 'orange' | 'gray';
}

/**
 * Get display configuration for a message role
 */
export function getRoleDisplayConfig(role: string): RoleDisplayConfig {
  switch (role) {
    case 'user':
      return {
        name: 'User',
        emoji: '👤',
        iconName: 'User',
        colorScheme: 'blue',
      };
    case 'assistant':
      return {
        name: 'Assistant',
        emoji: '🤖',
        iconName: 'Bot',
        colorScheme: 'green',
      };
    case 'tool':
      return {
        name: 'Tool',
        emoji: '🔧',
        iconName: 'Wrench',
        colorScheme: 'orange',
      };
    case 'system':
      return {
        name: 'System',
        emoji: '⚙️',
        iconName: 'Settings',
        colorScheme: 'gray',
      };
    default:
      return {
        name: role.charAt(0).toUpperCase() + role.slice(1),
        emoji: '💬',
        iconName: 'User',
        colorScheme: 'gray',
      };
  }
}

/**
 * Message data needed for collapse logic (more flexible than BaseChatMessage)
 */
export interface CollapseableMessage {
  role: string;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

/**
 * Determine if a message should be collapsible
 */
export function shouldCollapseMessage(message: CollapseableMessage, threshold = COLLAPSE_THRESHOLD): boolean {
  const hasExtras = (message.toolCalls?.length ?? 0) > 0 || (message.toolResults?.length ?? 0) > 0;
  const isLongContent = (message.content?.length ?? 0) > threshold;
  return hasExtras || isLongContent;
}

/**
 * Format a summary of tool calls for collapsed display
 */
export function formatToolCallsSummary(toolCalls: ToolCall[]): string {
  if (!toolCalls || toolCalls.length === 0) return '';
  const names = toolCalls.map(tc => tc.name).join(', ');
  return `🔧 ${names}`;
}

/**
 * Format a summary of tool results for collapsed display
 */
export function formatToolResultsSummary(toolResults: ToolResult[]): string {
  if (!toolResults || toolResults.length === 0) return '';
  const allSuccess = toolResults.every(r => r.success);
  const emoji = allSuccess ? '✅' : '⚠️';
  const count = toolResults.length;
  return `${emoji} ${count} result${count > 1 ? 's' : ''}`;
}

/**
 * Get badge text for tool calls count
 */
export function getToolCallsBadgeText(count: number): string {
  return `${count} tool${count > 1 ? 's' : ''}`;
}

/**
 * Get badge text for tool results count
 */
export function getToolResultsBadgeText(count: number): string {
  return `${count} result${count > 1 ? 's' : ''}`;
}

/**
 * Format tool call arguments for display
 */
export function formatToolArguments(args: any): string {
  if (!args) return '';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * Get expand/collapse button text
 */
export function getExpandCollapseText(isExpanded: boolean): string {
  return isExpanded ? 'Collapse' : 'Expand';
}

/**
 * Get expand/collapse button text with arrow
 */
export function getExpandCollapseTextWithArrow(isExpanded: boolean): string {
  return isExpanded ? '▲ Collapse' : '▼ Expand';
}

/**
 * Get the result status display
 */
export function getToolResultStatus(success: boolean): { emoji: string; text: string } {
  return success
    ? { emoji: '✅', text: 'Success' }
    : { emoji: '❌', text: 'Error' };
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

