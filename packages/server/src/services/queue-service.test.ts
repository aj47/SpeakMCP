import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupTestDb, teardownTestDb, resetTestDb } from '../test-utils.js'
import { queueService } from './queue-service.js'
import { conversationService } from './conversation-service.js'

describe('queueService', () => {
  let conversationId: string

  beforeAll(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    teardownTestDb()
  })

  beforeEach(() => {
    resetTestDb()
    // Create a conversation for each test
    const conv = conversationService.create('Test conversation')
    conversationId = conv.id
  })

  describe('enqueue', () => {
    it('should add a message to the queue', () => {
      const msg = queueService.enqueue(conversationId, 'Hello')

      expect(msg).toBeDefined()
      expect(msg.id).toMatch(/^queue_/)
      expect(msg.conversationId).toBe(conversationId)
      expect(msg.text).toBe('Hello')
      expect(msg.status).toBe('pending')
      expect(msg.addedToHistory).toBe(false)
    })

    it('should create messages in order', () => {
      const msg1 = queueService.enqueue(conversationId, 'First')
      const msg2 = queueService.enqueue(conversationId, 'Second')

      expect(msg2.createdAt).toBeGreaterThanOrEqual(msg1.createdAt)
    })
  })

  describe('getQueue', () => {
    it('should return empty array when queue is empty', () => {
      const queue = queueService.getQueue(conversationId)
      expect(queue).toEqual([])
    })

    it('should return all messages in order', () => {
      queueService.enqueue(conversationId, 'First')
      queueService.enqueue(conversationId, 'Second')
      queueService.enqueue(conversationId, 'Third')

      const queue = queueService.getQueue(conversationId)

      expect(queue).toHaveLength(3)
      expect(queue[0].text).toBe('First')
      expect(queue[1].text).toBe('Second')
      expect(queue[2].text).toBe('Third')
    })
  })

  describe('get', () => {
    it('should return null for non-existent message', () => {
      const msg = queueService.get('non-existent')
      expect(msg).toBeNull()
    })

    it('should return message by id', () => {
      const created = queueService.enqueue(conversationId, 'Test')
      const msg = queueService.get(created.id)

      expect(msg).not.toBeNull()
      expect(msg!.text).toBe('Test')
    })
  })

  describe('updateStatus', () => {
    it('should update message status', () => {
      const msg = queueService.enqueue(conversationId, 'Test')

      queueService.updateStatus(msg.id, 'processing')

      const updated = queueService.get(msg.id)
      expect(updated!.status).toBe('processing')
    })

    it('should update status with error message', () => {
      const msg = queueService.enqueue(conversationId, 'Test')

      queueService.updateStatus(msg.id, 'failed', 'Something went wrong')

      const updated = queueService.get(msg.id)
      expect(updated!.status).toBe('failed')
      expect(updated!.errorMessage).toBe('Something went wrong')
    })

    it('should return false for non-existent message', () => {
      const result = queueService.updateStatus('non-existent', 'processing')
      expect(result).toBe(false)
    })
  })

  describe('markAddedToHistory', () => {
    it('should mark message as added to history', () => {
      const msg = queueService.enqueue(conversationId, 'Test')

      queueService.markAddedToHistory(msg.id)

      const updated = queueService.get(msg.id)
      expect(updated!.addedToHistory).toBe(true)
    })
  })

  describe('remove', () => {
    it('should remove a message from queue', () => {
      const msg = queueService.enqueue(conversationId, 'Test')

      const removed = queueService.remove(msg.id)

      expect(removed).toBe(true)
      expect(queueService.get(msg.id)).toBeNull()
    })

    it('should return false for non-existent message', () => {
      const removed = queueService.remove('non-existent')
      expect(removed).toBe(false)
    })
  })

  describe('clearQueue', () => {
    it('should clear all messages for a conversation', () => {
      queueService.enqueue(conversationId, 'First')
      queueService.enqueue(conversationId, 'Second')
      queueService.enqueue(conversationId, 'Third')

      const count = queueService.clearQueue(conversationId)

      expect(count).toBe(3)
      expect(queueService.getQueue(conversationId)).toHaveLength(0)
    })
  })

  describe('getNextPending', () => {
    it('should return null when no pending messages', () => {
      const next = queueService.getNextPending(conversationId)
      expect(next).toBeNull()
    })

    it('should return the oldest pending message', () => {
      queueService.enqueue(conversationId, 'First')
      queueService.enqueue(conversationId, 'Second')

      const next = queueService.getNextPending(conversationId)

      expect(next).not.toBeNull()
      expect(next!.text).toBe('First')
    })

    it('should skip non-pending messages', () => {
      const msg1 = queueService.enqueue(conversationId, 'First')
      queueService.enqueue(conversationId, 'Second')

      queueService.updateStatus(msg1.id, 'processing')

      const next = queueService.getNextPending(conversationId)

      expect(next!.text).toBe('Second')
    })
  })

  describe('cancelPending', () => {
    it('should cancel all pending messages', () => {
      const msg1 = queueService.enqueue(conversationId, 'First')
      const msg2 = queueService.enqueue(conversationId, 'Second')
      queueService.updateStatus(msg1.id, 'processing')

      const count = queueService.cancelPending(conversationId)

      expect(count).toBe(1) // Only msg2 was pending
      expect(queueService.get(msg2.id)!.status).toBe('cancelled')
    })
  })

  describe('retry', () => {
    it('should retry a failed message', () => {
      const msg = queueService.enqueue(conversationId, 'Test')
      queueService.updateStatus(msg.id, 'failed', 'Error')

      const retried = queueService.retry(msg.id)

      expect(retried).toBe(true)
      const updated = queueService.get(msg.id)
      expect(updated!.status).toBe('pending')
      expect(updated!.errorMessage).toBeUndefined()
    })

    it('should return false for non-failed message', () => {
      const msg = queueService.enqueue(conversationId, 'Test')

      const retried = queueService.retry(msg.id)

      expect(retried).toBe(false)
    })
  })

  describe('getAllPending', () => {
    it('should return all pending messages across conversations', () => {
      const conv2 = conversationService.create('Another conversation')

      queueService.enqueue(conversationId, 'First')
      queueService.enqueue(conv2.id, 'Second')

      const pending = queueService.getAllPending()

      expect(pending).toHaveLength(2)
    })
  })
})

