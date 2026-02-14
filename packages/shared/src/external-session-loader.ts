/**
 * External Session Loader for SpeakMCP
 * Parses and merges sessions from Augment, Claude Code, and other external sources
 */

import type { MessageSource } from './types';
import type { SessionData, SessionMessage } from './session-store';
import type { ExternalSession, ExternalSessionMessage } from './external-session-types';
import { createSession, createSessionMessage } from './session-store';

export interface ExternalSessionConfig {
  /** Base directory for Augment sessions */
  augmentPath?: string;
  /** Base directory for Claude Code projects */
  claudeCodePath?: string;
}

export interface ExternalMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: number;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    success: boolean;
    content: string;
    error?: string;
  }>;
}

/**
 * Augment session format parser
 * Reads sessions from ~/.augment/sessions/
 */
export async function parseAugmentSessions(
  basePath: string = `${process.env.HOME}/.augment/sessions`
): Promise<ExternalSession[]> {
  const sessions: ExternalSession[] = [];

  try {
    const fs = await import('fs/promises');
    const path = await import('path');

    // Check if directory exists
    try {
      await fs.access(basePath);
    } catch {
      return [];
    }

    // Read all session directories
    const entries = await fs.readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sessionDir = path.join(basePath, entry.name);
      const sessionJsonPath = path.join(sessionDir, 'session.json');

      try {
        const content = await fs.readFile(sessionJsonPath, 'utf-8');
        const data = JSON.parse(content);

        const messages: ExternalMessage[] = (data.messages || []).map(
          (m: {
            role: string;
            content: string;
            timestamp?: number;
            tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
            tool_results?: Array<{ success: boolean; content: string; error?: string }>;
          }) => ({
            role: m.role as 'user' | 'assistant' | 'tool',
            content: m.content || '',
            timestamp: m.timestamp,
            toolCalls: m.tool_calls?.map((tc: { name: string; arguments: Record<string, unknown> }) => ({
              name: tc.name,
              arguments: tc.arguments,
            })),
            toolResults: m.tool_results?.map(
              (tr: { success: boolean; content: string; error?: string }) => ({
                success: tr.success,
                content: tr.content,
                error: tr.error,
              })
            ),
          })
        );

        sessions.push({
          id: data.id || entry.name,
          source: 'augment',
          title: data.title || `Augment Session ${entry.name.slice(0, 8)}`,
          createdAt: data.createdAt || Date.now(),
          updatedAt: data.updatedAt || Date.now(),
          messages,
          metadata: data.metadata || {},
        });
      } catch {
        // Skip invalid sessions
        continue;
      }
    }
  } catch {
    // Directory might not exist or be readable
  }

  return sessions;
}

/**
 * Claude Code session format parser
 * Reads sessions from ~/.claude/projects/
 */
export async function parseClaudeCodeSessions(
  basePath: string = `${process.env.HOME}/.claude/projects`
): Promise<ExternalSession[]> {
  const sessions: ExternalSession[] = [];

  try {
    const fs = await import('fs/promises');
    const path = await import('path');

    // Check if directory exists
    try {
      await fs.access(basePath);
    } catch {
      return [];
    }

    // Read all project directories
    const entries = await fs.readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectDir = path.join(basePath, entry.name);
      const sessionsDir = path.join(projectDir, 'sessions');

      try {
        await fs.access(sessionsDir);
      } catch {
        continue;
      }

      // Read session files
      const sessionFiles = await fs.readdir(sessionsDir);

      for (const sessionFile of sessionFiles) {
        if (!sessionFile.endsWith('.json')) continue;

        const sessionPath = path.join(sessionsDir, sessionFile);

        try {
          const content = await fs.readFile(sessionPath, 'utf-8');
          const data = JSON.parse(content);

          const messages: ExternalMessage[] = (data.conversation || []).map(
            (m: {
              role: string;
              content: string;
              timestamp?: number;
              tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
              results?: Array<{ success: boolean; output: string; error?: string }>;
            }) => ({
              role: m.role as 'user' | 'assistant' | 'tool',
              content: m.content || '',
              timestamp: m.timestamp,
              toolCalls: m.tool_calls?.map((tc: { name: string; arguments: Record<string, unknown> }) => ({
                name: tc.name,
                arguments: tc.arguments,
              })),
              toolResults: m.results?.map(
                (r: { success: boolean; output: string; error?: string }) => ({
                  success: r.success,
                  content: r.output,
                  error: r.error,
                })
              ),
            })
          );

          sessions.push({
            id: data.sessionId || sessionFile.replace('.json', ''),
            source: 'claude-code',
            title: data.projectName || `Claude Code: ${entry.name}`,
            createdAt: data.createdAt || Date.now(),
            updatedAt: data.updatedAt || Date.now(),
            messages,
            metadata: {
              projectName: entry.name,
              ...data.metadata,
            },
          });
        } catch {
          // Skip invalid session files
          continue;
        }
      }
    }
  } catch {
    // Directory might not exist or be readable
  }

  return sessions;
}

/**
 * Parse mobile app session format
 * Handles sessions exported from the mobile app
 */
export function parseMobileSession(data: {
  id: string;
  title?: string;
  messages: Array<{
    role: string;
    content: string;
    timestamp?: number;
    tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    tool_results?: Array<{ success: boolean; content: string; error?: string }>;
  }>;
  createdAt?: number;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}): ExternalSession {
  const messages: ExternalMessage[] = (data.messages || []).map((m) => ({
    role: m.role as 'user' | 'assistant' | 'tool',
    content: m.content || '',
    timestamp: m.timestamp,
    toolCalls: m.tool_calls?.map((tc) => ({
      name: tc.name,
      arguments: tc.arguments,
    })),
    toolResults: m.tool_results?.map((tr) => ({
      success: tr.success,
      content: tr.content,
      error: tr.error,
    })),
  }));

  return {
    id: data.id,
    source: 'mobile',
    title: data.title || `Mobile Session ${data.id.slice(0, 8)}`,
    createdAt: data.createdAt || Date.now(),
    updatedAt: data.updatedAt || Date.now(),
    messages,
    metadata: data.metadata || {},
  };
}

/**
 * Convert external session message to SpeakMCP format
 */
function toSessionMessage(
  msg: ExternalMessage,
  source: MessageSource
): SessionMessage {
  return {
    role: msg.role,
    content: msg.content,
    source,
    timestamp: msg.timestamp || Date.now(),
    toolCalls: msg.toolCalls,
    toolResults: msg.toolResults,
  };
}

/**
 * Convert external session to SpeakMCP SessionData
 */
export function externalToSessionData(
  external: ExternalSession,
  conversationId?: string
): SessionData {
  return createSession(
    external.id,
    conversationId || `ext-${external.source}-${external.id.slice(0, 8)}`,
    external.messages.map((m) => toSessionMessage(m, external.source)),
    {
      title: external.title,
      lastSource: external.source,
      tags: [external.source],
      expiresAt: external.updatedAt + 7 * 24 * 60 * 60 * 1000, // 7 days
    }
  );
}

/**
 * Merge external messages with existing SpeakMCP session
 * Avoids duplicates based on content and timestamp
 */
export function mergeExternalSession(
  existing: SessionData,
  external: ExternalSession
): SessionData {
  const externalMessages = external.messages.map((m) =>
    toSessionMessage(m, external.source)
  );

  // Create a set of existing message fingerprints for deduplication
  const existingFingerprints = new Set(
    existing.messages.map((m) => `${m.role}:${m.content.slice(0, 50)}:${m.timestamp}`)
  );

  // Filter out duplicates
  const newMessages = externalMessages.filter(
    (m) => !existingFingerprints.has(`${m.role}:${m.content.slice(0, 50)}:${m.timestamp}`)
  );

  // Merge and sort by timestamp
  const mergedMessages = [...existing.messages, ...newMessages].sort(
    (a, b) => a.timestamp - b.timestamp
  );

  return {
    ...existing,
    messages: mergedMessages,
    updatedAt: Date.now(),
    metadata: {
      ...existing.metadata,
      lastSource: external.source,
    },
  };
}

/**
 * Load all external sessions from configured sources
 */
export async function loadExternalSessions(
  config?: ExternalSessionConfig
): Promise<ExternalSession[]> {
  const [augmentSessions, claudeCodeSessions] = await Promise.all([
    parseAugmentSessions(config?.augmentPath),
    parseClaudeCodeSessions(config?.claudeCodePath),
  ]);

  return [...augmentSessions, ...claudeCodeSessions];
}

/**
 * Find a session by ID across all external sources
 */
export async function findExternalSession(
  sessionId: string,
  config?: ExternalSessionConfig
): Promise<ExternalSession | null> {
  const sessions = await loadExternalSessions(config);

  return sessions.find((s) => s.id === sessionId) || null;
}

/**
 * Get recent sessions from all external sources
 */
export async function getRecentExternalSessions(
  limit: number = 10,
  config?: ExternalSessionConfig
): Promise<ExternalSession[]> {
  const sessions = await loadExternalSessions(config);

  return sessions
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
