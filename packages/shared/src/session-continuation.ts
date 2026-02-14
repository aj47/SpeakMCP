/**
 * Session Continuation Middleware for SpeakMCP
 * Restores external sessions from session store for seamless continuation
 */

import type { MessageSource } from './types';
import type { SessionData, SessionMessage, SessionStore } from './session-store';
import { getDefaultStore, createSessionMessage } from './session-store';
import { isExternal } from './sources';

export interface ContinuationOptions {
  /** Maximum age of session to restore (default: 24 hours) */
  maxAgeHours?: number;
  /** Whether to migrate messages to SpeakMCP format */
  migrateFormat?: boolean;
  /** Callback for when session is restored */
  onRestored?: (session: SessionData, messageCount: number) => void;
  /** Callback when session not found */
  onNotFound?: (sessionId: string) => void;
  /** Callback when session expired */
  onExpired?: (sessionId: string, age: number) => void;
}

export interface ContinuationResult {
  success: boolean;
  session?: SessionData;
  messages?: SessionMessage[];
  error?: string;
  migrated?: boolean;
}

/**
 * Restore a session from the store
 */
export async function restoreSession(
  sessionId: string,
  options: ContinuationOptions = {}
): Promise<ContinuationResult> {
  const store = getDefaultStore();
  const maxAgeHours = options.maxAgeHours ?? 24;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  try {
    const session = await store.loadSession(sessionId);

    if (!session) {
      options.onNotFound?.(sessionId);
      return { success: false, error: 'Session not found' };
    }

    // Check age
    const age = Date.now() - session.updatedAt;
    if (age > maxAgeMs) {
      options.onExpired?.(sessionId, age);
      return { success: false, error: 'Session expired' };
    }

    // Filter out thinking blocks if migrating
    let messages = session.messages;
    if (options.migrateFormat) {
      messages = migrateMessages(session.messages);
    }

    // Filter to only external messages (user + assistant)
    const externalMessages = messages.filter(
      m => m.role === 'user' || m.role === 'assistant'
    );

    options.onRestored?.(session, externalMessages.length);

    return {
      success: true,
      session,
      messages: externalMessages,
      migrated: options.migrateFormat ?? false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Migrate session messages to SpeakMCP format
 * Removes thinking blocks, normalizes content
 */
function migrateMessages(messages: SessionMessage[]): SessionMessage[] {
  return messages.map(msg => {
    // Remove thinking block markers from content
    let content = msg.content
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/\n?\[/g, '[')
      .trim();

    return {
      ...msg,
      content,
      // Ensure source is set for external messages
      source: msg.source || guessSource(msg.role, content),
    };
  });
}

/**
 * Guess message source based on role and content patterns
 */
function guessSource(role: 'user' | 'assistant' | 'tool', content: string): MessageSource {
  if (role === 'user') {
    // Check for mobile app patterns
    if (content.includes('[Photo]') || content.includes('[Location]')) {
      return 'mobile';
    }
    return 'api'; // Default for user messages from external sources
  }

  // Assistant messages
  if (content.includes('[TOOL_CALL]') || content.includes('[TOOL_RESULT]')) {
    return 'augment';
  }
  if (content.includes('Here is the plan:') || content.includes('Let me think')) {
    return 'claude-code';
  }

  return 'augment'; // Default for assistant
}

/**
 * Convert session messages to SpeakMCP chat messages
 */
export function sessionToChatMessages(
  messages: SessionMessage[],
  options: { includeToolMessages?: boolean } = {}
): Array<{
  role: 'user' | 'assistant';
  content: string;
  source?: MessageSource;
}> {
  return messages
    .filter(m => {
      if (options.includeToolMessages) return true;
      return m.role === 'user' || m.role === 'assistant';
    })
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      source: m.source,
    }));
}

/**
 * Get external session summary for display
 */
export function getSessionSummary(session: SessionData): {
  source: MessageSource;
  messageCount: number;
  duration: string;
  title: string;
} {
  const lastSource = session.metadata.lastSource || 'native';
  const userMessages = session.messages.filter(m => m.role === 'user').length;
  const duration = formatDuration(session.updatedAt - session.createdAt);
  const title = session.metadata.title || `Session ${session.id.slice(0, 8)}`;

  return {
    source: lastSource,
    messageCount: userMessages,
    duration,
    title,
  };
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Create session continuation middleware handler
 */
export function createContinuationHandler(options: ContinuationOptions = {}) {
  return async (sessionId: string): Promise<ContinuationResult> => {
    return restoreSession(sessionId, options);
  };
}

/**
 * Check if a session can be continued
 */
export async function canContinue(sessionId: string): Promise<boolean> {
  const store = getDefaultStore();
  const session = await store.loadSession(sessionId);

  if (!session) return false;
  if (session.metadata.expiresAt && Date.now() > session.metadata.expiresAt) {
    return false;
  }

  return true;
}

/**
 * List all sessions from an external source
 */
export async function listExternalSessions(
  source?: MessageSource
): Promise<Array<{ id: string; summary: ReturnType<typeof getSessionSummary> }>> {
  const store = getDefaultStore();
  const sessionIds = await store.listSessions();

  const sessions: Array<{ id: string; summary: ReturnType<typeof getSessionSummary> }> = [];

  for (const id of sessionIds) {
    try {
      const session = await store.loadSession(id);
      if (!session) continue;

      // Filter by source if specified
      const lastSource = session.metadata.lastSource;
      if (source && lastSource !== source) continue;

      // Only include sessions with external sources
      if (lastSource && isExternal(lastSource)) {
        sessions.push({
          id,
          summary: getSessionSummary(session),
        });
      }
    } catch {
      // Skip invalid sessions
    }
  }

  return sessions.sort((a, b) => {
    // Sort by most recent first
    const sessionA = sessionIds.indexOf(a.id);
    const sessionB = sessionIds.indexOf(b.id);
    return sessionB - sessionA;
  });
}
