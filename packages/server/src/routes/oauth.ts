import { FastifyPluginAsync } from 'fastify'
import { oauthService } from '../services/oauth-service.js'
import { z } from 'zod'

const StoreTokenBody = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  tokenType: z.string().default('Bearer'),
  expiresIn: z.number().optional(),
  scope: z.string().optional(),
})

export const oauthRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/oauth/tokens - List all tokens (metadata only, no secrets)
  server.get('/oauth/tokens', async () => {
    return oauthService.listTokens()
  })

  // GET /api/oauth/tokens/:serverName - Get token status for a server
  server.get<{ Params: { serverName: string } }>('/oauth/tokens/:serverName', async (request, reply) => {
    const token = oauthService.getToken(request.params.serverName)
    if (!token) {
      return reply.status(404).send({ error: 'No token found for this server' })
    }

    // Don't expose the actual token values
    return {
      serverName: token.serverName,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt,
      scope: token.scope,
      isExpired: oauthService.isTokenExpired(request.params.serverName),
      hasRefreshToken: !!token.refreshToken,
    }
  })

  // POST /api/oauth/tokens/:serverName - Store a token
  server.post<{ Params: { serverName: string } }>('/oauth/tokens/:serverName', async (request, reply) => {
    const body = StoreTokenBody.parse(request.body)
    
    const token = oauthService.storeToken(request.params.serverName, body.accessToken, {
      refreshToken: body.refreshToken,
      tokenType: body.tokenType,
      expiresIn: body.expiresIn,
      scope: body.scope,
    })

    return reply.status(201).send({
      serverName: token.serverName,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt,
      scope: token.scope,
    })
  })

  // DELETE /api/oauth/tokens/:serverName - Delete a token
  server.delete<{ Params: { serverName: string } }>('/oauth/tokens/:serverName', async (request, reply) => {
    const deleted = oauthService.deleteToken(request.params.serverName)
    if (!deleted) {
      return reply.status(404).send({ error: 'No token found for this server' })
    }
    return { success: true }
  })

  // POST /api/oauth/tokens/:serverName/refresh - Refresh token (placeholder - actual refresh depends on OAuth provider)
  server.post<{ Params: { serverName: string } }>('/oauth/tokens/:serverName/refresh', async (request, reply) => {
    const token = oauthService.getToken(request.params.serverName)
    if (!token) {
      return reply.status(404).send({ error: 'No token found for this server' })
    }

    if (!token.refreshToken) {
      return reply.status(400).send({ error: 'No refresh token available' })
    }

    // Note: Actual token refresh would require calling the OAuth provider
    // This endpoint is a placeholder that can be extended
    return reply.status(501).send({ 
      error: 'Token refresh not implemented - requires OAuth provider integration',
      hint: 'Use POST /oauth/tokens/:serverName with new tokens after manual refresh'
    })
  })

  // DELETE /api/oauth/tokens - Clear all tokens
  server.delete('/oauth/tokens', async () => {
    const count = oauthService.clearAllTokens()
    return { cleared: count }
  })

  // GET /api/oauth/tokens/:serverName/check - Check if token is valid/expired
  server.get<{ Params: { serverName: string } }>('/oauth/tokens/:serverName/check', async (request, reply) => {
    const token = oauthService.getToken(request.params.serverName)
    if (!token) {
      return reply.status(404).send({ 
        valid: false, 
        error: 'No token found' 
      })
    }

    const isExpired = oauthService.isTokenExpired(request.params.serverName)
    return {
      valid: !isExpired,
      isExpired,
      expiresAt: token.expiresAt,
      hasRefreshToken: !!token.refreshToken,
    }
  })
}

