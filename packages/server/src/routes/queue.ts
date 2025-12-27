import { FastifyPluginAsync } from 'fastify'
import { queueService } from '../services/queue-service.js'
import { conversationService } from '../services/conversation-service.js'
import { z } from 'zod'

const EnqueueBody = z.object({
  text: z.string().min(1),
})

export const queueRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/conversations/:id/queue - Get message queue for conversation
  server.get<{ Params: { id: string } }>('/conversations/:id/queue', async (request, reply) => {
    if (!conversationService.exists(request.params.id)) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    return queueService.getQueue(request.params.id)
  })

  // POST /api/conversations/:id/queue - Add message to queue
  server.post<{ Params: { id: string } }>('/conversations/:id/queue', async (request, reply) => {
    if (!conversationService.exists(request.params.id)) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    
    const body = EnqueueBody.parse(request.body)
    const message = queueService.enqueue(request.params.id, body.text)
    return reply.status(201).send(message)
  })

  // GET /api/conversations/:id/queue/:messageId - Get single queued message
  server.get<{ Params: { id: string; messageId: string } }>(
    '/conversations/:id/queue/:messageId',
    async (request, reply) => {
      const message = queueService.get(request.params.messageId)
      if (!message || message.conversationId !== request.params.id) {
        return reply.status(404).send({ error: 'Queued message not found' })
      }
      return message
    }
  )

  // DELETE /api/conversations/:id/queue/:messageId - Remove from queue
  server.delete<{ Params: { id: string; messageId: string } }>(
    '/conversations/:id/queue/:messageId',
    async (request, reply) => {
      const message = queueService.get(request.params.messageId)
      if (!message || message.conversationId !== request.params.id) {
        return reply.status(404).send({ error: 'Queued message not found' })
      }
      
      queueService.remove(request.params.messageId)
      return { success: true }
    }
  )

  // POST /api/conversations/:id/queue/:messageId/retry - Retry failed message
  server.post<{ Params: { id: string; messageId: string } }>(
    '/conversations/:id/queue/:messageId/retry',
    async (request, reply) => {
      const message = queueService.get(request.params.messageId)
      if (!message || message.conversationId !== request.params.id) {
        return reply.status(404).send({ error: 'Queued message not found' })
      }
      
      if (message.status !== 'failed') {
        return reply.status(400).send({ error: 'Only failed messages can be retried' })
      }
      
      queueService.retry(request.params.messageId)
      return queueService.get(request.params.messageId)
    }
  )

  // POST /api/conversations/:id/queue/cancel-pending - Cancel all pending messages
  server.post<{ Params: { id: string } }>(
    '/conversations/:id/queue/cancel-pending',
    async (request, reply) => {
      if (!conversationService.exists(request.params.id)) {
        return reply.status(404).send({ error: 'Conversation not found' })
      }
      
      const count = queueService.cancelPending(request.params.id)
      return { cancelled: count }
    }
  )

  // DELETE /api/conversations/:id/queue - Clear entire queue
  server.delete<{ Params: { id: string } }>('/conversations/:id/queue', async (request, reply) => {
    if (!conversationService.exists(request.params.id)) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    
    const count = queueService.clearQueue(request.params.id)
    return { cleared: count }
  })

  // GET /api/queue/pending - Get all pending messages across conversations
  server.get('/queue/pending', async () => {
    return queueService.getAllPending()
  })
}

