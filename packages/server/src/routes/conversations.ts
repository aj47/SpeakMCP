import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { conversationService } from '../services/conversation-service.js'
import { NotFoundError, ValidationError } from '../middleware/error-handler.js'
import { getDb } from '../db/index.js'

const CreateConversationSchema = z.object({
  firstMessage: z.string().min(1),
  role: z.enum(['user', 'assistant']).default('user'),
})

const AddMessageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(['user', 'assistant', 'tool']),
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.record(z.unknown()),
  })).optional(),
  toolResults: z.array(z.object({
    success: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
  })).optional(),
})

const QueueMessageSchema = z.object({
  text: z.string().min(1),
})

export const conversationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/conversations - List conversations
  fastify.get('/', async () => {
    const conversations = await conversationService.getConversationHistory()
    return { conversations }
  })

  // POST /api/conversations - Create conversation
  fastify.post('/', async (request) => {
    const parseResult = CreateConversationSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid conversation data', parseResult.error.errors)
    }

    const { firstMessage, role } = parseResult.data
    const conversation = await conversationService.createConversation(firstMessage, role)
    
    return { conversation }
  })

  // GET /api/conversations/:id - Load conversation
  fastify.get<{ Params: { id: string } }>('/:id', async (request) => {
    const conversation = await conversationService.loadConversation(request.params.id)
    if (!conversation) {
      throw new NotFoundError(`Conversation ${request.params.id} not found`)
    }
    return { conversation }
  })

  // PUT /api/conversations/:id - Save conversation
  fastify.put<{ Params: { id: string } }>('/:id', async (request) => {
    const conversation = await conversationService.loadConversation(request.params.id)
    if (!conversation) {
      throw new NotFoundError(`Conversation ${request.params.id} not found`)
    }

    // Update with provided data
    const body = request.body as any
    if (body.title) conversation.title = body.title
    if (body.metadata) conversation.metadata = { ...conversation.metadata, ...body.metadata }

    await conversationService.saveConversation(conversation)
    
    return { conversation }
  })

  // DELETE /api/conversations/:id - Delete conversation
  fastify.delete<{ Params: { id: string } }>('/:id', async (request) => {
    const deleted = await conversationService.deleteConversation(request.params.id)
    if (!deleted) {
      throw new NotFoundError(`Conversation ${request.params.id} not found`)
    }
    return { success: true }
  })

  // DELETE /api/conversations - Delete all conversations
  fastify.delete('/', async () => {
    await conversationService.deleteAllConversations()
    return { success: true }
  })

  // POST /api/conversations/:id/messages - Add message
  fastify.post<{ Params: { id: string } }>('/:id/messages', async (request) => {
    const parseResult = AddMessageSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid message data', parseResult.error.errors)
    }

    const { content, role, toolCalls, toolResults } = parseResult.data
    const conversation = await conversationService.addMessageToConversation(
      request.params.id,
      content,
      role,
      toolCalls,
      toolResults
    )

    if (!conversation) {
      throw new NotFoundError(`Conversation ${request.params.id} not found`)
    }

    return { conversation }
  })

  // Message Queue endpoints
  
  // GET /api/conversations/:id/queue - Get message queue
  fastify.get<{ Params: { id: string } }>('/:id/queue', async (request) => {
    const db = getDb()
    const messages = db.prepare(`
      SELECT * FROM message_queue 
      WHERE conversation_id = ? AND status IN ('pending', 'processing')
      ORDER BY created_at ASC
    `).all(request.params.id) as any[]

    return {
      messages: messages.map(m => ({
        id: m.id,
        conversationId: m.conversation_id,
        text: m.text,
        status: m.status,
        createdAt: m.created_at,
        errorMessage: m.error_message,
        addedToHistory: m.added_to_history === 1,
      })),
    }
  })

  // POST /api/conversations/:id/queue - Add to queue
  fastify.post<{ Params: { id: string } }>('/:id/queue', async (request) => {
    const parseResult = QueueMessageSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid queue message', parseResult.error.errors)
    }

    const db = getDb()
    const id = `qmsg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    db.prepare(`
      INSERT INTO message_queue (id, conversation_id, text, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, request.params.id, parseResult.data.text, 'pending', Date.now())

    return {
      message: {
        id,
        conversationId: request.params.id,
        text: parseResult.data.text,
        status: 'pending',
        createdAt: Date.now(),
      },
    }
  })

  // DELETE /api/conversations/:id/queue/:msgId - Remove from queue
  fastify.delete<{ Params: { id: string; msgId: string } }>('/:id/queue/:msgId', async (request) => {
    const db = getDb()
    const result = db.prepare(`
      DELETE FROM message_queue WHERE id = ? AND conversation_id = ?
    `).run(request.params.msgId, request.params.id)

    if (result.changes === 0) {
      throw new NotFoundError('Queued message not found')
    }

    return { success: true }
  })

  // PATCH /api/conversations/:id/queue/:msgId - Update queued message
  fastify.patch<{ Params: { id: string; msgId: string } }>('/:id/queue/:msgId', async (request) => {
    const body = request.body as { text?: string }
    
    if (!body.text || typeof body.text !== 'string') {
      throw new ValidationError('Missing or invalid text')
    }

    const db = getDb()
    const result = db.prepare(`
      UPDATE message_queue SET text = ? WHERE id = ? AND conversation_id = ? AND status = 'pending'
    `).run(body.text, request.params.msgId, request.params.id)

    if (result.changes === 0) {
      throw new NotFoundError('Queued message not found or not pending')
    }

    return { success: true }
  })

  // POST /api/conversations/:id/queue/pause - Pause queue processing
  // Note: This is a stub - actual implementation would track pause state
  fastify.post<{ Params: { id: string } }>('/:id/queue/pause', async (request) => {
    return { success: true, paused: true }
  })

  // POST /api/conversations/:id/queue/resume - Resume queue processing
  fastify.post<{ Params: { id: string } }>('/:id/queue/resume', async (request) => {
    return { success: true, paused: false }
  })
}
