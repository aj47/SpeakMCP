import type { FastifyPluginAsync } from 'fastify'

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/health - Health check (no auth required)
  fastify.get('/', async () => {
    return {
      status: 'ok',
      timestamp: Date.now(),
      version: process.env.npm_package_version || '0.1.0',
    }
  })
}
