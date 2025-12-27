import { FastifyPluginAsync } from 'fastify'
import { agentService, type AgentProgress } from '../services/agent-service.js'
import { z } from 'zod'

const ProcessBody = z.object({
  input: z.string().min(1),
  conversationId: z.string().optional(),
  profileId: z.string().optional(),
  maxIterations: z.number().optional(),
  requireToolApproval: z.boolean().optional(),
})

const ApprovalBody = z.object({
  approved: z.boolean(),
})

export const agentRoutes: FastifyPluginAsync = async (server) => {
  // POST /api/agent/process - Process input with SSE streaming
  server.post('/agent/process', async (request, reply) => {
    const body = ProcessBody.parse(request.body)

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`)
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      for await (const progress of agentService.process(body.input, {
        conversationId: body.conversationId,
        profileId: body.profileId,
        maxIterations: body.maxIterations,
        requireToolApproval: body.requireToolApproval,
      })) {
        sendEvent(progress.type, progress)

        if (progress.type === 'done' || progress.type === 'error') {
          break
        }
      }
    } catch (error) {
      sendEvent('error', {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      reply.raw.end()
    }
  })

  // POST /api/agent/process/sync - Process input synchronously (no streaming)
  server.post('/agent/process/sync', async (request, reply) => {
    const body = ProcessBody.parse(request.body)

    const results: AgentProgress[] = []
    let finalResponse: string | undefined
    let error: string | undefined

    try {
      for await (const progress of agentService.process(body.input, {
        conversationId: body.conversationId,
        profileId: body.profileId,
        maxIterations: body.maxIterations,
        requireToolApproval: body.requireToolApproval,
      })) {
        results.push(progress)

        if (progress.type === 'response') {
          finalResponse = progress.content
        }
        if (progress.type === 'error') {
          error = progress.error
        }
        if (progress.type === 'done' || progress.type === 'error') {
          break
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error'
    }

    if (error) {
      return reply.status(500).send({ error, progress: results })
    }

    return {
      content: finalResponse,
      conversationId: results[0]?.conversationId,
      sessionId: results[0]?.sessionId,
      progress: results,
    }
  })

  // POST /api/agent/stop/:sessionId - Stop specific session
  server.post<{ Params: { sessionId: string } }>('/agent/stop/:sessionId', async (request, reply) => {
    const stopped = agentService.stopSession(request.params.sessionId)
    if (!stopped) {
      return reply.status(404).send({ error: 'Session not found or already stopped' })
    }
    return { success: true }
  })

  // POST /api/agent/stop-all - Emergency stop all sessions
  server.post('/agent/stop-all', async () => {
    const count = agentService.stopAllSessions()
    return { stopped: count }
  })

  // GET /api/agent/sessions - List all sessions
  server.get('/agent/sessions', async () => {
    return agentService.getAllSessions()
  })

  // GET /api/agent/sessions/active - List only active sessions
  server.get('/agent/sessions/active', async () => {
    return agentService.getActiveSessions()
  })

  // GET /api/agent/sessions/:sessionId - Get session details
  server.get<{ Params: { sessionId: string } }>('/agent/sessions/:sessionId', async (request, reply) => {
    const session = agentService.getSession(request.params.sessionId)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    return session
  })

  // POST /api/agent/sessions/:sessionId/approval - Respond to tool approval request
  server.post<{ Params: { sessionId: string } }>(
    '/agent/sessions/:sessionId/approval',
    async (request, reply) => {
      const body = ApprovalBody.parse(request.body)
      const responded = agentService.respondToApproval(request.params.sessionId, body.approved)
      if (!responded) {
        return reply.status(404).send({ error: 'No pending approval for this session' })
      }
      return { success: true, approved: body.approved }
    }
  )

  // POST /api/agent/cleanup - Clean up old sessions
  server.post('/agent/cleanup', async (request) => {
    const body = z.object({
      maxAgeMs: z.number().default(3600000), // 1 hour default
    }).parse(request.body ?? {})

    const cleaned = agentService.cleanupSessions(body.maxAgeMs)
    return { cleaned }
  })
}

