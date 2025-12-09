/**
 * Shared types for SpeakMCP apps (desktop and mobile)
 * These types are used for communication between the mobile app and the remote server,
 * as well as for consistent data structures across both platforms.
 */

/**
 * Tool call data - represents a call to an MCP tool
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool result data - represents the result of an MCP tool execution
 */
export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

/**
 * Base chat message interface shared between desktop and mobile.
 * This is the minimal structure needed for displaying messages with tool data.
 */
export interface BaseChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

/**
 * Conversation history message - used in API responses and conversation storage.
 * Extends BaseChatMessage with an optional timestamp.
 */
export interface ConversationHistoryMessage extends BaseChatMessage {
  timestamp?: number;
}

/**
 * Chat response from the remote server API.
 * Includes the assistant's response content and optional conversation history with tool data.
 */
export interface ChatApiResponse {
  content: string;
  conversationId?: string;
  conversationHistory?: ConversationHistoryMessage[];
}

