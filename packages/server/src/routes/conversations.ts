import { FastifyPluginAsync } from 'fastify'
import { conversationService } from '../services/conversation-service.js'
import { z } from 'zod'

const CreateConversationBody = z.object({
  message: z.string().optional(),
  role: z.enum(['user', 'assistant']).default('user'),
})

const UpdateConversationBody = z.object({
  title: z.string().min(1),
})

const AddMessageBody = z.object({
  content: z.string().min(1),
  role: z.enum(['user', 'assistant', 'tool']),
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.any(),
  })).optional(),
  toolResults: z.array(z.object({
    success: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
  })).optional(),
})

export const conversationRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/conversations - List all conversations
  server.get('/conversations', async () => {
    return conversationService.list()
  })

  // POST /api/conversations - Create new conversation
  server.post('/conversations', async (request, reply) => {
    const body = CreateConversationBody.parse(request.body)
    const conversation = conversationService.create(body.message, body.role)
    return reply.status(201).send(conversation)
  })

  // GET /api/conversations/:id - Get single conversation
  server.get<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const conversation = conversationService.get(request.params.id)
    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    return conversation
  })

  // PATCH /api/conversations/:id - Update conversation (e.g., title)
  server.patch<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const body = UpdateConversationBody.parse(request.body)
    const success = conversationService.updateTitle(request.params.id, body.title)
    if (!success) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    return conversationService.get(request.params.id)
  })

  // DELETE /api/conversations/:id - Delete single conversation
  server.delete<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const deleted = conversationService.delete(request.params.id)
    if (!deleted) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    return { success: true }
  })

  // DELETE /api/conversations - Delete all conversations
  server.delete('/conversations', async () => {
    const count = conversationService.deleteAll()
    return { deleted: count }
  })

  // POST /api/conversations/:id/messages - Add message to conversation
  server.post<{ Params: { id: string } }>('/conversations/:id/messages', async (request, reply) => {
    const body = AddMessageBody.parse(request.body)

    // Check conversation exists
    if (!conversationService.exists(request.params.id)) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }

    const message = conversationService.addMessage(
      request.params.id,
      body.content,
      body.role,
      body.toolCalls,
      body.toolResults
    )
    return reply.status(201).send(message)
  })

  // GET /api/conversations/:id/messages - Get all messages (alternative endpoint)
  server.get<{ Params: { id: string } }>('/conversations/:id/messages', async (request, reply) => {
    const conversation = conversationService.get(request.params.id)
    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    return conversation.messages
  })
}

