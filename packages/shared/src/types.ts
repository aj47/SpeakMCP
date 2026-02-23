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
  /** Unique identifier linking this tool call to its result */
  toolCallId?: string;
}

/**
 * Image attachment in a message or tool result.
 * Used for images from MCP tools, user uploads, or LLM-generated content.
 */
export interface ImageContent {
  /** Base64-encoded image data */
  base64: string;
  /** MIME type (e.g., 'image/png', 'image/jpeg') */
  mimeType: string;
  /** Optional local file URI (mobile only, not sendable to APIs) */
  uri?: string;
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
}

/**
 * Tool result data - represents the result of an MCP tool execution
 */
export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  /** Unique identifier linking this result to its tool call */
  toolCallId?: string;
  /** The name of the tool that produced this result */
  toolName?: string;
  /** Images returned by the tool (e.g., screenshots, generated charts) */
  images?: ImageContent[];
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
  /** Images attached to this message (user uploads or server-generated) */
  images?: ImageContent[];
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
  /** Indicates the message was queued instead of processed immediately */
  queued?: boolean;
  /** ID of the queued message if it was queued */
  queuedMessageId?: string;
}

/**
 * Queued message - represents a message waiting to be processed.
 * Used when the agent is busy processing and messages are queued for later.
 */
export interface QueuedMessage {
  id: string;
  conversationId: string;
  text: string;
  createdAt: number;
  status: 'pending' | 'processing' | 'cancelled' | 'failed';
  errorMessage?: string;
  /** Indicates the message was added to conversation history before processing failed */
  addedToHistory?: boolean;
  /** Image attachments queued alongside the text message */
  images?: Array<{
    uri: string;
    base64?: string;
    mimeType: string;
    width?: number;
    height?: number;
  }>;
}

/**
 * Message queue - represents a queue of messages for a conversation.
 */
export interface MessageQueue {
  conversationId: string;
  messages: QueuedMessage[];
}

