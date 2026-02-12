/**
 * External Session Provider Types
 *
 * Defines the interface for reading sessions from external AI coding agents
 * like Augment and Claude Code.
 */

// Re-export shared types
export type { ExternalSessionSource, UnifiedConversationHistoryItem } from '../../shared/types'
import type { ExternalSessionSource } from '../../shared/types'

/**
 * Metadata for an external session (lazy-loaded, minimal data)
 */
export interface ExternalSessionMetadata {
  /** Unique identifier for the session */
  id: string
  /** Human-readable title */
  title: string
  /** When the session was created */
  createdAt: number
  /** When the session was last modified */
  updatedAt: number
  /** Source of the session */
  source: ExternalSessionSource
  /** Workspace/project path where the session was created */
  workspacePath?: string
  /** Number of messages (if available without full load) */
  messageCount?: number
  /** Preview text (first message or summary) */
  preview?: string
  /** Path to the session file (for loading full session) */
  filePath: string
}

/**
 * Full session data (loaded on demand)
 */
export interface ExternalSession extends ExternalSessionMetadata {
  /** Full conversation history */
  messages: ExternalSessionMessage[]
  /** Agent-specific metadata */
  agentMetadata?: Record<string, unknown>
}

/**
 * A message in an external session
 */
export interface ExternalSessionMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp?: number
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
}

/**
 * Options for continuing an external session
 */
export interface ContinueSessionOptions {
  /** The session to continue */
  session: ExternalSessionMetadata
  /** Override workspace path (default: use session's workspace) */
  workspacePath?: string
  /** Initial message to send (optional) */
  initialMessage?: string
}

/**
 * Result of continuing a session
 */
export interface ContinueSessionResult {
  success: boolean
  /** New session ID in SpeakMCP */
  sessionId?: string
  /** Conversation ID for tracking */
  conversationId?: string
  /** Error message if failed */
  error?: string
}

/**
 * Interface for external session providers
 */
export interface ExternalSessionProvider {
  /** Unique identifier for this provider */
  readonly source: ExternalSessionSource
  
  /** Human-readable name */
  readonly displayName: string
  
  /** Check if this provider is available (e.g., directory exists) */
  isAvailable(): Promise<boolean>
  
  /** Get session metadata (lazy, fast) */
  getSessionMetadata(limit?: number): Promise<ExternalSessionMetadata[]>
  
  /** Load full session data */
  loadSession(sessionId: string): Promise<ExternalSession | null>
  
  /** Continue a session using the appropriate agent */
  continueSession(options: ContinueSessionOptions): Promise<ContinueSessionResult>
}
