/**
 * Tests for External Session Loader
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseAugmentSessions,
  parseClaudeCodeSessions,
  parseMobileSession,
  externalToSessionData,
  mergeExternalSession,
  loadExternalSessions,
  findExternalSession,
  getRecentExternalSessions,
} from './external-session-loader';
import type { ExternalSession } from './external-session-loader';

describe('External Session Loader', () => {
  describe('parseAugmentSessions', () => {
    it('returns empty array when directory does not exist', async () => {
      const sessions = await parseAugmentSessions('/nonexistent/path');
      expect(sessions).toEqual([]);
    });

    it('parses valid Augment session format', async () => {
      const mockFs = {
        access: vi.fn().mockResolvedValue(undefined),
        readdir: vi.fn().mockResolvedValue(['session-abc123']),
      };

      const mockFsPromises = {
        ...mockFs,
        readFile: vi.fn().mockResolvedValue(
          JSON.stringify({
            id: 'session-abc123',
            title: 'Test Session',
            createdAt: 1700000000000,
            updatedAt: 1700001000000,
            messages: [
              {
                role: 'user',
                content: 'Hello',
                timestamp: 1700000001000,
              },
              {
                role: 'assistant',
                content: 'Hi there!',
                timestamp: 1700000002000,
                tool_calls: [
                  { name: 'test-tool', arguments: { foo: 'bar' } },
                ],
              },
            ],
            metadata: { model: 'claude-sonnet-4' },
          })
        ),
      };

      vi.doMock('fs/promises', () => mockFsPromises);

      // Re-import to get fresh module with mock
      const { parseAugmentSessions: parse } = await import('./external-session-loader');
      const sessions = await parse('/test/path');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        id: 'session-abc123',
        source: 'augment',
        title: 'Test Session',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Hello' }),
          expect.objectContaining({ role: 'assistant', content: 'Hi there!' }),
        ]),
      });
    });
  });

  describe('parseClaudeCodeSessions', () => {
    it('returns empty array when directory does not exist', async () => {
      const sessions = await parseClaudeCodeSessions('/nonexistent/path');
      expect(sessions).toEqual([]);
    });

    it('parses valid Claude Code session format', async () => {
      const mockFs = {
        access: vi.fn().mockResolvedValue(undefined),
        readdir: vi.fn()
          .mockResolvedValueOnce(['my-project'])
          .mockResolvedValueOnce(['session-xyz789.json']),
        readFile: vi.fn().mockResolvedValue(
          JSON.stringify({
            sessionId: 'session-xyz789',
            projectName: 'my-project',
            createdAt: 1700000000000,
            updatedAt: 1700001000000,
            conversation: [
              {
                role: 'user',
                content: 'Help me write code',
                timestamp: 1700000001000,
              },
            ],
            metadata: {},
          })
        ),
      };

      vi.doMock('fs/promises', () => mockFs);

      const { parseClaudeCodeSessions: parse } = await import('./external-session-loader');
      const sessions = await parse('/test/path');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        id: 'session-xyz789',
        source: 'claude-code',
        title: 'Claude Code: my-project',
      });
    });
  });

  describe('parseMobileSession', () => {
    it('parses valid mobile session format', () => {
      const input = {
        id: 'mobile-session-123',
        title: 'Mobile Test',
        messages: [
          { role: 'user', content: 'Test message' },
          { role: 'assistant', content: 'Response' },
        ],
        createdAt: 1700000000000,
        updatedAt: 1700001000000,
        metadata: { platform: 'ios' },
      };

      const result = parseMobileSession(input);

      expect(result).toMatchObject({
        id: 'mobile-session-123',
        source: 'mobile',
        title: 'Mobile Test',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Test message' }),
          expect.objectContaining({ role: 'assistant', content: 'Response' }),
        ]),
      });
    });

    it('uses defaults for missing fields', () => {
      const input = {
        id: 'mobile-session-456',
        messages: [{ role: 'user', content: 'Test' }],
      };

      const result = parseMobileSession(input);

      expect(result.id).toBe('mobile-session-456');
      expect(result.source).toBe('mobile');
      expect(result.title).toContain('Mobile Session');
    });
  });

  describe('externalToSessionData', () => {
    it('converts external session to SessionData', () => {
      const external: ExternalSession = {
        id: 'ext-123',
        source: 'augment',
        title: 'External Session',
        createdAt: 1700000000000,
        updatedAt: 1700001000000,
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1700000001000 },
          { role: 'assistant', content: 'Hi!', timestamp: 1700000002000 },
        ],
        metadata: {},
      };

      const result = externalToSessionData(external, 'conv-123');

      expect(result.id).toBe('ext-123');
      expect(result.conversationId).toBe('conv-123');
      expect(result.messages).toHaveLength(2);
      expect(result.metadata.lastSource).toBe('augment');
      expect(result.metadata.tags).toContain('augment');
    });

    it('generates conversation ID if not provided', () => {
      const external: ExternalSession = {
        id: 'ext-456',
        source: 'claude-code',
        title: 'Claude Code Session',
        createdAt: 1700000000000,
        updatedAt: 1700001000000,
        messages: [],
        metadata: {},
      };

      const result = externalToSessionData(external);

      expect(result.conversationId).toContain('ext-claude-code-');
    });
  });

  describe('mergeExternalSession', () => {
    it('merges new messages from external session', () => {
      const existing = {
        id: 'existing-123',
        conversationId: 'conv-123',
        messages: [
          { role: 'user', content: 'First message', source: 'native', timestamp: 1000 },
        ],
        metadata: { lastSource: 'native' },
        createdAt: 0,
        updatedAt: 1000,
      } as any;

      const external: ExternalSession = {
        id: 'external-456',
        source: 'augment',
        title: 'External',
        createdAt: 0,
        updatedAt: 2000,
        messages: [
          { role: 'user', content: 'Second message', timestamp: 2000 },
          { role: 'assistant', content: 'Response', timestamp: 3000 },
        ],
        metadata: {},
      };

      const result = mergeExternalSession(existing, external);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].content).toBe('First message');
      expect(result.messages[1].content).toBe('Second message');
      expect(result.messages[2].content).toBe('Response');
      expect(result.metadata.lastSource).toBe('augment');
    });

    it('avoids duplicate messages', () => {
      const existing = {
        id: 'existing-123',
        conversationId: 'conv-123',
        messages: [
          {
            role: 'user',
            content: 'Same message',
            source: 'augment',
            timestamp: 1000,
          },
        ],
        metadata: { lastSource: 'native' },
        createdAt: 0,
        updatedAt: 1000,
      } as any;

      const external: ExternalSession = {
        id: 'external-456',
        source: 'augment',
        title: 'External',
        createdAt: 0,
        updatedAt: 2000,
        messages: [
          {
            role: 'user',
            content: 'Same message',
            timestamp: 1000,
          },
        ],
        metadata: {},
      };

      const result = mergeExternalSession(existing, external);

      expect(result.messages).toHaveLength(1);
    });
  });

  describe('loadExternalSessions', () => {
    it('loads from both Augment and Claude Code sources', async () => {
      const mockConfig = {
        augmentPath: '/mock/augment',
        claudeCodePath: '/mock/claude',
      };

      vi.doMock('fs/promises', () => ({
        access: vi.fn().mockRejectedValue(new Error('ENOENT')),
        readdir: vi.fn().mockResolvedValue([]),
        readFile: vi.fn(),
      }));

      const { loadExternalSessions } = await import('./external-session-loader');
      const sessions = await loadExternalSessions(mockConfig);

      expect(sessions).toEqual([]);
    });
  });

  describe('findExternalSession', () => {
    it('returns null when session not found', async () => {
      vi.doMock('fs/promises', () => ({
        access: vi.fn().mockRejectedValue(new Error('ENOENT')),
        readdir: vi.fn().mockResolvedValue([]),
        readFile: vi.fn(),
      }));

      const { findExternalSession } = await import('./external-session-loader');
      const result = await findExternalSession('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getRecentExternalSessions', () => {
    it('returns sessions sorted by updatedAt', async () => {
      const sessions: ExternalSession[] = [
        {
          id: 'old',
          source: 'augment',
          title: 'Old',
          createdAt: 0,
          updatedAt: 1000,
          messages: [],
          metadata: {},
        },
        {
          id: 'new',
          source: 'claude-code',
          title: 'New',
          createdAt: 0,
          updatedAt: 3000,
          messages: [],
          metadata: {},
        },
        {
          id: 'medium',
          source: 'mobile',
          title: 'Medium',
          createdAt: 0,
          updatedAt: 2000,
          messages: [],
          metadata: {},
        },
      ];

      vi.doMock('fs/promises', () => ({
        access: vi.fn().mockRejectedValue(new Error('ENOENT')),
        readdir: vi.fn().mockResolvedValue([]),
        readFile: vi.fn(),
      }));

      // Mock loadExternalSessions
      vi.doMock('./external-session-loader', () => ({
        loadExternalSessions: vi.fn().mockResolvedValue(sessions),
      }));

      const { getRecentExternalSessions } = await import('./external-session-loader');
      const result = await getRecentExternalSessions(10);

      expect(result[0].id).toBe('new');
      expect(result[1].id).toBe('medium');
      expect(result[2].id).toBe('old');
    });

    it('limits results to specified count', async () => {
      const sessions: ExternalSession[] = Array.from({ length: 5 }, (_, i) => ({
        id: `session-${i}`,
        source: 'augment' as const,
        title: `Session ${i}`,
        createdAt: 0,
        updatedAt: 1000 * (i + 1),
        messages: [],
        metadata: {},
      }));

      vi.doMock('fs/promises', () => ({
        access: vi.fn().mockRejectedValue(new Error('ENOENT')),
        readdir: vi.fn().mockResolvedValue([]),
        readFile: vi.fn(),
      }));

      const { getRecentExternalSessions } = await import('./external-session-loader');
      const result = await getRecentExternalSessions(3);

      expect(result).toHaveLength(3);
    });
  });
});
