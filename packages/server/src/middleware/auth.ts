import { FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/api/health',
  '/health',
]

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip auth for public paths
  const isPublic = PUBLIC_PATHS.some(path => 
    request.url === path || request.url.startsWith(path + '?')
  )
  
  if (isPublic) {
    return
  }

  const authHeader = request.headers.authorization

  if (!authHeader) {
    return reply.status(401).send({ 
      error: 'Missing Authorization header',
      code: 'UNAUTHORIZED'
    })
  }

  // Support both "Bearer <token>" and just "<token>"
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  if (token !== config.apiKey) {
    return reply.status(401).send({ 
      error: 'Invalid API key',
      code: 'UNAUTHORIZED'
    })
  }
}

