/**
 * Tests for session-store.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemorySessionStore,
  FileSessionStore,
  createSession,
  createSessionMessage,
  type SessionData,
} from './session-store';

describe('MemorySessionStore', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore();
  });

  it('should save and load a session', async () => {
    const session = createSession('test-session-123', 'conv-456', [
      createSessionMessage('user', 'Hello', 'native'),
      createSessionMessage('assistant', 'Hi there!', 'native'),
    ], { title: 'Test Session' });

    await store.saveSession(session);
    const loaded = await store.loadSession('test-session-123');

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('test-session-123');
    expect(loaded!.conversationId).toBe('conv-456');
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.metadata.title).toBe('Test Session');
  });

  it('should return null for non-existent session', async () => {
    const loaded = await store.loadSession('non-existent');
    expect(loaded).toBeNull();
  });

  it('should delete a session', async () => {
    const session = createSession('delete-test', 'conv-789', []);
    await store.saveSession(session);
    await store.deleteSession('delete-test');

    const loaded = await store.loadSession('delete-test');
    expect(loaded).toBeNull();
  });

  it('should list sessions by conversationId', async () => {
    await store.saveSession(createSession('s1', 'conv-1', []));
    await store.saveSession(createSession('s2', 'conv-2', []));
    await store.saveSession(createSession('s3', 'conv-1', []));

    const conv1Sessions = await store.listSessions('conv-1');
    expect(conv1Sessions).toHaveLength(2);
    expect(conv1Sessions).toContain('s1');
    expect(conv1Sessions).toContain('s3');

    const conv2Sessions = await store.listSessions('conv-2');
    expect(conv2Sessions).toHaveLength(1);
    expect(conv2Sessions).toContain('s2');

    const allSessions = await store.listSessions();
    expect(allSessions).toHaveLength(3);
  });

  it('should throw when saving duplicate without overwrite', async () => {
    const session = createSession('dup-test', 'conv', []);
    await store.saveSession(session);

    await expect(store.saveSession(session)).rejects.toThrow('already exists');
  });

  it('should overwrite with overwrite option', async () => {
    const session1 = createSession('overwrite-test', 'conv', [], { title: 'Original' });
    const session2 = createSession('overwrite-test', 'conv', [], { title: 'Updated' });

    await store.saveSession(session1);
    await store.saveSession(session2, { overwrite: true });

    const loaded = await store.loadSession('overwrite-test');
    expect(loaded!.metadata.title).toBe('Updated');
  });

  it('should handle session with all message types', async () => {
    const messages = [
      createSessionMessage('user', 'Hello', 'native'),
      createSessionMessage('assistant', 'Thinking...', 'native', [
        { name: 'tool1', arguments: { param: 'value' } },
      ]),
      createSessionMessage('tool', 'Result', 'api', undefined, [
        { success: true, content: 'done' },
      ]),
    ];

    const session = createSession('full-test', 'conv', messages);
    await store.saveSession(session);

    const loaded = await store.loadSession('full-test');
    expect(loaded!.messages).toHaveLength(3);
    expect(loaded!.messages[1].toolCalls).toHaveLength(1);
    expect(loaded!.messages[2].toolResults).toHaveLength(1);
  });
});

describe('createSession', () => {
  it('should create session with correct structure', () => {
    const messages = [createSessionMessage('user', 'Hi')];
    const session = createSession('id', 'conv', messages, { title: 'Test' });

    expect(session.id).toBe('id');
    expect(session.conversationId).toBe('conv');
    expect(session.messages).toBe(messages);
    expect(session.metadata.title).toBe('Test');
    expect(session.createdAt).toBeDefined();
    expect(session.updatedAt).toBeDefined();
  });

  it('should handle empty metadata', () => {
    const session = createSession('id', 'conv', []);
    expect(session.metadata).toEqual({});
  });
});

describe('createSessionMessage', () => {
  it('should create user message', () => {
    const msg = createSessionMessage('user', 'Hello', 'native');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(msg.source).toBe('native');
    expect(msg.timestamp).toBeDefined();
  });

  it('should create assistant message with tool calls', () => {
    const toolCalls = [{ name: 'test', arguments: {} }];
    const msg = createSessionMessage('assistant', 'Result', undefined, toolCalls);
    
    expect(msg.role).toBe('assistant');
    expect(msg.toolCalls).toBe(toolCalls);
  });

  it('should create tool message with results', () => {
    const toolResults = [{ success: true, content: 'done' }];
    const msg = createSessionMessage('tool', 'Output', 'api', undefined, toolResults);
    
    expect(msg.role).toBe('tool');
    expect(msg.toolResults).toBe(toolResults);
    expect(msg.source).toBe('api');
  });
});
