import { getDb } from '../db/index.js'
import { nanoid } from 'nanoid'
import { z } from 'zod'

export const QueuedMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  text: z.string(),
  status: z.enum(['pending', 'processing', 'cancelled', 'failed']),
  errorMessage: z.string().optional(),
  addedToHistory: z.boolean(),
  createdAt: z.number(),
})

export type QueuedMessage = z.infer<typeof QueuedMessageSchema>

interface DbQueuedMessage {
  id: string
  conversation_id: string
  text: string
  status: string
  error_message: string | null
  added_to_history: number
  created_at: number
}

function dbRowToQueuedMessage(row: DbQueuedMessage): QueuedMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    text: row.text,
    status: row.status as QueuedMessage['status'],
    errorMessage: row.error_message ?? undefined,
    addedToHistory: row.added_to_history === 1,
    createdAt: row.created_at,
  }
}

export const queueService = {
  // Get all messages in queue for a conversation
  getQueue(conversationId: string): QueuedMessage[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM message_queue 
      WHERE conversation_id = ? 
      ORDER BY created_at ASC
    `).all(conversationId) as DbQueuedMessage[]
    return rows.map(dbRowToQueuedMessage)
  },

  // Get all pending messages across all conversations
  getAllPending(): QueuedMessage[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM message_queue 
      WHERE status = 'pending' 
      ORDER BY created_at ASC
    `).all() as DbQueuedMessage[]
    return rows.map(dbRowToQueuedMessage)
  },

  // Add message to queue
  enqueue(conversationId: string, text: string): QueuedMessage {
    const db = getDb()
    const now = Date.now()
    const id = `queue_${nanoid()}`

    db.prepare(`
      INSERT INTO message_queue (id, conversation_id, text, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(id, conversationId, text, now)

    return {
      id,
      conversationId,
      text,
      status: 'pending',
      addedToHistory: false,
      createdAt: now,
    }
  },

  // Get single queued message
  get(id: string): QueuedMessage | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM message_queue WHERE id = ?').get(id) as DbQueuedMessage | undefined
    if (!row) return null
    return dbRowToQueuedMessage(row)
  },

  // Update status
  updateStatus(id: string, status: QueuedMessage['status'], errorMessage?: string): boolean {
    const db = getDb()
    const result = db.prepare(`
      UPDATE message_queue 
      SET status = ?, error_message = ?
      WHERE id = ?
    `).run(status, errorMessage ?? null, id)
    return result.changes > 0
  },

  // Mark as added to history
  markAddedToHistory(id: string): boolean {
    const db = getDb()
    const result = db.prepare(`
      UPDATE message_queue SET added_to_history = 1 WHERE id = ?
    `).run(id)
    return result.changes > 0
  },

  // Remove from queue
  remove(id: string): boolean {
    const db = getDb()
    const result = db.prepare('DELETE FROM message_queue WHERE id = ?').run(id)
    return result.changes > 0
  },

  // Clear queue for conversation
  clearQueue(conversationId: string): number {
    const db = getDb()
    const result = db.prepare('DELETE FROM message_queue WHERE conversation_id = ?').run(conversationId)
    return result.changes
  },

  // Get next pending message for a conversation
  getNextPending(conversationId: string): QueuedMessage | null {
    const db = getDb()
    const row = db.prepare(`
      SELECT * FROM message_queue 
      WHERE conversation_id = ? AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get(conversationId) as DbQueuedMessage | undefined
    if (!row) return null
    return dbRowToQueuedMessage(row)
  },

  // Cancel all pending messages for a conversation
  cancelPending(conversationId: string): number {
    const db = getDb()
    const result = db.prepare(`
      UPDATE message_queue 
      SET status = 'cancelled'
      WHERE conversation_id = ? AND status = 'pending'
    `).run(conversationId)
    return result.changes
  },

  // Retry failed message
  retry(id: string): boolean {
    const db = getDb()
    const result = db.prepare(`
      UPDATE message_queue 
      SET status = 'pending', error_message = NULL
      WHERE id = ? AND status = 'failed'
    `).run(id)
    return result.changes > 0
  },
}

