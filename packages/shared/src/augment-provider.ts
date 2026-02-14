/**
 * Augment Session Provider
 *
 * Reads sessions from ~/.augment/sessions/ directory.
 * Sessions are JSON files with chatHistory containing exchanges.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MessageSource } from './types';
import type { SessionData, SessionMessage, SessionMetadata } from './session-store';

// Augment session file structure (partial, only what we need)
interface AugmentSessionFile {
  sessionId: string;
  title?: string;
  created: string;
  modified: string;
  workspaceId?: string;
  chatHistory?: Array<{
    exchange: {
      request_message: string;
      response_text: string;
      request_nodes?: Array<{
        type: number;
        ide_state_node?: {
          workspace_folders?: Array<{
            folder_root?: string;
            repository_root?: string;
          }>;
        };
      }>;
    };
    completed?: boolean;
    finishedAt?: string;
  }>;
}

/**
 * Get the Augment sessions directory path
 */
export function getAugmentSessionsPath(): string {
  return path.join(os.homedir(), '.augment', 'sessions');
}

/**
 * Extract workspace path from Augment session
 */
function extractWorkspacePath(session: AugmentSessionFile): string | undefined {
  // Try to get workspace from first exchange's ide_state_node
  const firstExchange = session.chatHistory?.[0]?.exchange;
  const ideStateNode = firstExchange?.request_nodes?.find(n => n.type === 4)?.ide_state_node;
  const workspaceFolder = ideStateNode?.workspace_folders?.[0];
  return workspaceFolder?.repository_root || workspaceFolder?.folder_root;
}

/**
 * Parse Augment session file to metadata (fast, minimal parsing)
 */
export async function parseAugmentSessionMetadata(
  filePath: string
): Promise<{
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: MessageSource;
  workspacePath?: string;
  messageCount: number;
  preview: string;
  filePath: string;
} | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const session: AugmentSessionFile = JSON.parse(content);

    // Extract first user message for preview
    const firstMessage = session.chatHistory?.[0]?.exchange?.request_message || '';
    const preview = firstMessage.slice(0, 200);

    return {
      id: session.sessionId,
      title: session.title || preview.slice(0, 50) || 'Untitled Session',
      createdAt: new Date(session.created).getTime(),
      updatedAt: new Date(session.modified).getTime(),
      source: 'augment' as MessageSource,
      workspacePath: extractWorkspacePath(session),
      messageCount: session.chatHistory?.length ? session.chatHistory.length * 2 : 0,
      preview,
      filePath,
    };
  } catch (error) {
    console.error(`[AugmentProvider] Failed to parse session ${filePath}:`, error);
    return null;
  }
}

/**
 * Load full Augment session data
 */
export async function loadAugmentSession(
  sessionId: string,
  filePath?: string
): Promise<(SessionData & { source: MessageSource }) | null> {
  const sessionsPath = getAugmentSessionsPath();
  const actualFilePath = filePath || path.join(sessionsPath, `${sessionId}.json`);

  try {
    const content = await fs.promises.readFile(actualFilePath, 'utf-8');
    const session: AugmentSessionFile = JSON.parse(content);

    // Convert chat history to messages
    const messages: SessionMessage[] = [];
    for (const exchange of session.chatHistory || []) {
      if (exchange.exchange.request_message) {
        messages.push({
          role: 'user',
          content: exchange.exchange.request_message,
          source: 'augment',
          timestamp: exchange.finishedAt ? new Date(exchange.finishedAt).getTime() : Date.now(),
        });
      }
      if (exchange.exchange.response_text) {
        messages.push({
          role: 'assistant',
          content: exchange.exchange.response_text,
          source: 'augment',
          timestamp: exchange.finishedAt ? new Date(exchange.finishedAt).getTime() : Date.now(),
        });
      }
    }

    const firstMessage = session.chatHistory?.[0]?.exchange?.request_message || '';

    const sessionData: SessionData & { source: MessageSource } = {
      id: session.sessionId,
      conversationId: session.sessionId,
      messages,
      metadata: {
        title: session.title || firstMessage.slice(0, 50) || 'Untitled Session',
        model: undefined,
        lastSource: 'augment',
        tags: ['augment'],
        workspacePath: extractWorkspacePath(session),
      },
      createdAt: new Date(session.created).getTime(),
      updatedAt: new Date(session.modified).getTime(),
      source: 'augment',
    };

    return sessionData;
  } catch (error) {
    console.error(`[AugmentProvider] Failed to load session ${sessionId}:`, error);
    return null;
  }
}

/**
 * List all Augment session metadata
 */
export async function listAugmentSessions(
  limit: number = 100
): Promise<Array<{
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: MessageSource;
  workspacePath?: string;
  messageCount: number;
  preview: string;
  filePath: string;
}>> {
  const sessionsPath = getAugmentSessionsPath();

  try {
    await fs.promises.access(sessionsPath, fs.constants.R_OK);
  } catch {
    // Augment not installed or sessions directory doesn't exist
    return [];
  }

  try {
    const files = await fs.promises.readdir(sessionsPath);
    const jsonFiles = files.filter(f => f.endsWith('.json')).slice(0, limit * 2);

    // Get file stats for sorting by modification time
    const fileStats = await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = path.join(sessionsPath, file);
        try {
          const stats = await fs.promises.stat(filePath);
          return { file, filePath, mtime: stats.mtimeMs };
        } catch {
          return null;
        }
      })
    );

    // Sort by modification time (most recent first) and take limit
    const sortedFiles = fileStats
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    // Parse metadata in parallel (with concurrency limit)
    const CONCURRENCY = 10;
    const results: Array<{
      id: string;
      title: string;
      createdAt: number;
      updatedAt: number;
      source: MessageSource;
      workspacePath?: string;
      messageCount: number;
      preview: string;
      filePath: string;
    }> = [];

    for (let i = 0; i < sortedFiles.length; i += CONCURRENCY) {
      const batch = sortedFiles.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(({ filePath }) => parseAugmentSessionMetadata(filePath))
      );
      results.push(...batchResults.filter((r): r is NonNullable<typeof r> => r !== null));
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error(`[AugmentProvider] Failed to list sessions:`, error);
    return [];
  }
}

/**
 * Check if Augment is available (sessions directory exists)
 */
export async function isAugmentAvailable(): Promise<boolean> {
  const sessionsPath = getAugmentSessionsPath();
  try {
    await fs.promises.access(sessionsPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
