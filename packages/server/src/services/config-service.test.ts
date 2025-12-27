import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupTestDb, teardownTestDb, resetTestDb } from '../test-utils.js'
import { configService } from './config-service.js'

describe('configService', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    teardownTestDb()
  })

  beforeEach(() => {
    resetTestDb()
  })

  describe('get', () => {
    it('should return default config when nothing is set', () => {
      const config = configService.get()

      expect(config).toBeDefined()
      expect(config.sttProviderId).toBe('openai')
      expect(config.ttsEnabled).toBe(false)
      expect(config.mcpMaxIterations).toBe(25)
    })
  })

  describe('update', () => {
    it('should update config values', () => {
      configService.update({
        sttProviderId: 'groq',
        ttsEnabled: true,
        mcpMaxIterations: 50,
      })

      const config = configService.get()

      expect(config.sttProviderId).toBe('groq')
      expect(config.ttsEnabled).toBe(true)
      expect(config.mcpMaxIterations).toBe(50)
    })

    it('should preserve unset values', () => {
      configService.update({ sttProviderId: 'groq' })
      configService.update({ ttsEnabled: true })

      const config = configService.get()

      expect(config.sttProviderId).toBe('groq')
      expect(config.ttsEnabled).toBe(true)
    })

    it('should return updated config', () => {
      const updated = configService.update({ mcpMaxIterations: 100 })

      expect(updated.mcpMaxIterations).toBe(100)
    })
  })

  describe('getKey', () => {
    it('should return default value for unset key', () => {
      const value = configService.getKey('mcpMaxIterations')
      expect(value).toBe(25)
    })

    it('should return set value', () => {
      configService.update({ mcpMaxIterations: 75 })

      const value = configService.getKey('mcpMaxIterations')
      expect(value).toBe(75)
    })
  })

  describe('setKey', () => {
    it('should set a single key', () => {
      configService.setKey('ttsEnabled', true)

      expect(configService.getKey('ttsEnabled')).toBe(true)
    })

    it('should overwrite existing value', () => {
      configService.setKey('mcpMaxIterations', 10)
      configService.setKey('mcpMaxIterations', 20)

      expect(configService.getKey('mcpMaxIterations')).toBe(20)
    })
  })

  describe('deleteKey', () => {
    it('should reset key to default', () => {
      configService.setKey('mcpMaxIterations', 100)
      configService.deleteKey('mcpMaxIterations')

      // Should return default value after delete
      expect(configService.getKey('mcpMaxIterations')).toBe(25)
    })
  })

  describe('app state', () => {
    describe('getCurrentProfileId', () => {
      it('should return null when not set', () => {
        expect(configService.getCurrentProfileId()).toBeNull()
      })
    })

    describe('setCurrentProfileId', () => {
      it('should set current profile id', () => {
        configService.setCurrentProfileId('profile_123')

        expect(configService.getCurrentProfileId()).toBe('profile_123')
      })

      it('should clear when set to null', () => {
        configService.setCurrentProfileId('profile_123')
        configService.setCurrentProfileId(null)

        expect(configService.getCurrentProfileId()).toBeNull()
      })
    })

    describe('getAppState/setAppState', () => {
      it('should get and set arbitrary state', () => {
        configService.setAppState('customKey', 'customValue')

        expect(configService.getAppState('customKey')).toBe('customValue')
      })

      it('should return null for unset state', () => {
        expect(configService.getAppState('nonexistent')).toBeNull()
      })

      it('should clear state when set to null', () => {
        configService.setAppState('key', 'value')
        configService.setAppState('key', null)

        expect(configService.getAppState('key')).toBeNull()
      })
    })
  })

  describe('complex config values', () => {
    it('should store and retrieve arrays', () => {
      const presets = [
        { id: '1', name: 'Preset 1', baseUrl: 'http://localhost:8080' },
        { id: '2', name: 'Preset 2', baseUrl: 'http://localhost:8081' },
      ]

      configService.update({ modelPresets: presets })

      const config = configService.get()
      expect(config.modelPresets).toEqual(presets)
    })

    it('should store and retrieve optional string values', () => {
      configService.update({
        openaiApiKey: 'sk-test-key',
        openaiBaseUrl: 'https://custom.api.com/v1',
      })

      const config = configService.get()
      expect(config.openaiApiKey).toBe('sk-test-key')
      expect(config.openaiBaseUrl).toBe('https://custom.api.com/v1')
    })
  })
})

