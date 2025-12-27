import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import { config } from './config.js'
import { initDatabase, closeDatabase } from './db/index.js'
import { authMiddleware, errorHandler } from './middleware/index.js'
import { setupWebSocket } from './websocket.js'
import { mcpService } from './services/mcp-service.js'
import { diagnosticsService } from './services/diagnostics-service.js'

// Routes
import { healthRoutes } from './routes/health.js'
import { configRoutes } from './routes/config.js'
import { conversationRoutes } from './routes/conversations.js'
import { profileRoutes } from './routes/profiles.js'
import { queueRoutes } from './routes/queue.js'
import { mcpRoutes } from './routes/mcp.js'
import { agentRoutes } from './routes/agent.js'
import { speechRoutes } from './routes/speech.js'
import { diagnosticsRoutes } from './routes/diagnostics.js'
import { modelsRoutes } from './routes/models.js'
import { openaiCompatRoutes } from './routes/openai-compat.js'

async function main() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  })

  // Global error handler
  server.setErrorHandler(errorHandler)

  // Plugins
  await server.register(cors, {
    origin: true,
    credentials: true,
  })

  await server.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25MB max for audio files
    },
  })

  await server.register(websocket)

  // Initialize database
  await initDatabase()
  server.log.info('Database initialized')

  // Auth middleware (skip for health check and WebSocket upgrade)
  server.addHook('onRequest', async (request, reply) => {
    // Skip auth for WebSocket upgrade requests
    if (request.headers.upgrade === 'websocket') {
      return
    }
    return authMiddleware(request, reply)
  })

  // Register routes
  await server.register(healthRoutes, { prefix: '/api' })
  await server.register(configRoutes, { prefix: '/api' })
  await server.register(conversationRoutes, { prefix: '/api' })
  await server.register(profileRoutes, { prefix: '/api' })
  await server.register(queueRoutes, { prefix: '/api' })
  await server.register(mcpRoutes, { prefix: '/api' })
  await server.register(agentRoutes, { prefix: '/api' })
  await server.register(speechRoutes, { prefix: '/api' })
  await server.register(diagnosticsRoutes, { prefix: '/api' })
  await server.register(modelsRoutes, { prefix: '/api' })

  // OpenAI-compatible API (no /api prefix for compatibility)
  await server.register(openaiCompatRoutes)

  // Setup WebSocket
  await setupWebSocket(server)
  server.log.info('WebSocket handler registered')

  // Root endpoint
  server.get('/', async () => {
    return {
      name: '@speakmcp/server',
      version: '1.1.0',
      status: 'running',
      timestamp: Date.now(),
    }
  })

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    server.log.info(`${signal} received, shutting down...`)
    
    try {
      // Stop all agent sessions
      const { agentService } = await import('./services/agent-service.js')
      agentService.stopAllSessions()
      
      // Shutdown MCP servers
      await mcpService.shutdown()
      
      // Close database
      closeDatabase()
      
      // Close server
      await server.close()
      
      server.log.info('Shutdown complete')
      process.exit(0)
    } catch (error) {
      server.log.error(error, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Cleanup interval for old sessions and errors
  const cleanupInterval = setInterval(async () => {
    try {
      const { agentService } = await import('./services/agent-service.js')
      agentService.cleanupSessions()
      diagnosticsService.clearOldErrors()
    } catch (e) {
      // Ignore cleanup errors
    }
  }, 60 * 60 * 1000) // Every hour

  server.addHook('onClose', () => {
    clearInterval(cleanupInterval)
  })

  // Start server
  try {
    await server.listen({ port: config.port, host: config.host })
    server.log.info(`Server running at http://${config.host}:${config.port}`)
    server.log.info(`API key required for authentication (use Authorization: Bearer <key>)`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})

