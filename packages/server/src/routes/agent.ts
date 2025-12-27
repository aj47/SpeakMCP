import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { agentService } from '../services/agent-service.js'
import { NotFoundError, ValidationError } from '../middleware/error-handler.js'

const ProcessSchema = z.object({
  text: z.string().min(1),
  conversationId: z.string().optional(),
  profileId: z.string().optional(),
})

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/agent/process - Process text with agent mode (SSE streaming)
  fastify.post('/process', async (request, reply) => {
    const parseResult = ProcessSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid request', parseResult.error.errors)
    }

    const { text, conversationId, profileId } = parseResult.data

    // Set SSE headers
    const requestOrigin = request.headers.origin || '*'
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': requestOrigin,
      'Access-Control-Allow-Credentials': 'true',
    })

    const writeSSE = (data: object) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      for await (const update of agentService.process(text, { conversationId, profileId })) {
        writeSSE({ type: 'progress', data: update })
      }
      writeSSE({ type: 'done', data: {} })
    } catch (error: any) {
      writeSSE({
        type: 'error',
        data: { message: error?.message || 'Internal Server Error' },
      })
    } finally {
      reply.raw.end()
    }

    return reply
  })

  // POST /api/agent/stop - Emergency stop all sessions
  fastify.post('/stop', async (request) => {
    const body = request.body as { sessionId?: string } | undefined
    const result = await agentService.stop(body?.sessionId)
    return { success: true, ...result }
  })

  // POST /api/agent/stop/:sessionId - Stop specific session
  fastify.post<{ Params: { sessionId: string } }>('/stop/:sessionId', async (request) => {
    const result = await agentService.stop(request.params.sessionId)
    if (result.killed === 0) {
      throw new NotFoundError(`Session ${request.params.sessionId} not found`)
    }
    return { success: true }
  })

  // GET /api/agent/sessions - List active sessions
  fastify.get('/sessions', async () => {
    const sessions = agentService.getActiveSessions()
    return { sessions }
  })

  // GET /api/agent/sessions/:id - Get session details
  fastify.get<{ Params: { id: string } }>('/sessions/:id', async (request) => {
    const session = agentService.getSession(request.params.id)
    if (!session) {
      throw new NotFoundError(`Session ${request.params.id} not found`)
    }
    return { session }
  })

  // POST /api/agent/sessions/:id/snooze - Snooze session
  fastify.post<{ Params: { id: string } }>('/sessions/:id/snooze', async (request) => {
    const session = agentService.getSession(request.params.id)
    if (!session) {
      throw new NotFoundError(`Session ${request.params.id} not found`)
    }
    agentService.snoozeSession(request.params.id)
    return { success: true }
  })

  // POST /api/agent/sessions/:id/unsnooze - Unsnooze session
  fastify.post<{ Params: { id: string } }>('/sessions/:id/unsnooze', async (request) => {
    const session = agentService.getSession(request.params.id)
    if (!session) {
      throw new NotFoundError(`Session ${request.params.id} not found`)
    }
    agentService.unsnoozeSession(request.params.id)
    return { success: true }
  })

  // POST /api/agent/tool-approval/:id - Respond to tool approval request
  fastify.post<{ Params: { id: string } }>('/tool-approval/:id', async (request) => {
    const body = request.body as { approved: boolean }
    
    if (typeof body.approved !== 'boolean') {
      throw new ValidationError('Missing or invalid approved field')
    }

    // TODO: Implement tool approval handling
    return {
      success: true,
      message: 'Tool approval handling not yet implemented',
    }
  })
}
