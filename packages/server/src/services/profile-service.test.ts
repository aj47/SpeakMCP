import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupTestDb, teardownTestDb, resetTestDb } from '../test-utils.js'
import { profileService } from './profile-service.js'
import { configService } from './config-service.js'

describe('profileService', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    teardownTestDb()
  })

  beforeEach(() => {
    resetTestDb()
  })

  describe('create', () => {
    it('should create a new profile with required fields', () => {
      const profile = profileService.create('Test Profile')

      expect(profile).toBeDefined()
      expect(profile.id).toMatch(/^profile_/)
      expect(profile.name).toBe('Test Profile')
      expect(profile.guidelines).toBe('')
      expect(profile.createdAt).toBeGreaterThan(0)
      expect(profile.updatedAt).toBeGreaterThan(0)
    })

    it('should create a profile with all optional fields', () => {
      const profile = profileService.create(
        'Full Profile',
        'Be helpful and concise',
        'You are a helpful assistant',
        { disabledServers: ['server1'] },
        { providerId: 'openai', modelId: 'gpt-4o' }
      )

      expect(profile.name).toBe('Full Profile')
      expect(profile.guidelines).toBe('Be helpful and concise')
      expect(profile.systemPrompt).toBe('You are a helpful assistant')
      expect(profile.mcpServerConfig).toEqual({ disabledServers: ['server1'] })
      expect(profile.modelConfig).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })
    })
  })

  describe('list', () => {
    it('should return empty array when no profiles exist', () => {
      const list = profileService.list()
      expect(list).toEqual([])
    })

    it('should list all profiles', () => {
      profileService.create('Profile 1')
      profileService.create('Profile 2')

      const list = profileService.list()

      expect(list).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should return null for non-existent profile', () => {
      const profile = profileService.get('non-existent')
      expect(profile).toBeNull()
    })

    it('should return profile by id', () => {
      const created = profileService.create('Test')
      const profile = profileService.get(created.id)

      expect(profile).not.toBeNull()
      expect(profile!.name).toBe('Test')
    })
  })

  describe('update', () => {
    it('should update profile name', () => {
      const profile = profileService.create('Original')
      const updated = profileService.update(profile.id, { name: 'Updated' })

      expect(updated).not.toBeNull()
      expect(updated!.name).toBe('Updated')
    })

    it('should update profile guidelines', () => {
      const profile = profileService.create('Test')
      const updated = profileService.update(profile.id, { guidelines: 'New guidelines' })

      expect(updated!.guidelines).toBe('New guidelines')
    })

    it('should preserve optional fields when not specified in update', () => {
      const profile = profileService.create('Test', '', 'System prompt')
      const updated = profileService.update(profile.id, { name: 'Updated Name' })

      // systemPrompt should be preserved since it wasn't in the update
      expect(updated!.systemPrompt).toBe('System prompt')
      expect(updated!.name).toBe('Updated Name')
    })

    it('should return null for non-existent profile', () => {
      const result = profileService.update('non-existent', { name: 'Test' })
      expect(result).toBeNull()
    })

    it('should update updatedAt timestamp', () => {
      const profile = profileService.create('Test')
      const oldUpdatedAt = profile.updatedAt

      const updated = profileService.update(profile.id, { name: 'New Name' })

      expect(updated!.updatedAt).toBeGreaterThanOrEqual(oldUpdatedAt)
    })
  })

  describe('delete', () => {
    it('should delete a profile', () => {
      const profile = profileService.create('To delete')
      const deleted = profileService.delete(profile.id)

      expect(deleted).toBe(true)
      expect(profileService.get(profile.id)).toBeNull()
    })

    it('should return false for non-existent profile', () => {
      const deleted = profileService.delete('non-existent')
      expect(deleted).toBe(false)
    })

    it('should clear current profile if deleted', () => {
      const profile = profileService.create('Current')
      profileService.setCurrentProfile(profile.id)

      profileService.delete(profile.id)

      expect(configService.getCurrentProfileId()).toBeNull()
    })
  })

  describe('setCurrentProfile', () => {
    it('should set the current profile', () => {
      const profile = profileService.create('Test')
      const result = profileService.setCurrentProfile(profile.id)

      expect(result).not.toBeNull()
      expect(configService.getCurrentProfileId()).toBe(profile.id)
    })

    it('should return null for non-existent profile', () => {
      const result = profileService.setCurrentProfile('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('getCurrent', () => {
    it('should return null when no current profile', () => {
      expect(profileService.getCurrent()).toBeNull()
    })

    it('should return current profile', () => {
      const profile = profileService.create('Current')
      profileService.setCurrentProfile(profile.id)

      const current = profileService.getCurrent()

      expect(current).not.toBeNull()
      expect(current!.id).toBe(profile.id)
    })
  })

  describe('clearCurrentProfile', () => {
    it('should clear the current profile', () => {
      const profile = profileService.create('Test')
      profileService.setCurrentProfile(profile.id)

      profileService.clearCurrentProfile()

      expect(profileService.getCurrent()).toBeNull()
    })
  })

  describe('export/import', () => {
    it('should export a profile without id and timestamps', () => {
      const profile = profileService.create('Export Test', 'Guidelines', 'System prompt')
      const exported = profileService.export(profile.id)

      expect(exported).not.toBeNull()
      expect(exported!.name).toBe('Export Test')
      expect(exported!.guidelines).toBe('Guidelines')
      expect(exported).not.toHaveProperty('id')
      expect(exported).not.toHaveProperty('createdAt')
      expect(exported).not.toHaveProperty('updatedAt')
    })

    it('should import a profile', () => {
      const imported = profileService.import({
        name: 'Imported Profile',
        guidelines: 'Imported guidelines',
        systemPrompt: 'Imported system prompt',
      })

      expect(imported.id).toMatch(/^profile_/)
      expect(imported.name).toBe('Imported Profile')
      expect(imported.guidelines).toBe('Imported guidelines')
    })
  })

  describe('createSnapshot', () => {
    it('should create a deep copy of the profile', () => {
      const profile = profileService.create('Test', '', '', { disabledServers: ['server1'] })
      const snapshot = profileService.createSnapshot(profile.id)

      expect(snapshot).not.toBeNull()
      expect(snapshot!.id).toBe(profile.id)
      expect(snapshot!.mcpServerConfig).toEqual({ disabledServers: ['server1'] })

      // Verify it's a deep copy
      snapshot!.mcpServerConfig!.disabledServers!.push('server2')
      const original = profileService.get(profile.id)
      expect(original!.mcpServerConfig!.disabledServers).toEqual(['server1'])
    })

    it('should return null for non-existent profile', () => {
      const snapshot = profileService.createSnapshot('non-existent')
      expect(snapshot).toBeNull()
    })
  })

  describe('exists', () => {
    it('should return true for existing profile', () => {
      const profile = profileService.create('Test')
      expect(profileService.exists(profile.id)).toBe(true)
    })

    it('should return false for non-existent profile', () => {
      expect(profileService.exists('non-existent')).toBe(false)
    })
  })
})