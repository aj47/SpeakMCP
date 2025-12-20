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
 * @returns A formatted string showing result status and key information
 */
export function getToolResultsSummary(toolResults: ToolResult[]): string {
  if (!toolResults || toolResults.length === 0) return '';
  const allSuccess = toolResults.every(r => r.success);
  const icon = allSuccess ? '✅' : '⚠️';
  const count = toolResults.length;

  if (count === 1) {
    const preview = generateToolResultPreview(toolResults[0]);
    if (preview) {
      return `${icon} ${preview}`;
    }
  }

  const previews = toolResults
    .map(r => generateToolResultPreview(r))
    .filter(Boolean)
    .slice(0, 2);

  if (previews.length > 0) {
    const suffix = count > previews.length ? ` (+${count - previews.length} more)` : '';
    return `${icon} ${previews.join(', ')}${suffix}`;
  }

  return `${icon} ${count} result${count > 1 ? 's' : ''}`;
}

/**
 * Generate a preview string for a single tool result.
 * @param result Tool result to preview
 * @returns A short preview string or empty string if no meaningful preview
 */
export function generateToolResultPreview(result: ToolResult): string {
  if (!result) return '';

  if (!result.success) {
    const errorText = result.error || result.content || 'Error';
    return truncatePreview(errorText, 40);
  }

  const content = result.content || '';
  if (!content) return '';

  try {
    const parsed = JSON.parse(content);
    return extractJsonPreview(parsed);
  } catch {
    return extractTextPreview(content);
  }
}

/**
 * Extract a preview from a parsed JSON object
 */
function extractJsonPreview(data: unknown): string {
  if (data === null || data === undefined) return '';

  if (Array.isArray(data)) {
    const len = data.length;
    if (len === 0) return 'empty list';

    const firstItem = data[0];
    if (typeof firstItem === 'object' && firstItem !== null) {
      const item = firstItem as Record<string, unknown>;
      const getString = (value: unknown): string | null => {
        return typeof value === 'string' ? value : null;
      };
      const name = getString(item.name) || getString(item.title) || getString(item.path) || getString(item.filename);
      if (name) {
        return len === 1 ? truncatePreview(name, 30) : `${len} items: ${truncatePreview(name, 20)}...`;
      }
    }
    return `${len} item${len > 1 ? 's' : ''}`;
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    if ('success' in obj && typeof obj.success === 'boolean') {
      if ('message' in obj && typeof obj.message === 'string') {
        return truncatePreview(obj.message, 50);
      }
      if ('result' in obj) {
        return extractJsonPreview(obj.result);
      }
    }

    if ('path' in obj || 'file' in obj || 'filename' in obj) {
      const path = obj.path || obj.file || obj.filename;
      return truncatePreview(String(path), 40);
    }

    if ('content' in obj && typeof obj.content === 'string') {
      return truncatePreview(obj.content, 50);
    }

    if ('data' in obj) {
      return extractJsonPreview(obj.data);
    }

    if ('count' in obj && typeof obj.count === 'number') {
      return `${obj.count} item${obj.count !== 1 ? 's' : ''}`;
    }

    if ('items' in obj && Array.isArray(obj.items)) {
      return extractJsonPreview(obj.items);
    }
    if ('results' in obj && Array.isArray(obj.results)) {
      return extractJsonPreview(obj.results);
    }

    const keys = Object.keys(obj);
    if (keys.length > 0) {
      const firstKey = keys[0];
      const firstValue = obj[firstKey];
      if (typeof firstValue === 'string' || typeof firstValue === 'number' || typeof firstValue === 'boolean') {
        return `${firstKey}: ${truncatePreview(String(firstValue), 30)}`;
      }
      return `${keys.length} field${keys.length > 1 ? 's' : ''}`;
    }
  }

  if (typeof data === 'string') {
    return truncatePreview(data, 50);
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  return '';
}

/**
 * Extract a preview from plain text content
 */
function extractTextPreview(content: string): string {
  if (!content) return '';

  const cleaned = content.trim();

  if (cleaned.length <= 50) {
    return cleaned.replace(/\n/g, ' ').trim();
  }

  const lines = cleaned.split('\n').filter(l => l.trim());
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    const cleanedLine = firstLine.replace(/^(successfully|done|completed|created|updated|deleted|read|wrote|found|error:?)\s*/i, '');
    return truncatePreview(cleanedLine || firstLine, 50);
  }

  return truncatePreview(cleaned, 50);
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
function truncatePreview(text: string, maxLength: number): string {
  if (!text) return '';
  const cleaned = text.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 3) + '...';
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

// ============================================================================
// Expand/Collapse Text Helpers
// ============================================================================

/** UI text for expand button */
export const EXPAND_TEXT = 'Expand';

/** UI text for collapse button */
export const COLLAPSE_TEXT = 'Collapse';

/**
 * Get the appropriate expand/collapse text based on current state
 * @param isExpanded Whether the content is currently expanded
 * @returns The text to display on the toggle button
 */
export function getExpandCollapseText(isExpanded: boolean): string {
  return isExpanded ? COLLAPSE_TEXT : EXPAND_TEXT;
}

// ============================================================================
// Tool Argument Formatting
// ============================================================================

/**
 * Format tool arguments as pretty-printed JSON
 * @param args Tool call arguments object
 * @returns Formatted JSON string with 2-space indentation
 */
export function formatToolArguments(args: unknown): string {
  if (!args) return '';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * Format tool arguments as a compact preview for collapsed view.
 * Shows key parameter names and truncated values.
 * @param args Tool call arguments object
 * @returns A compact preview string like "path: /foo/bar, content: Hello..."
 */
export function formatArgumentsPreview(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';

  const preview = entries.slice(0, 3).map(([key, value]) => {
    let displayValue: string;
    if (typeof value === 'string') {
      displayValue = value.length > 30 ? value.slice(0, 30) + '...' : value;
    } else if (typeof value === 'object') {
      displayValue = Array.isArray(value) ? `[${value.length} items]` : '{...}';
    } else {
      displayValue = String(value);
    }
    return `${key}: ${displayValue}`;
  }).join(', ');

  if (entries.length > 3) {
    return preview + ` (+${entries.length - 3} more)`;
  }
  return preview;
}

// ============================================================================
// Tool Result Status Formatting
// ============================================================================

/**
 * Status display info for tool results
 */
export interface ToolResultStatus {
  icon: string;
  label: string;
}

/**
 * Get display info for a tool result's success/error status
 * @param success Whether the tool execution was successful
 * @returns Object with icon emoji and label text
 */
export function getToolResultStatusDisplay(success: boolean): ToolResultStatus {
  return success
    ? { icon: '✅', label: 'Success' }
    : { icon: '❌', label: 'Error' };
}

// ============================================================================
// Pluralization Helpers
// ============================================================================

/**
 * Simple pluralization helper
 * @param count The number of items
 * @param singular The singular form of the word
 * @param plural Optional plural form (defaults to singular + 's')
 * @returns The appropriate singular or plural form
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? singular + 's');
}

/**
 * Get formatted badge text for tool counts
 * @param count Number of tools
 * @param type Type of tool item ('call' or 'result')
 * @returns Formatted string like "1 tool call" or "2 results"
 */
export function getToolBadgeText(count: number, type: 'call' | 'result'): string {
  if (type === 'call') {
    return `${count} tool ${pluralize(count, 'call')}`;
  }
  return `${count} ${pluralize(count, 'result')}`;
}

// ============================================================================
// Unified Role Config
// ============================================================================

/**
 * Role configuration with icon, label, and color classes
 */
export interface RoleConfig {
  icon: string;
  label: string;
  /** Tailwind classes for background and text color */
  colorClass: string;
  /** Tailwind classes for compact/badge variant */
  colorClassCompact: string;
}

/**
 * Unified configuration for all chat message roles
 * Includes icons, labels, and color schemes for consistent styling
 */
export const ROLE_CONFIG: Record<MessageRole | 'default', RoleConfig> = {
  user: {
    icon: '👤',
    label: 'User',
    colorClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    colorClassCompact: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  },
  assistant: {
    icon: '🤖',
    label: 'Assistant',
    colorClass: 'bg-green-500/10 text-green-600 dark:text-green-400',
    colorClassCompact: 'bg-green-500/20 text-green-600 dark:text-green-400',
  },
  tool: {
    icon: '🔧',
    label: 'Tool',
    colorClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    colorClassCompact: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  },
  default: {
    icon: '💬',
    label: 'Unknown',
    colorClass: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
    colorClassCompact: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
  },
};

/**
 * Get role configuration with fallback to default
 * @param role The message role
 * @returns Role configuration object
 */
export function getRoleConfig(role: string): RoleConfig {
  return ROLE_CONFIG[role as MessageRole] ?? ROLE_CONFIG.default;
}
