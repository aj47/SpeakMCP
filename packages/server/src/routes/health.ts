import { FastifyPluginAsync } from 'fastify'
import { diagnosticsService } from '../services/diagnostics-service.js'

export const healthRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/health - Basic health check (public, no auth)
  server.get('/health', async () => {
    const health = diagnosticsService.checkHealth()
    return {
      status: health.status,
      timestamp: Date.now(),
      checks: health.checks,
    }
  })

  // GET /api/health/detailed - Detailed health check
  server.get('/health/detailed', async () => {
    return diagnosticsService.checkHealth()
  })
}

