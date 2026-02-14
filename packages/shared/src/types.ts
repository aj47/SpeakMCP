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
 * Session source types - identifies where a session originated from
 */
export enum SessionSourceType {
  NATIVE = 'native',
  AUGMENT = 'augment',
  CLAUDE_CODE = 'claude_code',
  EXTERNAL = 'external',
}

/**
 * Session source badge - visual indicator for session source in UI
 * Includes badges for Augment (purple A) and Claude Code (orange C)
 */
export interface SessionSourceBadge {
  type: SessionSourceType;
  label: string;
  color: string;
  icon?: string;
  /** CSS class for styling */
  cssClass?: string;
}

/**
 * Alias for SessionSourceType - used for message/source tracking
 */
export type MessageSource = SessionSourceType;

/**
 * Source mapping for session badges
 * Displays badges for Augment (purple A) and Claude Code (orange C)
 */
export const SESSION_SOURCE_BADGES: Record<SessionSourceType, SessionSourceBadge> = {
  [SessionSourceType.NATIVE]: {
    type: SessionSourceType.NATIVE,
    label: 'SpeakMCP',
    color: '#6366f1',
    cssClass: 'badge-native',
  },
  [SessionSourceType.AUGMENT]: {
    type: SessionSourceType.AUGMENT,
    label: 'A',
    color: '#8b5cf6', // Purple badge for Augment
    cssClass: 'badge-augment',
  },
  [SessionSourceType.CLAUDE_CODE]: {
    type: SessionSourceType.CLAUDE_CODE,
    label: 'C',
    color: '#f59e0b', // Orange badge for Claude Code
    cssClass: 'badge-claude-code',
  },
  [SessionSourceType.EXTERNAL]: {
    type: SessionSourceType.EXTERNAL,
    label: 'External',
    color: '#6b7280',
    cssClass: 'badge-external',
  },
};

/**
 * Conversation history message - used in API responses and conversation storage.
 * Extends BaseChatMessage with an optional timestamp.
 */
export interface ConversationHistoryMessage extends BaseChatMessage {
  timestamp?: number;
  /** Source of this message (native or external session) */
  sourceType?: SessionSourceType;
  /** Session ID for grouping messages from the same session */
  sessionId?: string;
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
 * Skill source type - identifies where a skill originated from
 */
export type SkillSource = 'local' | 'imported' | 'external' | 'bundled';

/**
 * Agent skill - represents a specialized instruction set for the AI agent.
 * Skills enhance agent capabilities on specific tasks using a simple SKILL.md format.
 * 
 * Format:
 * ---
 * name: skill-name
 * description: What this skill does
 * ---
 * 
 * # Instructions
 * [Markdown content]
 */
export interface AgentSkill {
  /** Unique identifier for the skill */
  id: string;
  /** Display name for the skill */
  name: string;
  /** Brief description of what the skill does */
  description: string;
  /** The actual instructions/content of the skill in markdown format */
  instructions: string;
  /** Whether the skill is currently enabled */
  enabled: boolean;
  /** When the skill was created (Unix timestamp in milliseconds) */
  createdAt: number;
  /** When the skill was last updated (Unix timestamp in milliseconds) */
  updatedAt: number;
  /** Source of the skill (local, imported, external, bundled) */
  source?: SkillSource;
  /** Optional path to the SKILL.md file if imported from disk */
  filePath?: string;
  /** Optional source directory name for external skills (e.g., "~/.claude/skills") */
  sourceDirectory?: string;
}

/**
 * Collection of agent skills stored in the app data folder
 */
export interface AgentSkillsData {
  skills: AgentSkill[];
}

