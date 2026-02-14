/**
 * Session Continuation Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach, Mock } from 'vitest';
import {
  restoreSession,
  sessionToChatMessages,
  getSessionSummary,
  canContinue,
  listExternalSessions,
  createContinuationHandler,
} from './session-continuation';
import type { MessageSource } from './types';
import type { SessionData, SessionMessage, SessionStore } from './session-store';
import { MemorySessionStore } from './session-store';
import * as sessionStoreModule from './session-store';
import * as sourcesModule from './sources';
import * as sources from './sources';

describe('session-continuation', () => {
  let mockStore: SessionStore;
  let mockSession: SessionData;

  beforeEach(() => {
    // Create mock session
    mockSession = {
      id: 'test-session-123',
      conversationId: 'conv-456',
      messages: [
        {
          role: 'user',
          content: 'Hello, help me with coding',
          source: 'augment',
          timestamp: Date.now() - 100000,
        },
        {
          role: 'assistant',
          content: 'I can help you with that',
          source: 'augment',
          timestamp: Date.now() - 50000,
        },
        {
          role: 'user',
          content: 'Write a function',
          source: 'mobile',
          timestamp: Date.now() - 10000,
        },
        {
          role: 'assistant',
          content: 'Here is the code: ```js\nfunction test() {}\n```',
          source: 'claude-code',
          timestamp: Date.now(),
        },
      ],
      metadata: {
        title: 'Test Session',
        model: 'claude-sonnet-4',
        lastSource: 'claude-code',
        tags: ['coding'],
      },
      createdAt: Date.now() - 200000,
      updatedAt: Date.now() - 1000,
    };

    // Create mock store
    mockStore = {
      saveSession: vi.fn().mockResolvedValue(undefined),
      loadSession: vi.fn().mockResolvedValue(mockSession),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockResolvedValue(['test-session-123']),
    };

    // Mock getDefaultStore to return our mock store
    vi.spyOn(sessionStoreModule, 'getDefaultStore').mockReturnValue(mockStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('restoreSession', () => {
    it('should restore a valid session', async () => {
      const result = await restoreSession('test-session-123');

      expect(result.success).toBe(true);
      expect(result.session).toEqual(mockSession);
      expect(result.messages).toHaveLength(4);
      expect(result.error).toBeUndefined();
    });

    it('should return error for non-existent session', async () => {
      (mockStore.loadSession as any).mockResolvedValueOnce(null);

      const result = await restoreSession('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });

    it('should return error for expired session', async () => {
      const expiredSession = {
        ...mockSession,
        metadata: { ...mockSession.metadata, expiresAt: Date.now() - 1000 }
      };
      console.log('Expired session metadata:', expiredSession.metadata);

      // Use mockImplementation instead of mockResolvedValueOnce
      mockStore.loadSession = vi.fn().mockResolvedValue(expiredSession);

      const result = await restoreSession('test-session-123');

      // Debug: log the result
      console.log('Test result:', result);
      console.log('Result session metadata:', result.session?.metadata);
      console.log('Check: Date.now() =', Date.now(), ', expiresAt =', result.session?.metadata.expiresAt);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session expired');
    });

    it('should call onNotFound callback when session not found', async () => {
      (mockStore.loadSession as any).mockResolvedValueOnce(null);
      const onNotFound = vi.fn();

      await restoreSession('non-existent', { onNotFound });

      expect(onNotFound).toHaveBeenCalledWith('non-existent');
    });

    it('should call onExpired callback when session expired', async () => {
      const onExpired = vi.fn();
      const expiredSession = {
        ...mockSession,
        metadata: { ...mockSession.metadata, expiresAt: Date.now() - 1000 }
      };
      (mockStore.loadSession as any).mockResolvedValueOnce(expiredSession);

      await restoreSession('test-session-123', { onExpired });

      expect(onExpired).toHaveBeenCalled();
    });

    it('should call onRestored callback when session restored', async () => {
      const onRestored = vi.fn();

      await restoreSession('test-session-123', { onRestored });

      expect(onRestored).toHaveBeenCalledWith(mockSession, 4);
    });

    it('should filter to user and assistant messages only by default', async () => {
      const result = await restoreSession('test-session-123');

      expect(result.messages?.every(m => m.role === 'user' || m.role === 'assistant')).toBe(true);
    });

    it('should migrate messages when migrateFormat is true', async () => {
      mockSession.messages[1] = {
        role: 'assistant',
        content: '<thinking>Let me think about this</thinking>Here is the answer',
        source: 'augment',
        timestamp: Date.now(),
      };

      const result = await restoreSession('test-session-123', { migrateFormat: true });

      expect(result.migrated).toBe(true);
      expect(result.messages?.find(m => m.content.includes('Let me think'))?.content).toBeUndefined();
    });
  });

  describe('sessionToChatMessages', () => {
    it('should convert session messages to chat format', () => {
      const messages = sessionToChatMessages(mockSession.messages);

      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'Hello, help me with coding',
        source: 'augment',
      });
    });

    it('should exclude tool messages when includeToolMessages is false', () => {
      const messages = sessionToChatMessages(mockSession.messages, { includeToolMessages: false });

      expect(messages.every(m => m.role === 'user' || m.role === 'assistant')).toBe(true);
    });
  });

  describe('getSessionSummary', () => {
    it('should return session summary', () => {
      const summary = getSessionSummary(mockSession);

      expect(summary.source).toBe('claude-code');
      expect(summary.messageCount).toBe(2); // 2 user messages
      expect(summary.title).toBe('Test Session');
    });

    it('should use default title when not provided', () => {
      delete mockSession.metadata.title;

      const summary = getSessionSummary(mockSession);

      expect(summary.title).toContain('Session');
    });

    it('should format duration correctly', () => {
      const summary = getSessionSummary(mockSession);

      expect(summary.duration).toBeDefined();
    });
  });

  describe('canContinue', () => {
    it('should return true for valid session', async () => {
      const result = await canContinue('test-session-123');

      expect(result).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      (mockStore.loadSession as any).mockResolvedValueOnce(null);

      const result = await canContinue('non-existent');

      expect(result).toBe(false);
    });

    it('should return false for expired session', async () => {
      const expiredSession = {
        ...mockSession,
        metadata: { ...mockSession.metadata, expiresAt: Date.now() - 1000 }
      };
      (mockStore.loadSession as any).mockResolvedValueOnce(expiredSession);

      const result = await canContinue('test-session-123');

      expect(result).toBe(false);
    });
  });

  describe('listExternalSessions', () => {
    it('should list sessions from external sources', async () => {
      const sessions = await listExternalSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('test-session-123');
    });

    it('should filter by specific source', async () => {
      mockSession.metadata.lastSource = 'augment';
      (mockStore.loadSession as any).mockResolvedValueOnce(mockSession);

      const sessions = await listExternalSessions('augment');

      expect(sessions).toHaveLength(1);
    });

    it('should return empty array for no matching sessions', async () => {
      mockSession.metadata.lastSource = 'native';
      (mockStore.loadSession as any).mockResolvedValueOnce(mockSession);

      const sessions = await listExternalSessions('api');

      expect(sessions).toHaveLength(0);
    });
  });

  describe('createContinuationHandler', () => {
    it('should create a handler function', async () => {
      const handler = createContinuationHandler();
      expect(typeof handler).toBe('function');

      const result = await handler('test-session-123');
      expect(result.success).toBe(true);
    });

    it('should pass options to restoreSession', async () => {
      const onRestored = vi.fn();
      const handler = createContinuationHandler({ onRestored });

      await handler('test-session-123');

      expect(onRestored).toHaveBeenCalled();
    });
  });
});
