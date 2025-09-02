/**
 * Tests for auto-session creation functionality
 */

import { WebDebugServer } from '../server'
import { webDebugConfig } from '../config'

// Mock fetch for testing
global.fetch = jest.fn()

describe('Auto-Session Creation', () => {
  let server: WebDebugServer
  let mockFetch: jest.MockedFunction<typeof fetch>

  beforeEach(() => {
    mockFetch = fetch as jest.MockedFunction<typeof fetch>
    mockFetch.mockClear()
    
    server = new WebDebugServer({
      port: 3002, // Use different port for tests
      host: 'localhost',
      autoSessionEnabled: true
    })
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
    }
  })

  describe('Session Creation', () => {
    it('should create session with auto-generated name', async () => {
      const sessionName = 'Test Session'
      const session = await server['createSession'](sessionName)
      
      expect(session).toBeDefined()
      expect(session.name).toBe(sessionName)
      expect(session.id).toMatch(/^session_\d+_[a-z0-9]+$/)
      expect(session.status).toBe('active')
      expect(session.messages).toEqual([])
      expect(session.toolCalls).toEqual([])
      expect(session.createdAt).toBeGreaterThan(0)
    })

    it('should create session with initial message', async () => {
      const sessionName = 'Test Session'
      const initialMessage = 'Hello, world!'
      const session = await server['createSession'](sessionName, initialMessage)
      
      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].content).toBe(initialMessage)
      expect(session.messages[0].role).toBe('user')
    })

    it('should generate unique session IDs', async () => {
      const session1 = await server['createSession']('Session 1')
      const session2 = await server['createSession']('Session 2')
      
      expect(session1.id).not.toBe(session2.id)
    })
  })

  describe('Session Management', () => {
    it('should store and retrieve sessions', async () => {
      const session = await server['createSession']('Test Session')
      const retrieved = server['sessions'].get(session.id)
      
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(session.id)
      expect(retrieved?.name).toBe('Test Session')
    })

    it('should add messages to existing sessions', () => {
      const sessionId = 'test-session-id'
      const session = {
        id: sessionId,
        name: 'Test Session',
        createdAt: Date.now(),
        messages: [],
        toolCalls: [],
        status: 'active' as const
      }
      
      server['sessions'].set(sessionId, session)
      
      const message = server['addMessage'](sessionId, 'Test message', 'user')
      
      expect(message).toBeDefined()
      expect(message.content).toBe('Test message')
      expect(message.role).toBe('user')
      expect(message.sessionId).toBe(sessionId)
      expect(session.messages).toHaveLength(1)
      expect(session.messages[0]).toBe(message)
    })
  })

  describe('Error Handling', () => {
    it('should handle missing session gracefully', () => {
      expect(() => {
        server['addMessage']('non-existent-session', 'Test message', 'user')
      }).toThrow('Session not found: non-existent-session')
    })

    it('should handle invalid session data', async () => {
      // Test with empty session name
      const session = await server['createSession']('')
      expect(session.name).toBe('') // Should still create but with empty name
    })
  })

  describe('Concurrency', () => {
    it('should handle concurrent session creation', async () => {
      const promises = Array.from({ length: 5 }, (_, i) => 
        server['createSession'](`Session ${i}`)
      )
      
      const sessions = await Promise.all(promises)
      
      // All sessions should be created successfully
      expect(sessions).toHaveLength(5)
      
      // All should have unique IDs
      const ids = sessions.map(s => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(5)
      
      // All should be stored
      sessions.forEach(session => {
        expect(server['sessions'].has(session.id)).toBe(true)
      })
    })
  })
})

describe('EnsureSession Logic', () => {
  // These tests would be for the client-side ensureSession logic
  // Since we can't easily test React components here, we'll create a simplified version
  
  interface MockSession {
    id: string
    name: string
    createdAt: number
  }

  class MockSessionManager {
    private currentSession: MockSession | null = null
    private isCreating = false
    
    async ensureSession(): Promise<MockSession> {
      // If session already exists, return it
      if (this.currentSession) {
        return this.currentSession
      }

      // If already creating a session, wait for it
      if (this.isCreating) {
        return new Promise((resolve, reject) => {
          const checkSession = () => {
            if (this.currentSession) {
              resolve(this.currentSession)
            } else if (!this.isCreating) {
              reject(new Error('Session creation failed'))
            } else {
              setTimeout(checkSession, 10)
            }
          }
          checkSession()
        })
      }

      // Create new session
      this.isCreating = true
      try {
        const session = await this.createSession(`Auto Session ${new Date().toLocaleTimeString()}`)
        this.currentSession = session
        return session
      } finally {
        this.isCreating = false
      }
    }
    
    private async createSession(name: string): Promise<MockSession> {
      // Simulate async session creation
      await new Promise(resolve => setTimeout(resolve, 50))
      return {
        id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name,
        createdAt: Date.now()
      }
    }
    
    reset() {
      this.currentSession = null
      this.isCreating = false
    }
  }

  let sessionManager: MockSessionManager

  beforeEach(() => {
    sessionManager = new MockSessionManager()
  })

  it('should return existing session if available', async () => {
    const session1 = await sessionManager.ensureSession()
    const session2 = await sessionManager.ensureSession()
    
    expect(session1.id).toBe(session2.id)
  })

  it('should create session if none exists', async () => {
    const session = await sessionManager.ensureSession()
    
    expect(session).toBeDefined()
    expect(session.id).toMatch(/^session_\d+_[a-z0-9]+$/)
    expect(session.name).toContain('Auto Session')
  })

  it('should handle concurrent calls with idempotency', async () => {
    const promises = Array.from({ length: 3 }, () => sessionManager.ensureSession())
    const sessions = await Promise.all(promises)
    
    // All should return the same session
    expect(sessions[0].id).toBe(sessions[1].id)
    expect(sessions[1].id).toBe(sessions[2].id)
  })

  it('should create new session after reset', async () => {
    const session1 = await sessionManager.ensureSession()
    sessionManager.reset()
    const session2 = await sessionManager.ensureSession()
    
    expect(session1.id).not.toBe(session2.id)
  })

  it('should handle creation failure gracefully', async () => {
    // Mock a failing session manager
    class FailingSessionManager extends MockSessionManager {
      private async createSession(): Promise<MockSession> {
        throw new Error('Session creation failed')
      }
    }
    
    const failingManager = new FailingSessionManager()
    
    await expect(failingManager.ensureSession()).rejects.toThrow('Session creation failed')
  })
})
