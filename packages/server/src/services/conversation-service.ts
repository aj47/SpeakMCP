import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  content: string
  error?: string
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
  metadata?: {
    totalTokens?: number
    model?: string
    provider?: string
    agentMode?: boolean
  }
}

export interface ConversationHistoryItem {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  lastMessage: string
  preview: string
}

class ConversationService {
  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateTitle(firstMessage: string): string {
    const title = firstMessage.trim().slice(0, 50)
    return title.length < firstMessage.trim().length ? `${title}...` : title
  }

  private generatePreview(messages: ConversationMessage[]): string {
    const previewMessages = messages.slice(0, 3)
    const preview = previewMessages
      .map((msg) => `${msg.role}: ${msg.content.slice(0, 100)}`)
      .join(' | ')
    return preview.length > 200 ? `${preview.slice(0, 200)}...` : preview
  }

  async getConversationHistory(): Promise<ConversationHistoryItem[]> {
    const db = getDb()
    const rows = db.prepare(`
      SELECT 
        c.id,
        c.title,
        c.created_at as createdAt,
        c.updated_at as updatedAt,
        (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) as messageCount,
        (SELECT content FROM conversation_messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as lastMessage
      FROM conversations c
      ORDER BY c.updated_at DESC
    `).all() as any[]

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row.messageCount,
      lastMessage: row.lastMessage || '',
      preview: row.lastMessage?.slice(0, 100) || '',
    }))
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    const db = getDb()
    
    const convRow = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any
    if (!convRow) {
      return null
    }

    const messageRows = db.prepare(`
      SELECT * FROM conversation_messages 
      WHERE conversation_id = ? 
      ORDER BY timestamp ASC
    `).all(conversationId) as any[]

    const messages: ConversationMessage[] = messageRows.map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
    }))

    return {
      id: convRow.id,
      title: convRow.title,
      createdAt: convRow.created_at,
      updatedAt: convRow.updated_at,
      messages,
      metadata: convRow.metadata ? JSON.parse(convRow.metadata) : undefined,
    }
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const db = getDb()
    const now = Date.now()

    db.prepare(`
      INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      conversation.id,
      conversation.title,
      conversation.createdAt,
      now,
      conversation.metadata ? JSON.stringify(conversation.metadata) : null
    )

    // Delete existing messages and re-insert all
    db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(conversation.id)

    const insertMsg = db.prepare(`
      INSERT INTO conversation_messages (id, conversation_id, role, content, timestamp, tool_calls, tool_results)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    for (const msg of conversation.messages) {
      insertMsg.run(
        msg.id,
        conversation.id,
        msg.role,
        msg.content,
        msg.timestamp,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.toolResults ? JSON.stringify(msg.toolResults) : null
      )
    }
  }

  async createConversation(
    firstMessage: string,
    role: 'user' | 'assistant' = 'user'
  ): Promise<Conversation> {
    const conversationId = this.generateConversationId()
    const messageId = this.generateMessageId()
    const now = Date.now()

    const message: ConversationMessage = {
      id: messageId,
      role,
      content: firstMessage,
      timestamp: now,
    }

    const conversation: Conversation = {
      id: conversationId,
      title: this.generateTitle(firstMessage),
      createdAt: now,
      updatedAt: now,
      messages: [message],
    }

    await this.saveConversation(conversation)
    return conversation
  }

  async addMessageToConversation(
    conversationId: string,
    content: string,
    role: 'user' | 'assistant' | 'tool',
    toolCalls?: ToolCall[],
    toolResults?: ToolResult[]
  ): Promise<Conversation | null> {
    const conversation = await this.loadConversation(conversationId)
    if (!conversation) {
      return null
    }

    // Idempotency guard: avoid consecutive duplicates
    const last = conversation.messages[conversation.messages.length - 1]
    if (last && last.role === role && last.content.trim() === content.trim()) {
      await this.saveConversation(conversation)
      return conversation
    }

    const messageId = this.generateMessageId()
    const message: ConversationMessage = {
      id: messageId,
      role,
      content,
      timestamp: Date.now(),
      toolCalls,
      toolResults,
    }

    conversation.messages.push(message)
    await this.saveConversation(conversation)

    return conversation
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    const db = getDb()
    const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId)
    return result.changes > 0
  }

  async deleteAllConversations(): Promise<void> {
    const db = getDb()
    db.prepare('DELETE FROM conversation_messages').run()
    db.prepare('DELETE FROM conversations').run()
  }
}

export const conversationService = new ConversationService()
