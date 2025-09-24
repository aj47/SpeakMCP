import fs from 'fs'
import path from 'path'
import { DebugLoggingService } from '../debug-logging-service'
import { configStore } from '../config'

// Mock the config store
jest.mock('../config', () => ({
  configStore: {
    get: jest.fn(() => ({
      debugLoggingEnabled: true,
      debugLoggingLevel: 'debug',
      debugLoggingMaxFileSize: 1, // 1MB for testing
      debugLoggingMaxFiles: 3
    }))
  },
  dataFolder: '/tmp/test-speakmcp'
}))

// Mock fs operations
jest.mock('fs')
const mockFs = fs as jest.Mocked<typeof fs>

describe('DebugLoggingService', () => {
  let service: DebugLoggingService
  let mockLogFolder: string

  beforeEach(() => {
    jest.clearAllMocks()
    mockLogFolder = '/tmp/test-speakmcp/debug-logs'
    
    // Reset singleton instance
    ;(DebugLoggingService as any).instance = null
    
    // Mock fs operations
    mockFs.mkdirSync.mockImplementation(() => {})
    mockFs.existsSync.mockReturnValue(true)
    mockFs.statSync.mockReturnValue({
      size: 1024,
      birthtime: new Date(),
      mtime: new Date()
    } as any)
    mockFs.appendFileSync.mockImplementation(() => {})
    mockFs.readdirSync.mockReturnValue(['debug-2023-01-01.log'] as any)
    mockFs.readFileSync.mockReturnValue('{"timestamp":1234567890,"level":"info","component":"test","message":"test message"}\n')
    
    service = DebugLoggingService.getInstance()
  })

  afterEach(() => {
    if (service) {
      service.destroy()
    }
  })

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = DebugLoggingService.getInstance()
      const instance2 = DebugLoggingService.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('Log Folder Management', () => {
    it('should create log folder on initialization', () => {
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        mockLogFolder,
        { recursive: true }
      )
    })
  })

  describe('Logging Methods', () => {
    it('should log debug messages when enabled', () => {
      service.debug('test-component', 'test message', { key: 'value' })
      
      // Should add to buffer
      expect((service as any).logBuffer).toHaveLength(1)
      
      const logEntry = (service as any).logBuffer[0]
      expect(logEntry.level).toBe('debug')
      expect(logEntry.component).toBe('test-component')
      expect(logEntry.message).toBe('test message')
      expect(logEntry.details).toEqual({ key: 'value' })
    })

    it('should log info messages', () => {
      service.info('test-component', 'info message')
      
      const logEntry = (service as any).logBuffer[0]
      expect(logEntry.level).toBe('info')
      expect(logEntry.message).toBe('info message')
    })

    it('should log warning messages', () => {
      service.warning('test-component', 'warning message')
      
      const logEntry = (service as any).logBuffer[0]
      expect(logEntry.level).toBe('warning')
      expect(logEntry.message).toBe('warning message')
    })

    it('should log error messages with stack trace', () => {
      service.error('test-component', 'error message')
      
      const logEntry = (service as any).logBuffer[0]
      expect(logEntry.level).toBe('error')
      expect(logEntry.message).toBe('error message')
      expect(logEntry.stack).toBeDefined()
    })

    it('should respect log level filtering', () => {
      // Mock config to only log warnings and errors
      ;(configStore.get as jest.Mock).mockReturnValue({
        debugLoggingEnabled: true,
        debugLoggingLevel: 'warning',
        debugLoggingMaxFileSize: 1,
        debugLoggingMaxFiles: 3
      })

      const newService = DebugLoggingService.getInstance()
      
      newService.debug('test', 'debug message')
      newService.info('test', 'info message')
      newService.warning('test', 'warning message')
      newService.error('test', 'error message')
      
      const buffer = (newService as any).logBuffer
      expect(buffer).toHaveLength(2) // Only warning and error
      expect(buffer[0].level).toBe('warning')
      expect(buffer[1].level).toBe('error')
    })

    it('should not log when disabled', () => {
      ;(configStore.get as jest.Mock).mockReturnValue({
        debugLoggingEnabled: false
      })

      const newService = DebugLoggingService.getInstance()
      newService.info('test', 'test message')
      
      expect((newService as any).logBuffer).toHaveLength(0)
    })
  })

  describe('Buffer Management', () => {
    it('should flush buffer when full', () => {
      // Fill buffer to capacity
      for (let i = 0; i < 100; i++) {
        service.info('test', `message ${i}`)
      }
      
      // Add one more to trigger flush
      service.info('test', 'trigger flush')
      
      expect(mockFs.appendFileSync).toHaveBeenCalled()
    })

    it('should flush buffer immediately for error messages', () => {
      service.error('test', 'error message')
      
      expect(mockFs.appendFileSync).toHaveBeenCalled()
    })
  })

  describe('File Size Management', () => {
    it('should rotate log file when size limit is reached', () => {
      // Mock file size to exceed limit
      mockFs.statSync.mockReturnValue({
        size: 2 * 1024 * 1024, // 2MB (exceeds 1MB limit)
        birthtime: new Date(),
        mtime: new Date()
      } as any)

      // Trigger flush which should check file size
      service.info('test', 'test message')
      ;(service as any).flushBuffer()
      
      // Should create new log file (rotation)
      expect((service as any).currentLogFile).toContain('debug-')
    })

    it('should clean up old log files', () => {
      // Mock multiple log files
      mockFs.readdirSync.mockReturnValue([
        'debug-2023-01-01.log',
        'debug-2023-01-02.log',
        'debug-2023-01-03.log',
        'debug-2023-01-04.log',
        'debug-2023-01-05.log'
      ] as any)

      mockFs.statSync.mockImplementation((filePath) => ({
        size: 1024,
        birthtime: new Date(),
        mtime: new Date(filePath.toString().includes('01') ? '2023-01-01' : '2023-01-05')
      } as any))

      // Trigger cleanup
      ;(service as any).cleanupOldLogFiles(3)
      
      // Should delete old files (keeping only 3 most recent)
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(2)
    })
  })

  describe('Log Retrieval', () => {
    it('should get recent logs', async () => {
      mockFs.readFileSync.mockReturnValue(
        '{"timestamp":1234567890,"level":"info","component":"test","message":"message 1"}\n' +
        '{"timestamp":1234567891,"level":"error","component":"test","message":"message 2"}\n'
      )

      const logs = await service.getRecentLogs(10)
      
      expect(logs).toHaveLength(2)
      expect(logs[0].message).toBe('message 2') // Most recent first
      expect(logs[1].message).toBe('message 1')
    })

    it('should get log files info', () => {
      const files = service.getLogFiles()
      
      expect(files).toHaveLength(1)
      expect(files[0].path).toContain('debug-2023-01-01.log')
      expect(files[0].size).toBe(1024)
    })
  })

  describe('Log Management', () => {
    it('should clear all logs', () => {
      service.clearLogs()
      
      expect(mockFs.unlinkSync).toHaveBeenCalled()
      expect((service as any).logBuffer).toHaveLength(0)
    })

    it('should export logs', () => {
      const exportPath = '/tmp/export.json'
      
      mockFs.readFileSync.mockReturnValue(
        '{"timestamp":1234567890,"level":"info","component":"test","message":"test"}\n'
      )
      
      const result = service.exportLogs(exportPath)
      
      expect(result).toBe(exportPath)
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        exportPath,
        expect.stringContaining('"exportedAt"')
      )
    })
  })

  describe('Error Handling', () => {
    it('should handle file system errors gracefully', () => {
      mockFs.appendFileSync.mockImplementation(() => {
        throw new Error('File system error')
      })

      // Should not throw
      expect(() => {
        service.info('test', 'test message')
        ;(service as any).flushBuffer()
      }).not.toThrow()
    })

    it('should sanitize circular references in details', () => {
      const circular: any = { name: 'test' }
      circular.self = circular

      service.info('test', 'test message', circular)
      
      const logEntry = (service as any).logBuffer[0]
      expect(typeof logEntry.details).toBe('string')
    })
  })
})
