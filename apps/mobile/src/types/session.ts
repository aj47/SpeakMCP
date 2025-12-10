import type { ToolCall, ToolResult } from '@speakmcp/shared';

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isThinking?: boolean;
}

// Re-export shared types for convenience
export type { ToolCall, ToolResult } from '@speakmcp/shared';

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** Server-side conversation ID for continuing conversations on the SpeakMCP server */
  serverConversationId?: string;
  /** Optional metadata about the session */
  metadata?: {
    model?: string;
    totalTokens?: number;
  };
}

export interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessage: string;
  preview: string;
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a session title from the first message
 */
export function generateSessionTitle(firstMessage: string): string {
  const maxLength = 50;
  const trimmed = firstMessage.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.substring(0, maxLength - 3) + '...';
}

/**
 * Create a new session with an optional first message
 */
export function createSession(firstMessage?: string): Session {
  const now = Date.now();
  const session: Session = {
    id: generateSessionId(),
    title: firstMessage ? generateSessionTitle(firstMessage) : 'New Chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };

  if (firstMessage) {
    session.messages.push({
      id: generateMessageId(),
      role: 'user',
      content: firstMessage,
      timestamp: now,
    });
  }

  return session;
}

/**
 * Convert a Session to a SessionListItem for display in list
 */
export function sessionToListItem(session: Session): SessionListItem {
  const lastMsg = session.messages[session.messages.length - 1];
  const preview = lastMsg?.content || '';
  
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastMessage: preview.substring(0, 100),
    preview: preview.substring(0, 200),
  };
}

