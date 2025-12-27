import type { FastifyRequest, FastifyReply } from 'fastify'
import { configService } from '../services/config-service.js'

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip auth for OPTIONS (CORS preflight) and health check
  if (request.method === 'OPTIONS' || request.url === '/api/health') {
    return
  }

  const apiKey = request.headers['x-api-key'] as string | undefined
  const authHeader = request.headers['authorization'] as string | undefined
  
  // Support both X-API-Key header and Bearer token
  const token = apiKey || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined)
  
  if (!token) {
    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing API key. Provide X-API-Key header or Bearer token.',
      }
    })
    return
  }

  const config = await configService.get()
  const validApiKey = config.serverApiKey

  if (!validApiKey || token !== validApiKey) {
    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key.',
      }
    })
    return
  }
}
