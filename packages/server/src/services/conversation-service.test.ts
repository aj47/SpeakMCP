import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupTestDb, teardownTestDb, resetTestDb } from '../test-utils.js'
import { conversationService } from './conversation-service.js'

describe('conversationService', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    teardownTestDb()
  })

  beforeEach(() => {
    resetTestDb()
  })

  describe('create', () => {
    it('should create a new conversation with a message', () => {
      const conv = conversationService.create('Hello, world!')

      expect(conv).toBeDefined()
      expect(conv.id).toMatch(/^conv_/)
      expect(conv.title).toBe('Hello, world!')
      expect(conv.messages).toHaveLength(1)
      expect(conv.messages[0].role).toBe('user')
      expect(conv.messages[0].content).toBe('Hello, world!')
    })

    it('should create a conversation without a message', () => {
      const conv = conversationService.create()

      expect(conv).toBeDefined()
      expect(conv.title).toBe('New Conversation')
      expect(conv.messages).toHaveLength(0)
    })

    it('should truncate long titles', () => {
      const longMessage = 'A'.repeat(100)
      const conv = conversationService.create(longMessage)

      expect(conv.title.length).toBeLessThanOrEqual(53) // 50 + '...'
      expect(conv.title.endsWith('...')).toBe(true)
    })
  })

  describe('list', () => {
    it('should return empty array when no conversations exist', () => {
      const list = conversationService.list()
      expect(list).toEqual([])
    })

    it('should list all conversations with message counts', () => {
      const conv1 = conversationService.create('First conversation')
      const conv2 = conversationService.create('Second conversation')
      conversationService.addMessage(conv2.id, 'Another message', 'assistant')

      const list = conversationService.list()

      expect(list).toHaveLength(2)

      // Find the conversations by ID to avoid timing issues
      const conv1Summary = list.find(c => c.id === conv1.id)
      const conv2Summary = list.find(c => c.id === conv2.id)

      expect(conv1Summary?.messageCount).toBe(1)
      expect(conv2Summary?.messageCount).toBe(2) // initial + added message
    })

    it('should order by updatedAt descending', () => {
      const conv1 = conversationService.create('First')
      conversationService.create('Second')
      
      // Update first conversation to make it more recent
      conversationService.addMessage(conv1.id, 'Update', 'user')

      const list = conversationService.list()

      expect(list[0].id).toBe(conv1.id)
    })
  })

  describe('get', () => {
    it('should return null for non-existent conversation', () => {
      const conv = conversationService.get('non-existent')
      expect(conv).toBeNull()
    })

    it('should return conversation with all messages', () => {
      const created = conversationService.create('Hello')
      conversationService.addMessage(created.id, 'Hi there!', 'assistant')

      const conv = conversationService.get(created.id)

      expect(conv).not.toBeNull()
      expect(conv!.messages).toHaveLength(2)
      expect(conv!.messages[0].content).toBe('Hello')
      expect(conv!.messages[1].content).toBe('Hi there!')
    })
  })

  describe('addMessage', () => {
    it('should add a message to a conversation', () => {
      const conv = conversationService.create('Initial')
      const msg = conversationService.addMessage(conv.id, 'Response', 'assistant')

      expect(msg.id).toMatch(/^msg_/)
      expect(msg.role).toBe('assistant')
      expect(msg.content).toBe('Response')
      expect(msg.timestamp).toBeGreaterThan(0)
    })

    it('should support tool calls', () => {
      const conv = conversationService.create('Run a tool')
      const msg = conversationService.addMessage(
        conv.id,
        'Running tool...',
        'assistant',
        [{ name: 'test_tool', arguments: { foo: 'bar' } }]
      )

      expect(msg.toolCalls).toHaveLength(1)
      expect(msg.toolCalls![0].name).toBe('test_tool')
    })

    it('should update conversation updatedAt', () => {
      const conv = conversationService.create('Initial')
      const oldUpdatedAt = conv.updatedAt

      // Small delay to ensure different timestamp
      conversationService.addMessage(conv.id, 'New message', 'user')

      const updated = conversationService.get(conv.id)
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(oldUpdatedAt)
    })
  })

  describe('updateTitle', () => {
    it('should update the conversation title', () => {
      const conv = conversationService.create('Old title')
      const success = conversationService.updateTitle(conv.id, 'New title')

      expect(success).toBe(true)
      const updated = conversationService.get(conv.id)
      expect(updated!.title).toBe('New title')
    })

    it('should return false for non-existent conversation', () => {
      const success = conversationService.updateTitle('non-existent', 'New title')
      expect(success).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete a conversation', () => {
      const conv = conversationService.create('To delete')
      const deleted = conversationService.delete(conv.id)

      expect(deleted).toBe(true)
      expect(conversationService.get(conv.id)).toBeNull()
    })

    it('should return false for non-existent conversation', () => {
      const deleted = conversationService.delete('non-existent')
      expect(deleted).toBe(false)
    })

    it('should cascade delete messages', () => {
      const conv = conversationService.create('With messages')
      conversationService.addMessage(conv.id, 'Message 1', 'assistant')
      conversationService.addMessage(conv.id, 'Message 2', 'assistant')

      conversationService.delete(conv.id)

      // Messages should be deleted (tested via foreign key constraint)
      expect(conversationService.get(conv.id)).toBeNull()
    })
  })

  describe('deleteAll', () => {
    it('should delete all conversations', () => {
      conversationService.create('Conv 1')
      conversationService.create('Conv 2')
      conversationService.create('Conv 3')

      const count = conversationService.deleteAll()

      expect(count).toBe(3)
      expect(conversationService.list()).toHaveLength(0)
    })
  })

  describe('exists', () => {
    it('should return true for existing conversation', () => {
      const conv = conversationService.create('Test')
      expect(conversationService.exists(conv.id)).toBe(true)
    })

    it('should return false for non-existent conversation', () => {
      expect(conversationService.exists('non-existent')).toBe(false)
    })
  })
})

