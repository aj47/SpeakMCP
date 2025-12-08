/**
 * Shared chat utilities for SpeakMCP apps (desktop and mobile)
 * 
 * These utilities provide consistent behavior for chat UI features
 * across both platforms while allowing platform-specific rendering.
 */

import { BaseChatMessage, ToolCall, ToolResult } from './types';

/**
 * Threshold for collapsing long message content.
 * Messages with content length greater than this will be collapsible.
 */
export const COLLAPSE_THRESHOLD = 200;

/**
 * Role type for chat messages
 */
export type MessageRole = 'user' | 'assistant' | 'tool';

/**
 * Get the emoji icon for a message role
 * @param role The role of the message sender
 * @returns An emoji string representing the role
 */
export function getRoleIcon(role: MessageRole): string {
  switch (role) {
    case 'user':
      return '👤';
    case 'assistant':
      return '🤖';
    case 'tool':
      return '🔧';
    default:
      return '💬';
  }
}

/**
 * Get the display label for a message role
 * @param role The role of the message sender
 * @returns A capitalized string label for the role
 */
export function getRoleLabel(role: MessageRole): string {
  switch (role) {
    case 'user':
      return 'User';
    case 'assistant':
      return 'Assistant';
    case 'tool':
      return 'Tool';
    default:
      return 'Unknown';
  }
}

/**
 * Determine if a message should be collapsible based on its content
 * @param content The message content
 * @param toolCalls Optional array of tool calls
 * @param toolResults Optional array of tool results
 * @returns True if the message should be collapsible
 */
export function shouldCollapseMessage(
  content: string | undefined,
  toolCalls?: ToolCall[],
  toolResults?: ToolResult[]
): boolean {
  const hasExtras = (toolCalls?.length ?? 0) > 0 || (toolResults?.length ?? 0) > 0;
  const contentLength = content?.length ?? 0;
  return contentLength > COLLAPSE_THRESHOLD || hasExtras;
}

/**
 * Generate a summary of tool calls for collapsed view
 * @param toolCalls Array of tool calls
 * @returns A formatted string showing tool names
 */
export function getToolCallsSummary(toolCalls: ToolCall[]): string {
  if (!toolCalls || toolCalls.length === 0) return '';
  return `🔧 ${toolCalls.map(tc => tc.name).join(', ')}`;
}

/**
 * Generate a summary of tool results for collapsed view
 * @param toolResults Array of tool results
 * @returns A formatted string showing result status
 */
export function getToolResultsSummary(toolResults: ToolResult[]): string {
  if (!toolResults || toolResults.length === 0) return '';
  const allSuccess = toolResults.every(r => r.success);
  const icon = allSuccess ? '✅' : '⚠️';
  const count = toolResults.length;
  return `${icon} ${count} result${count > 1 ? 's' : ''}`;
}

/**
 * Format a timestamp for display relative to current time
 * @param timestamp Unix timestamp in milliseconds
 * @returns A human-readable relative time string
 */
export function formatRelativeTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    // Less than 1 minute
    return 'Just now';
  } else if (diff < 3600000) {
    // Less than 1 hour
    return `${Math.floor(diff / 60000)}m ago`;
  } else if (diff < 86400000) {
    // Less than 1 day
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } else {
    // More than 1 day
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + 
           ', ' + 
           date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
}

/**
 * Check if a message has tool-related extras (calls or results)
 * @param message A chat message object
 * @returns True if the message has tool calls or results
 */
export function messageHasToolExtras(message: BaseChatMessage): boolean {
  return (message.toolCalls?.length ?? 0) > 0 || (message.toolResults?.length ?? 0) > 0;
}

/**
 * Get the number of lines to display when a message is collapsed
 * For both desktop (line-clamp-3) and mobile (numberOfLines={3})
 */
export const COLLAPSED_LINES = 3;

