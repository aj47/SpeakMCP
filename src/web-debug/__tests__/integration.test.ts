/**
 * Integration tests for the enhanced Web Debugging Mode
 * Tests the complete flow from auto-session creation to logging
 */

import { WebDebugServer } from '../server'
import { logger } from '../utils/logger'
import { webDebugConfig } from '../config'
import { io as Client, Socket } from 'socket.io-client'

describe('Web Debug Mode Integration', () => {
  let server: WebDebugServer
  let clientSocket: Socket
  let serverUrl: string

  beforeAll(async () => {
    // Start server on a test port
    server = new WebDebugServer({
      port: 3003,
      host: 'localhost',
      autoSessionEnabled: true,
      logLevel: 'debug'
    })
    
    await server.start()
    serverUrl = 'http://localhost:3003'
  })

  afterAll(async () => {
    if (clientSocket) {
      clientSocket.close()
    }
    if (server) {
      await server.stop()
    }
  })

  beforeEach(() => {
    // Clear logger entries before each test
    logger.clearEntries()
  })

  describe('Complete Auto-Session Flow', () => {
    it('should handle complete message flow with auto-session', async () => {
      // 1. Create a session via API
      const createResponse = await fetch(`${serverUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Integration Test Session' })
      })
      
      expect(createResponse.ok).toBe(true)
      const session = await createResponse.json()
      expect(session.id).toBeDefined()
      expect(session.name).toBe('Integration Test Session')

      // 2. Send an agent request
      const agentResponse = await fetch(`${serverUrl}/api/sessions/${session.id}/agent-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, this is a test message',
          maxIterations: 5
        })
      })
      
      expect(agentResponse.ok).toBe(true)
      const result = await agentResponse.json()
      expect(result.userMessage).toBeDefined()
      expect(result.agentMessage).toBeDefined()

      // 3. Verify session was updated
      const sessionResponse = await fetch(`${serverUrl}/api/sessions/${session.id}`)
      expect(sessionResponse.ok).toBe(true)
      const updatedSession = await sessionResponse.json()
      expect(updatedSession.messages.length).toBeGreaterThan(0)

      // 4. Check that logging captured the flow
      const logEntries = logger.getEntries()
      expect(logEntries.length).toBeGreaterThan(0)
      
      // Should have session creation logs
      const sessionLogs = logEntries.filter(entry => entry.category === 'session')
      expect(sessionLogs.length).toBeGreaterThan(0)
      
      // Should have agent processing logs
      const agentLogs = logEntries.filter(entry => entry.category === 'agent')
      expect(agentLogs.length).toBeGreaterThan(0)
    })

    it('should handle WebSocket connections and events', (done) => {
      clientSocket = Client(serverUrl)
      
      const receivedEvents: any[] = []
      
      clientSocket.on('connect', () => {
        expect(clientSocket.connected).toBe(true)
        
        // Join a test session
        clientSocket.emit('joinSession', 'test-session-id')
      })
      
      clientSocket.on('sessionCreated', (session) => {
        receivedEvents.push({ type: 'sessionCreated', data: session })
      })
      
      clientSocket.on('message', (data) => {
        receivedEvents.push({ type: 'message', data })
      })
      
      clientSocket.on('agentProgress', (update) => {
        receivedEvents.push({ type: 'agentProgress', data: update })
      })
      
      // Create a session to trigger events
      setTimeout(async () => {
        const response = await fetch(`${serverUrl}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'WebSocket Test Session' })
        })
        
        expect(response.ok).toBe(true)
        
        // Give time for events to be received
        setTimeout(() => {
          expect(receivedEvents.length).toBeGreaterThan(0)
          
          // Should have received sessionCreated event
          const sessionCreatedEvents = receivedEvents.filter(e => e.type === 'sessionCreated')
          expect(sessionCreatedEvents.length).toBe(1)
          
          clientSocket.close()
          done()
        }, 500)
      }, 100)
    })
  })

  describe('Logging Integration', () => {
    it('should capture detailed MCP operations', async () => {
      // Clear existing logs
      logger.clearEntries()
      
      // Get MCP tools to trigger MCP operations
      const toolsResponse = await fetch(`${serverUrl}/api/mcp/tools`)
      expect(toolsResponse.ok).toBe(true)
      
      // Get MCP config to trigger more operations
      const configResponse = await fetch(`${serverUrl}/api/mcp/config`)
      expect(configResponse.ok).toBe(true)
      
      // Check logs for MCP operations
      const logEntries = logger.getEntries()
      const mcpLogs = logEntries.filter(entry => entry.category === 'mcp-client')
      
      // Should have some MCP-related logs
      expect(mcpLogs.length).toBeGreaterThan(0)
    })

    it('should maintain log correlation across operations', async () => {
      logger.clearEntries()
      
      // Create session and send message to generate correlated logs
      const createResponse = await fetch(`${serverUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Correlation Test' })
      })
      
      const session = await createResponse.json()
      
      const agentResponse = await fetch(`${serverUrl}/api/sessions/${session.id}/agent-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test correlation',
          maxIterations: 3
        })
      })
      
      expect(agentResponse.ok).toBe(true)
      
      // Check for correlated logs
      const logEntries = logger.getEntries()
      const sessionLogs = logEntries.filter(entry => entry.sessionId === session.id)
      
      expect(sessionLogs.length).toBeGreaterThan(0)
      
      // Should have logs from different categories but same session
      const categories = new Set(sessionLogs.map(log => log.category))
      expect(categories.size).toBeGreaterThan(1) // Multiple categories
    })

    it('should redact secrets in logs', async () => {
      // Log a message with potential secrets
      logger.info('oauth/auth', 'Authorization: Bearer secret123token')
      logger.info('network', 'api_key: mysecretkey123')
      logger.info('oauth/auth', 'password: mypassword')
      
      const logEntries = logger.getEntries()
      const secretLogs = logEntries.filter(entry => 
        entry.message.includes('Bearer') || 
        entry.message.includes('api_key') || 
        entry.message.includes('password')
      )
      
      expect(secretLogs.length).toBeGreaterThan(0)
      
      // All should be redacted
      secretLogs.forEach(log => {
        expect(log.message).toContain('***REDACTED***')
        expect(log.message).not.toContain('secret123token')
        expect(log.message).not.toContain('mysecretkey123')
        expect(log.message).not.toContain('mypassword')
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid session requests gracefully', async () => {
      const response = await fetch(`${serverUrl}/api/sessions/invalid-session-id`)
      expect(response.status).toBe(404)
      
      const error = await response.json()
      expect(error.error).toBe('Session not found')
    })

    it('should handle malformed agent requests', async () => {
      // Create a valid session first
      const createResponse = await fetch(`${serverUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Error Test Session' })
      })
      
      const session = await createResponse.json()
      
      // Send malformed request
      const agentResponse = await fetch(`${serverUrl}/api/sessions/${session.id}/agent-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing required 'text' field
          maxIterations: 5
        })
      })
      
      // Should handle gracefully (exact behavior depends on implementation)
      expect(agentResponse.status).toBeGreaterThanOrEqual(400)
    })

    it('should log errors appropriately', async () => {
      logger.clearEntries()
      
      // Trigger an error by requesting non-existent session
      await fetch(`${serverUrl}/api/sessions/non-existent`)
      
      // Should not crash and should continue logging
      logger.info('ui', 'Test after error')
      
      const logEntries = logger.getEntries()
      expect(logEntries.length).toBeGreaterThan(0)
      
      // Should have the test log
      const testLogs = logEntries.filter(entry => entry.message === 'Test after error')
      expect(testLogs.length).toBe(1)
    })
  })

  describe('Configuration Integration', () => {
    it('should respect configuration settings', () => {
      expect(webDebugConfig.autoSessionEnabled).toBeDefined()
      expect(webDebugConfig.logLevel).toBeDefined()
      expect(webDebugConfig.port).toBeDefined()
      expect(webDebugConfig.host).toBeDefined()
    })

    it('should allow runtime configuration changes', () => {
      const originalLevel = logger.getLevel()
      
      logger.setLevel('error')
      expect(logger.getLevel()).toBe('error')
      
      logger.setLevel(originalLevel)
      expect(logger.getLevel()).toBe(originalLevel)
    })
  })
})
