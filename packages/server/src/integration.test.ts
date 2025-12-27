import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { initDatabase, closeDatabase, resetDatabase } from './db/index.js'
import { errorHandler } from './middleware/index.js'
import { healthRoutes } from './routes/health.js'
import { configRoutes } from './routes/config.js'
import { conversationRoutes } from './routes/conversations.js'
import { profileRoutes } from './routes/profiles.js'
import { queueRoutes } from './routes/queue.js'

// Test API key
const TEST_API_KEY = 'test-integration-key'

// Override config for tests
process.env.API_KEY = TEST_API_KEY

describe('Server Integration Tests', () => {
  let server: FastifyInstance
  let baseUrl: string

  beforeAll(async () => {
    // Close any existing database connection from previous test files
    closeDatabase()

    // Initialize fresh in-memory database
    await initDatabase(':memory:')

    // Create test server
    server = Fastify({ logger: false })
    server.setErrorHandler(errorHandler)
    await server.register(cors)

    // Mock auth to use our test key
    server.addHook('onRequest', async (request, reply) => {
      const authHeader = request.headers.authorization
      if (request.url === '/api/health') return
      
      if (!authHeader) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
      
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader
      
      if (token !== TEST_API_KEY) {
        return reply.status(401).send({ error: 'Invalid API key' })
      }
    })

    // Register routes
    await server.register(healthRoutes, { prefix: '/api' })
    await server.register(configRoutes, { prefix: '/api' })
    await server.register(conversationRoutes, { prefix: '/api' })
    await server.register(profileRoutes, { prefix: '/api' })
    await server.register(queueRoutes, { prefix: '/api' })

    // Start server on random port
    await server.listen({ port: 0 })
    const address = server.server.address()
    const port = typeof address === 'object' ? address?.port : 0
    baseUrl = `http://localhost:${port}`
  })

  afterAll(async () => {
    await server.close()
    closeDatabase()
  })

  const authHeaders = {
    'Authorization': `Bearer ${TEST_API_KEY}`,
    'Content-Type': 'application/json',
  }

  describe('Health Endpoints', () => {
    it('GET /api/health should return healthy status without auth', async () => {
      const response = await fetch(`${baseUrl}/api/health`)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBeDefined()
      expect(data.timestamp).toBeGreaterThan(0)
    })
  })

  describe('Authentication', () => {
    it('should reject requests without auth header', async () => {
      const response = await fetch(`${baseUrl}/api/conversations`)
      expect(response.status).toBe(401)
    })

    it('should reject requests with invalid API key', async () => {
      const response = await fetch(`${baseUrl}/api/conversations`, {
        headers: { 'Authorization': 'Bearer wrong-key' },
      })
      expect(response.status).toBe(401)
    })

    it('should accept requests with valid API key', async () => {
      const response = await fetch(`${baseUrl}/api/conversations`, {
        headers: authHeaders,
      })
      expect(response.status).toBe(200)
    })
  })

  describe('Conversations API', () => {
    it('should create and retrieve a conversation', async () => {
      // Create
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ message: 'Integration test message' }),
      })
      expect(createRes.status).toBe(201)
      const created = await createRes.json()
      expect(created.id).toMatch(/^conv_/)
      expect(created.messages).toHaveLength(1)

      // Retrieve
      const getRes = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
        headers: authHeaders,
      })
      expect(getRes.status).toBe(200)
      const retrieved = await getRes.json()
      expect(retrieved.id).toBe(created.id)
    })

    it('should list conversations', async () => {
      const response = await fetch(`${baseUrl}/api/conversations`, {
        headers: authHeaders,
      })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
    })

    it('should add messages to a conversation', async () => {
      // Create conversation
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ message: 'First message' }),
      })
      const conv = await createRes.json()

      // Add message
      const addRes = await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ content: 'Second message', role: 'assistant' }),
      })
      expect(addRes.status).toBe(201)
      const message = await addRes.json()
      expect(message.role).toBe('assistant')
      expect(message.content).toBe('Second message')
    })

    it('should delete a conversation', async () => {
      // Create
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ message: 'To delete' }),
      })
      expect(createRes.status).toBe(201)
      const conv = await createRes.json()
      expect(conv.id).toBeDefined()

      // Delete - need to remove Content-Type for DELETE with no body
      const deleteRes = await fetch(`${baseUrl}/api/conversations/${conv.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      })

      if (deleteRes.status !== 200) {
        const errorBody = await deleteRes.json().catch(() => ({}))
        console.error('Delete failed:', errorBody)
      }
      expect(deleteRes.status).toBe(200)

      // Verify deleted
      const getRes = await fetch(`${baseUrl}/api/conversations/${conv.id}`, {
        headers: authHeaders,
      })
      expect(getRes.status).toBe(404)
    })
  })

  describe('Profiles API', () => {
    it('should create and retrieve a profile', async () => {
      // Create
      const createRes = await fetch(`${baseUrl}/api/profiles`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Test Profile',
          guidelines: 'Be helpful',
        }),
      })
      expect(createRes.status).toBe(201)
      const created = await createRes.json()
      expect(created.id).toMatch(/^profile_/)
      expect(created.name).toBe('Test Profile')

      // Retrieve
      const getRes = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
        headers: authHeaders,
      })
      expect(getRes.status).toBe(200)
      const retrieved = await getRes.json()
      expect(retrieved.id).toBe(created.id)
    })

    it('should activate a profile', async () => {
      // Create
      const createRes = await fetch(`${baseUrl}/api/profiles`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ name: 'Activatable Profile' }),
      })
      expect(createRes.status).toBe(201)
      const profile = await createRes.json()
      expect(profile.id).toBeDefined()

      // Activate - don't send Content-Type for empty body
      const activateRes = await fetch(`${baseUrl}/api/profiles/${profile.id}/activate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      })

      if (activateRes.status !== 200) {
        const errorBody = await activateRes.json().catch(() => ({}))
        console.error('Activate failed:', errorBody)
      }
      expect(activateRes.status).toBe(200)

      // Check current
      const currentRes = await fetch(`${baseUrl}/api/profiles/current`, {
        headers: authHeaders,
      })
      expect(currentRes.status).toBe(200)
      const current = await currentRes.json()
      expect(current.id).toBe(profile.id)
    })
  })

  describe('Config API', () => {
    it('should get default config', async () => {
      const response = await fetch(`${baseUrl}/api/config`, {
        headers: authHeaders,
      })
      expect(response.status).toBe(200)
      const config = await response.json()
      expect(config.mcpMaxIterations).toBe(25)
    })

    it('should update config', async () => {
      const response = await fetch(`${baseUrl}/api/config`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ mcpMaxIterations: 50 }),
      })
      expect(response.status).toBe(200)
      const config = await response.json()
      expect(config.mcpMaxIterations).toBe(50)
    })
  })

  describe('Queue API', () => {
    it('should enqueue and retrieve messages', async () => {
      // Create conversation first
      const convRes = await fetch(`${baseUrl}/api/conversations`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ message: 'Queue test' }),
      })
      const conv = await convRes.json()

      // Enqueue
      const enqueueRes = await fetch(`${baseUrl}/api/conversations/${conv.id}/queue`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: 'Queued message' }),
      })
      expect(enqueueRes.status).toBe(201)
      const queued = await enqueueRes.json()
      expect(queued.status).toBe('pending')

      // Get queue
      const queueRes = await fetch(`${baseUrl}/api/conversations/${conv.id}/queue`, {
        headers: authHeaders,
      })
      expect(queueRes.status).toBe(200)
      const queue = await queueRes.json()
      expect(queue.length).toBeGreaterThanOrEqual(1)
    })
  })
})

