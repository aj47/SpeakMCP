import { getDb } from '../db/index.js'
import { nanoid } from 'nanoid'
import { z } from 'zod'

// Types
export const ToolCallSchema = z.object({
  name: z.string(),
  arguments: z.any(),
})

export const ToolResultSchema = z.object({
  success: z.boolean(),
  content: z.string(),
  error: z.string().optional(),
})

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  timestamp: z.number(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolResults: z.array(ToolResultSchema).optional(),
})

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(MessageSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type ToolCall = z.infer<typeof ToolCallSchema>
export type ToolResult = z.infer<typeof ToolResultSchema>
export type Message = z.infer<typeof MessageSchema>
export type Conversation = z.infer<typeof ConversationSchema>

interface DbConversation {
  id: string
  title: string
  created_at: number
  updated_at: number
}

interface DbMessage {
  id: string
  conversation_id: string
  role: string
  content: string
  timestamp: number
  tool_calls: string | null
  tool_results: string | null
}

export const conversationService = {
  // List all conversations (without messages for performance)
  list(): Array<Omit<Conversation, 'messages'> & { messageCount: number }> {
    const db = getDb()
    const rows = db.prepare(`
      SELECT c.id, c.title, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
      FROM conversations c
      ORDER BY c.updated_at DESC
    `).all() as Array<DbConversation & { message_count: number }>

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
    }))
  },

  // Get single conversation with messages
  get(id: string): Conversation | null {
    const db = getDb()

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as DbConversation | undefined

    if (!conv) return null

    const messages = db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC
    `).all(id) as DbMessage[]

    return {
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
        toolResults: m.tool_results ? JSON.parse(m.tool_results) : undefined,
      })),
    }
  },

  // Create new conversation
  create(firstMessage?: string, role: 'user' | 'assistant' = 'user'): Conversation {
    const db = getDb()
    const now = Date.now()
    const convId = `conv_${nanoid()}`

    // Generate title from first message or use default
    const title = firstMessage 
      ? (firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : ''))
      : 'New Conversation'

    db.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(convId, title, now, now)

    // Add first message if provided
    if (firstMessage) {
      const msgId = `msg_${nanoid()}`
      db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(msgId, convId, role, firstMessage, now)
    }

    return this.get(convId)!
  },

  // Add message to conversation
  addMessage(
    conversationId: string,
    content: string,
    role: 'user' | 'assistant' | 'tool',
    toolCalls?: ToolCall[],
    toolResults?: ToolResult[]
  ): Message {
    const db = getDb()
    const now = Date.now()
    const msgId = `msg_${nanoid()}`

    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_calls, tool_results)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgId,
      conversationId,
      role,
      content,
      now,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResults ? JSON.stringify(toolResults) : null
    )

    // Update conversation's updated_at
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)

    return {
      id: msgId,
      role,
      content,
      timestamp: now,
      toolCalls,
      toolResults,
    }
  },

  // Update conversation title
  updateTitle(id: string, title: string): boolean {
    const db = getDb()
    const result = db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id)
    return result.changes > 0
  },

  // Delete conversation
  delete(id: string): boolean {
    const db = getDb()
    const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
    return result.changes > 0
  },

  // Delete all conversations
  deleteAll(): number {
    const db = getDb()
    const result = db.prepare('DELETE FROM conversations').run()
    return result.changes
  },

  // Check if conversation exists
  exists(id: string): boolean {
    const db = getDb()
    const row = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id)
    return !!row
  },
}

