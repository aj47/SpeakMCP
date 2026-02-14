/**
 * Session persistence API for SpeakMCP
 * Provides session save/load functionality for external session continuation
 */

export type { MessageSource } from './types';
import { MessageSource } from './types';

export interface SessionData {
  id: string;
  conversationId: string;
  messages: SessionMessage[];
  metadata: SessionMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  source?: MessageSource;
  timestamp: number;
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

export interface SessionMetadata {
  title?: string;
  model?: string;
  lastSource?: MessageSource;
  tags?: string[];
  expiresAt?: number;
}

export interface SaveSessionOptions {
  ttlMinutes?: number;
  overwrite?: boolean;
}

export interface SessionStore {
  saveSession(data: SessionData, options?: SaveSessionOptions): Promise<void>;
  loadSession(sessionId: string): Promise<SessionData | null>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(conversationId?: string): Promise<string[]>;
}

/**
 * In-memory session store (default)
 * Useful for single-instance deployments
 */
export class MemorySessionStore implements SessionStore {
  private sessions: Map<string, SessionData> = new Map();

  async saveSession(data: SessionData, options?: SaveSessionOptions): Promise<void> {
    const existing = this.sessions.get(data.id);
    if (existing && !options?.overwrite) {
      throw new Error(`Session ${data.id} already exists`);
    }

    this.sessions.set(data.id, {
      ...data,
      updatedAt: Date.now(),
    });
  }

  async loadSession(sessionId: string): Promise<SessionData | null> {
    return this.sessions.get(sessionId) || null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listSessions(conversationId?: string): Promise<string[]> {
    const all = Array.from(this.sessions.values());
    if (conversationId) {
      return all
        .filter(s => s.conversationId === conversationId)
        .map(s => s.id);
    }
    return all.map(s => s.id);
  }
}

/**
 * File-based session store
 * Persists sessions to disk at specified directory
 * Useful for server deployments
 */
export class FileSessionStore implements SessionStore {
  private basePath: string;

  constructor(basePath: string = '~/.speakmcp/sessions') {
    this.basePath = basePath;
  }

  private getPath(sessionId: string): string {
    return `${this.basePath}/${sessionId.slice(0, 2)}/${sessionId}.json`;
  }

  async saveSession(data: SessionData, options?: SaveSessionOptions): Promise<void> {
    const fs = await import('fs/promises');
    const path = this.getPath(data.id);
    
    await fs.mkdir(path.dirname(path), { recursive: true });
    
    const payload = {
      ...data,
      updatedAt: Date.now(),
      metadata: {
        ...data.metadata,
        expiresAt: options?.ttlMinutes 
          ? Date.now() + options.ttlMinutes * 60 * 1000 
          : undefined,
      },
    };
    
    await fs.writeFile(path, JSON.stringify(payload, null, 2));
  }

  async loadSession(sessionId: string): Promise<SessionData | null> {
    const fs = await import('fs/promises');
    const path = this.getPath(sessionId);
    
    try {
      const content = await fs.readFile(path, 'utf-8');
      const data = JSON.parse(content) as SessionData;
      
      // Check expiration
      if (data.metadata.expiresAt && Date.now() > data.metadata.expiresAt) {
        await this.deleteSession(sessionId);
        return null;
      }
      
      return data;
    } catch {
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = this.getPath(sessionId);
    
    try {
      await fs.unlink(path);
    } catch {
      // Ignore errors - file might not exist
    }
  }

  async listSessions(conversationId?: string): Promise<string[]> {
    const fs = await import('fs/promises');
    
    try {
      const entries = await fs.readdir(this.basePath, { recursive: true });
      const sessions: string[] = [];
      
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          const content = await fs.readFile(`${this.basePath}/${entry}`, 'utf-8');
          const data = JSON.parse(content) as SessionData;
          
          if (!conversationId || data.conversationId === conversationId) {
            sessions.push(data.id);
          }
        }
      }
      
      return sessions;
    } catch {
      return [];
    }
  }
}

/**
 * Create a session data object
 */
export function createSession(
  id: string,
  conversationId: string,
  messages: SessionMessage[],
  metadata?: SessionMetadata
): SessionData {
  return {
    id,
    conversationId,
    messages,
    metadata: metadata || {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Create a session message
 */
export function createSessionMessage(
  role: 'user' | 'assistant' | 'tool',
  content: string,
  source?: MessageSource,
  toolCalls?: SessionMessage['toolCalls'],
  toolResults?: SessionMessage['toolResults']
): SessionMessage {
  return {
    role,
    content,
    source,
    timestamp: Date.now(),
    toolCalls,
    toolResults,
  };
}

// Default store instance
let defaultStore: SessionStore | null = null;

export function getDefaultStore(): SessionStore {
  if (!defaultStore) {
    defaultStore = new MemorySessionStore();
  }
  return defaultStore;
}

export function setDefaultStore(store: SessionStore): void {
  defaultStore = store;
}
