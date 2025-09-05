import { WebDebugLogger, LogLevel, LogCategory } from '../utils/logger'

describe('WebDebugLogger', () => {
  let logger: WebDebugLogger
  let mockConsole: jest.SpyInstance

  beforeEach(() => {
    logger = new WebDebugLogger({
      level: 'debug',
      enableConsole: false, // Disable console for tests
      enableUI: true,
      maxEntries: 100,
      redactSecrets: true
    })
    mockConsole = jest.spyOn(console, 'log').mockImplementation()
  })

  afterEach(() => {
    mockConsole.mockRestore()
  })

  describe('Log Level Filtering', () => {
    it('should respect log level filtering', () => {
      logger = new WebDebugLogger({ level: 'warn', enableConsole: false })
      
      logger.debug('ui', 'debug message')
      logger.info('ui', 'info message')
      logger.warn('ui', 'warn message')
      logger.error('ui', 'error message')
      
      const entries = logger.getEntries()
      expect(entries).toHaveLength(2)
      expect(entries[0].level).toBe('warn')
      expect(entries[1].level).toBe('error')
    })

    it('should allow all levels when set to trace', () => {
      logger = new WebDebugLogger({ level: 'trace', enableConsole: false })
      
      logger.trace('ui', 'trace message')
      logger.debug('ui', 'debug message')
      logger.info('ui', 'info message')
      logger.warn('ui', 'warn message')
      logger.error('ui', 'error message')
      
      const entries = logger.getEntries()
      expect(entries).toHaveLength(5)
    })
  })

  describe('Secret Redaction', () => {
    it('should redact bearer tokens', () => {
      logger.info('oauth/auth', 'Authorization: Bearer abc123token')
      
      const entries = logger.getEntries()
      expect(entries[0].message).toContain('***REDACTED***')
      expect(entries[0].message).not.toContain('abc123token')
    })

    it('should redact API keys', () => {
      logger.info('network', 'api_key: secret123')
      
      const entries = logger.getEntries()
      expect(entries[0].message).toContain('***REDACTED***')
      expect(entries[0].message).not.toContain('secret123')
    })

    it('should redact passwords', () => {
      logger.info('oauth/auth', 'password: mypassword123')
      
      const entries = logger.getEntries()
      expect(entries[0].message).toContain('***REDACTED***')
      expect(entries[0].message).not.toContain('mypassword123')
    })

    it('should not redact when redactSecrets is false', () => {
      logger = new WebDebugLogger({ redactSecrets: false, enableConsole: false })
      logger.info('oauth/auth', 'Bearer abc123token')
      
      const entries = logger.getEntries()
      expect(entries[0].message).toContain('abc123token')
    })
  })

  describe('Entry Management', () => {
    it('should limit entries to maxEntries', () => {
      logger = new WebDebugLogger({ maxEntries: 3, enableConsole: false })
      
      logger.info('ui', 'message 1')
      logger.info('ui', 'message 2')
      logger.info('ui', 'message 3')
      logger.info('ui', 'message 4')
      
      const entries = logger.getEntries()
      expect(entries).toHaveLength(3)
      expect(entries[0].message).toBe('message 2')
      expect(entries[2].message).toBe('message 4')
    })

    it('should clear entries', () => {
      logger.info('ui', 'message 1')
      logger.info('ui', 'message 2')
      
      expect(logger.getEntries()).toHaveLength(2)
      
      logger.clearEntries()
      expect(logger.getEntries()).toHaveLength(1) // Clear operation adds a log entry
    })
  })

  describe('Context Information', () => {
    it('should include context information in entries', () => {
      const sessionId = 'session123'
      const messageId = 'msg456'
      const toolCallId = 'tool789'
      const duration = 1500
      
      logger.info('agent', 'Processing complete', {
        sessionId,
        messageId,
        toolCallId,
        duration,
        data: { result: 'success' }
      })
      
      const entries = logger.getEntries()
      expect(entries[0].sessionId).toBe(sessionId)
      expect(entries[0].messageId).toBe(messageId)
      expect(entries[0].toolCallId).toBe(toolCallId)
      expect(entries[0].duration).toBe(duration)
      expect(entries[0].data).toContain('success')
    })
  })

  describe('Utility Methods', () => {
    it('should create timer functions', () => {
      const endTimer = logger.startTimer('mcp-client', 'initialize server')
      
      // Simulate some work
      setTimeout(() => {
        endTimer()
      }, 100)
      
      const entries = logger.getEntries()
      expect(entries).toHaveLength(1) // Start message
      expect(entries[0].message).toContain('Starting initialize server')
    })

    it('should log tool calls with timing', () => {
      const endTimer = logger.logToolCall('filesystem_read', { path: '/test' }, 'session123', 'tool456')
      
      setTimeout(() => {
        endTimer()
      }, 50)
      
      const entries = logger.getEntries()
      expect(entries).toHaveLength(1) // Start message
      expect(entries[0].message).toContain('Starting tool call: filesystem_read')
      expect(entries[0].sessionId).toBe('session123')
      expect(entries[0].toolCallId).toBe('tool456')
    })

    it('should log agent steps', () => {
      logger.logAgentStep('Processing user request', 'session123', 'msg456')
      
      const entries = logger.getEntries()
      expect(entries[0].category).toBe('agent')
      expect(entries[0].message).toBe('Processing user request')
      expect(entries[0].sessionId).toBe('session123')
      expect(entries[0].messageId).toBe('msg456')
    })

    it('should log MCP operations with timing', () => {
      const endTimer = logger.logMCPOperation('list-tools', 'filesystem', 'session123')
      
      setTimeout(() => {
        endTimer()
      }, 25)
      
      const entries = logger.getEntries()
      expect(entries).toHaveLength(1) // Start message
      expect(entries[0].message).toContain('Starting MCP operation: list-tools')
      expect(entries[0].sessionId).toBe('session123')
    })
  })

  describe('Event Listeners', () => {
    it('should notify listeners of new entries', () => {
      const listener = jest.fn()
      const unsubscribe = logger.addListener(listener)
      
      logger.info('ui', 'test message')
      
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        level: 'info',
        category: 'ui',
        message: 'test message'
      }))
      
      unsubscribe()
      logger.info('ui', 'another message')
      
      expect(listener).toHaveBeenCalledTimes(1) // Should not be called after unsubscribe
    })
  })

  describe('Export Functionality', () => {
    it('should export logs in readable format', () => {
      logger.info('ui', 'message 1')
      logger.warn('network', 'message 2')
      
      const exported = logger.exportLogs()
      
      expect(exported).toContain('INFO')
      expect(exported).toContain('WARN')
      expect(exported).toContain('UI')
      expect(exported).toContain('NETWORK')
      expect(exported).toContain('message 1')
      expect(exported).toContain('message 2')
    })
  })

  describe('Level Changes', () => {
    it('should change log level at runtime', () => {
      logger.setLevel('error')
      
      logger.debug('ui', 'debug message')
      logger.info('ui', 'info message')
      logger.error('ui', 'error message')
      
      const entries = logger.getEntries()
      // Should have 2 entries: level change log + error message
      expect(entries).toHaveLength(2)
      expect(entries[1].level).toBe('error')
    })

    it('should return current log level', () => {
      logger.setLevel('warn')
      expect(logger.getLevel()).toBe('warn')
    })
  })
})
