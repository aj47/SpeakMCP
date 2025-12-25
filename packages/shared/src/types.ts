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
}

/**
 * Message queue - represents a queue of messages for a conversation.
 */
export interface MessageQueue {
  conversationId: string;
  messages: QueuedMessage[];
}

/**
 * Agent progress step - represents a single step in agent execution.
 * Used for tracking and displaying agent progress in both desktop and mobile.
 */
export interface AgentProgressStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'completion' | 'tool_approval' | 'response' | 'error' | 'pending_approval';
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error' | 'awaiting_approval';
  timestamp: number;
  /** @deprecated Use llmContent instead. Kept for backward compatibility. */
  content?: string;
  llmContent?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  approvalRequest?: {
    approvalId: string;
    toolName: string;
    arguments: unknown;
  };
}

/**
 * Agent progress update - represents the current state of an agent session.
 * Used for real-time updates between desktop/mobile and the agent backend.
 */
export interface AgentProgressUpdate {
  sessionId: string;
  conversationId?: string;
  conversationTitle?: string;
  currentIteration: number;
  maxIterations: number;
  steps: AgentProgressStep[];
  isComplete: boolean;
  isSnoozed?: boolean;
  finalContent?: string;
  conversationHistory?: ConversationHistoryMessage[];
  sessionStartIndex?: number;
  pendingToolApproval?: {
    approvalId: string;
    toolName: string;
    arguments: unknown;
  };
  retryInfo?: {
    isRetrying: boolean;
    attempt: number;
    maxAttempts?: number;
    delaySeconds: number;
    reason: string;
    startedAt: number;
  };
  streamingContent?: {
    text: string;
    isStreaming: boolean;
  };
  contextInfo?: {
    estTokens: number;
    maxTokens: number;
  };
  modelInfo?: {
    provider: string;
    model: string;
  };
  /** Profile name associated with this session (from profile snapshot) */
  profileName?: string;
}

