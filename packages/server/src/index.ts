import Fastify from 'fastify'
import cors from '@fastify/cors'
import { initDatabase, closeDatabase } from './db/index.js'
import { authMiddleware } from './middleware/auth.js'
import { errorHandler } from './middleware/error-handler.js'
import { healthRoutes } from './routes/health.js'
import { configRoutes } from './routes/config.js'
import { profileRoutes } from './routes/profiles.js'
import { conversationRoutes } from './routes/conversations.js'
import { mcpRoutes } from './routes/mcp.js'
import { agentRoutes } from './routes/agent.js'
import { speechRoutes } from './routes/speech.js'
import { configService } from './services/config-service.js'
import { mcpService } from './services/mcp-service.js'

const DEFAULT_PORT = 3847

async function createServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  })

  // Initialize database
  initDatabase()

  // Ensure API key exists
  const apiKey = await configService.ensureApiKey()
  console.log(`API Key: ${apiKey}`)

  // Register CORS
  await server.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  })

  // Error handler
  server.setErrorHandler(errorHandler)

  // Auth middleware (applied to all routes except health)
  server.addHook('onRequest', authMiddleware)

  // Register routes
  await server.register(healthRoutes, { prefix: '/api/health' })
  await server.register(configRoutes, { prefix: '/api/config' })
  await server.register(profileRoutes, { prefix: '/api/profiles' })
  await server.register(conversationRoutes, { prefix: '/api/conversations' })
  await server.register(mcpRoutes, { prefix: '/api/mcp' })
  await server.register(agentRoutes, { prefix: '/api/agent' })
  await server.register(speechRoutes, { prefix: '/api/speech' })

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM']
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, shutting down...`)
      await mcpService.shutdown()
      await server.close()
      closeDatabase()
      process.exit(0)
    })
  }

  return server
}

async function start() {
  try {
    const server = await createServer()
    const config = await configService.get()
    
    const port = config.serverPort || DEFAULT_PORT
    const host = config.serverBindAddress || '0.0.0.0'
    
    await server.listen({ port, host })
    console.log(`Server running at http://${host}:${port}`)
    console.log(`Health check: http://${host}:${port}/api/health`)
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

start()
