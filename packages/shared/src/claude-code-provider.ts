/**
 * Claude Code Session Provider
 *
 * Reads sessions from ~/.claude/projects/ directory.
 * Sessions are JSONL files with one JSON object per line.
 * Project folders are named with encoded paths (e.g., -Users-ajjoobandi-Development-project)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MessageSource } from './types';
import type { SessionData, SessionMessage } from './session-store';

// Claude Code JSONL line structure (partial)
interface ClaudeCodeLine {
  type: 'user' | 'assistant' | 'system' | 'queue-operation';
  sessionId: string;
  cwd?: string;
  timestamp: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string }>;
  };
  uuid?: string;
  parentUuid?: string | null;
  gitBranch?: string;
  version?: string;
}

/**
 * Get the Claude Code projects directory path
 */
export function getClaudeProjectsPath(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Decode project folder name to workspace path
 * e.g., "-Users-ajjoobandi-Development-project" -> "/Users/ajjoobandi/Development/project"
 */
function decodeProjectPath(folderName: string): string {
  // Replace leading dash and all dashes with path separators
  return folderName.replace(/^-/, '/').replace(/-/g, '/');
}

/**
 * Parse first few lines of JSONL to get session metadata
 */
export async function parseClaudeCodeSessionMetadata(
  filePath: string,
  projectPath: string
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
    const lines = content.split('\n').filter(l => l.trim());

    if (lines.length === 0) return null;

    // Parse first line to get session info
    const firstLine: ClaudeCodeLine = JSON.parse(lines[0]);

    // Skip agent warmup files and queue operations
    if (firstLine.type === 'queue-operation') {
      // Find first actual message
      const firstMessage = lines.find(l => {
        try {
          const parsed = JSON.parse(l);
          return parsed.type === 'user' || parsed.type === 'assistant';
        } catch {
          return false;
        }
      });
      if (!firstMessage) return null;
    }

    // Find first user message for preview
    let preview = '';
    let title = '';
    for (const line of lines.slice(0, 10)) {
      try {
        const parsed: ClaudeCodeLine = JSON.parse(line);
        if (parsed.type === 'user' && parsed.message) {
          const content = parsed.message.content;
          if (typeof content === 'string') {
            preview = content.slice(0, 200);
            title = content.slice(0, 50);
          } else if (Array.isArray(content)) {
            const textContent = content.find(c => c.type === 'text')?.text || '';
            preview = textContent.slice(0, 200);
            title = textContent.slice(0, 50);
          }
          break;
        }
      } catch {
        // skip malformed lines
      }
    }

    // Get file stats for timestamps
    const stats = await fs.promises.stat(filePath);

    // Extract session ID from filename (UUID.jsonl or session-*.jsonl)
    const fileName = path.basename(filePath, '.jsonl');
    const sessionId = firstLine.sessionId || fileName;

    return {
      id: sessionId,
      title: title || fileName,
      createdAt: stats.birthtimeMs,
      updatedAt: stats.mtimeMs,
      source: 'claude-code' as MessageSource,
      workspacePath: firstLine.cwd || projectPath,
      messageCount: lines.length,
      preview,
      filePath,
    };
  } catch (error) {
    console.error(`[ClaudeCodeProvider] Failed to parse session ${filePath}:`, error);
    return null;
  }
}

/**
 * Load full Claude Code session data
 */
export async function loadClaudeCodeSession(
  sessionId: string,
  filePath: string
): Promise<(SessionData & { source: MessageSource }) | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    const messages: SessionMessage[] = [];
    let cwd: string | undefined;

    for (const line of lines) {
      try {
        const parsed: ClaudeCodeLine = JSON.parse(line);
        if (!cwd && parsed.cwd) cwd = parsed.cwd;

        if ((parsed.type === 'user' || parsed.type === 'assistant') && parsed.message) {
          const content = parsed.message.content;
          const textContent = typeof content === 'string'
            ? content
            : (content.find(c => c.type === 'text')?.text || '');

          messages.push({
            role: parsed.message.role,
            content: textContent,
            source: 'claude-code',
            timestamp: new Date(parsed.timestamp).getTime(),
          });
        }
      } catch {
        // skip malformed lines
      }
    }

    const firstMessage = messages.find(m => m.role === 'user');

    const sessionData: SessionData & { source: MessageSource } = {
      id: sessionId,
      conversationId: sessionId,
      messages,
      metadata: {
        title: firstMessage?.content.slice(0, 50) || `Claude Code ${sessionId.slice(0, 8)}`,
        model: undefined,
        lastSource: 'claude-code',
        tags: ['claude-code'],
        workspacePath: cwd,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'claude-code',
    };

    return sessionData;
  } catch (error) {
    console.error(`[ClaudeCodeProvider] Failed to load session ${sessionId}:`, error);
    return null;
  }
}

/**
 * List all Claude Code session metadata
 */
export async function listClaudeCodeSessions(
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
  const projectsPath = getClaudeProjectsPath();

  try {
    await fs.promises.access(projectsPath, fs.constants.R_OK);
  } catch {
    // Claude Code not installed or projects directory doesn't exist
    return [];
  }

  try {
    // List all project directories
    const projectDirs = await fs.promises.readdir(projectsPath);
    const allSessions: Array<{ filePath: string; projectPath: string; mtime: number }> = [];

    // Scan each project directory for session files
    for (const projectDir of projectDirs) {
      const projectFullPath = path.join(projectsPath, projectDir);
      const projectPath = decodeProjectPath(projectDir);

      try {
        const stat = await fs.promises.stat(projectFullPath);
        if (!stat.isDirectory()) continue;

        const files = await fs.promises.readdir(projectFullPath);
        for (const file of files) {
          // Only process .jsonl files that look like sessions (UUID or session-*)
          if (!file.endsWith('.jsonl')) continue;
          // Skip agent-* files (these are sub-agent warmup sessions)
          if (file.startsWith('agent-')) continue;

          const filePath = path.join(projectFullPath, file);
          try {
            const fileStat = await fs.promises.stat(filePath);
            if (fileStat.isFile()) {
              allSessions.push({ filePath, projectPath, mtime: fileStat.mtimeMs });
            }
          } catch {
            // skip inaccessible files
          }
        }
      } catch {
        // skip inaccessible directories
      }
    }

    // Sort by modification time and take limit
    const sortedSessions = allSessions
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    // Parse metadata in parallel
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

    for (let i = 0; i < sortedSessions.length; i += CONCURRENCY) {
      const batch = sortedSessions.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(({ filePath, projectPath }) => parseClaudeCodeSessionMetadata(filePath, projectPath))
      );
      results.push(...batchResults.filter((r): r is NonNullable<typeof r> => r !== null));
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error(`[ClaudeCodeProvider] Failed to list sessions:`, error);
    return [];
  }
}

/**
 * Check if Claude Code is available (projects directory exists)
 */
export async function isClaudeCodeAvailable(): Promise<boolean> {
  const projectsPath = getClaudeProjectsPath();
  try {
    await fs.promises.access(projectsPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
