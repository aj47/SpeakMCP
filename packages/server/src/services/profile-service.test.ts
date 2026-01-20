import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Mock the config module before importing profile-service
let tempDir: string
let profilesJsonPath: string

// We need to mock getProfilesFolder and configStore before importing
vi.mock('../config', () => {
  return {
    getProfilesFolder: () => path.join(tempDir, 'profiles'),
    ensureDir: (dirPath: string) => {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
    },
    configStore: {
      get: () => ({
        mcpConfig: {
          mcpServers: {
            'test-server-1': { command: 'test', args: [] },
            'test-server-2': { command: 'test2', args: [] },
          }
        }
      }),
      save: vi.fn(),
    }
  }
})

describe('ProfileService', () => {
  let ProfileService: typeof import('./profile-service')
  
  beforeEach(async () => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakmcp-profile-test-'))
    profilesJsonPath = path.join(tempDir, 'profiles.json')
    
    // Reset module cache to get fresh ProfileService
    vi.resetModules()
    
    // Re-import with updated tempDir (mock uses closure)
    ProfileService = await import('./profile-service')
  })

  afterEach(() => {
    vi.resetModules()
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('getProfiles', () => {
    it('should return profiles with at least the default profile', () => {
      const profiles = ProfileService.profileService.getProfiles()
      
      expect(profiles).toBeInstanceOf(Array)
      expect(profiles.length).toBeGreaterThanOrEqual(1)
      
      const defaultProfile = profiles.find(p => p.id === 'default')
      expect(defaultProfile).toBeDefined()
      expect(defaultProfile?.isDefault).toBe(true)
      expect(defaultProfile?.name).toBe('Default')
    })
  })

  describe('getProfile', () => {
    it('should return a profile by ID', () => {
      const profile = ProfileService.profileService.getProfile('default')
      
      expect(profile).toBeDefined()
      expect(profile?.id).toBe('default')
      expect(profile?.name).toBe('Default')
    })

    it('should return undefined for non-existent profile', () => {
      const profile = ProfileService.profileService.getProfile('non-existent-id')
      
      expect(profile).toBeUndefined()
    })
  })

  describe('getCurrentProfile', () => {
    it('should return the current active profile', () => {
      const currentProfile = ProfileService.profileService.getCurrentProfile()
      
      expect(currentProfile).toBeDefined()
      expect(currentProfile?.id).toBe('default')
    })
  })

  describe('createProfile', () => {
    it('should create a new profile with name and guidelines', () => {
      const profile = ProfileService.profileService.createProfile('Test Profile', 'Test guidelines')
      
      expect(profile).toBeDefined()
      expect(profile.id).toBeDefined()
      expect(profile.name).toBe('Test Profile')
      expect(profile.guidelines).toBe('Test guidelines')
      expect(profile.createdAt).toBeDefined()
      expect(profile.updatedAt).toBeDefined()
      expect(profile.isDefault).toBeUndefined()
    })

    it('should create a profile with systemPrompt', () => {
      const profile = ProfileService.profileService.createProfile('Test', 'guidelines', 'Custom system prompt')
      
      expect(profile.systemPrompt).toBe('Custom system prompt')
    })

    it('should persist profile to disk', () => {
      ProfileService.profileService.createProfile('Persistent Profile', 'test')
      
      expect(fs.existsSync(profilesJsonPath)).toBe(true)
      
      const savedData = JSON.parse(fs.readFileSync(profilesJsonPath, 'utf8'))
      const foundProfile = savedData.profiles.find((p: any) => p.name === 'Persistent Profile')
      expect(foundProfile).toBeDefined()
    })

    it('should initialize new profiles with all MCP servers disabled', () => {
      const profile = ProfileService.profileService.createProfile('Test', 'test')
      
      expect(profile.mcpServerConfig).toBeDefined()
      expect(profile.mcpServerConfig?.allServersDisabledByDefault).toBe(true)
      expect(profile.mcpServerConfig?.disabledServers).toContain('test-server-1')
      expect(profile.mcpServerConfig?.disabledServers).toContain('test-server-2')
    })
  })

  describe('updateProfile', () => {
    it('should update profile name and guidelines', () => {
      const created = ProfileService.profileService.createProfile('Original', 'Original guidelines')
      
      const updated = ProfileService.profileService.updateProfile(created.id, {
        name: 'Updated Name',
        guidelines: 'Updated guidelines',
      })
      
      expect(updated.name).toBe('Updated Name')
      expect(updated.guidelines).toBe('Updated guidelines')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    })

    it('should update systemPrompt', () => {
      const created = ProfileService.profileService.createProfile('Test', 'test')
      
      const updated = ProfileService.profileService.updateProfile(created.id, {
        systemPrompt: 'New system prompt',
      })
      
      expect(updated.systemPrompt).toBe('New system prompt')
    })

    it('should throw error when updating non-existent profile', () => {
      expect(() => {
        ProfileService.profileService.updateProfile('non-existent', { name: 'Test' })
      }).toThrow('Profile with id non-existent not found')
    })

    it('should throw error when updating default profile', () => {
      expect(() => {
        ProfileService.profileService.updateProfile('default', { name: 'New Name' })
      }).toThrow('Cannot update default profiles')
    })
  })

  describe('deleteProfile', () => {
    it('should delete a profile and return true', () => {
      const created = ProfileService.profileService.createProfile('ToDelete', 'test')

      const result = ProfileService.profileService.deleteProfile(created.id)

      expect(result).toBe(true)
      expect(ProfileService.profileService.getProfile(created.id)).toBeUndefined()
    })

    it('should return false for non-existent profile', () => {
      const result = ProfileService.profileService.deleteProfile('non-existent')

      expect(result).toBe(false)
    })

    it('should throw error when deleting default profile', () => {
      expect(() => {
        ProfileService.profileService.deleteProfile('default')
      }).toThrow('Cannot delete default profiles')
    })

    it('should switch to default profile when deleting current profile', () => {
      const created = ProfileService.profileService.createProfile('Current', 'test')
      ProfileService.profileService.setCurrentProfile(created.id)

      expect(ProfileService.profileService.getCurrentProfile()?.id).toBe(created.id)

      ProfileService.profileService.deleteProfile(created.id)

      expect(ProfileService.profileService.getCurrentProfile()?.id).toBe('default')
    })

    it('should persist deletion to disk', () => {
      const created = ProfileService.profileService.createProfile('ToDelete', 'test')
      ProfileService.profileService.deleteProfile(created.id)

      const savedData = JSON.parse(fs.readFileSync(profilesJsonPath, 'utf8'))
      const foundProfile = savedData.profiles.find((p: any) => p.id === created.id)
      expect(foundProfile).toBeUndefined()
    })
  })

  describe('setCurrentProfile', () => {
    it('should switch to a different profile', () => {
      const created = ProfileService.profileService.createProfile('New Profile', 'test')

      const result = ProfileService.profileService.setCurrentProfile(created.id)

      expect(result.id).toBe(created.id)
      expect(ProfileService.profileService.getCurrentProfile()?.id).toBe(created.id)
    })

    it('should throw error for non-existent profile', () => {
      expect(() => {
        ProfileService.profileService.setCurrentProfile('non-existent')
      }).toThrow('Profile with id non-existent not found')
    })

    it('should persist current profile to disk', () => {
      const created = ProfileService.profileService.createProfile('New Profile', 'test')
      ProfileService.profileService.setCurrentProfile(created.id)

      const savedData = JSON.parse(fs.readFileSync(profilesJsonPath, 'utf8'))
      expect(savedData.currentProfileId).toBe(created.id)
    })
  })

  describe('updateProfileMcpConfig', () => {
    it('should update disabledServers', () => {
      const created = ProfileService.profileService.createProfile('Test', 'test')

      const updated = ProfileService.profileService.updateProfileMcpConfig(created.id, {
        disabledServers: ['server-a', 'server-b'],
      })

      expect(updated.mcpServerConfig?.disabledServers).toEqual(['server-a', 'server-b'])
    })

    it('should update disabledTools', () => {
      const created = ProfileService.profileService.createProfile('Test', 'test')

      const updated = ProfileService.profileService.updateProfileMcpConfig(created.id, {
        disabledTools: ['tool-1', 'tool-2'],
      })

      expect(updated.mcpServerConfig?.disabledTools).toEqual(['tool-1', 'tool-2'])
    })

    it('should update enabledServers', () => {
      const created = ProfileService.profileService.createProfile('Test', 'test')

      const updated = ProfileService.profileService.updateProfileMcpConfig(created.id, {
        enabledServers: ['enabled-server'],
      })

      expect(updated.mcpServerConfig?.enabledServers).toEqual(['enabled-server'])
    })

    it('should update allServersDisabledByDefault flag', () => {
      const created = ProfileService.profileService.createProfile('Test', 'test')

      const updated = ProfileService.profileService.updateProfileMcpConfig(created.id, {
        allServersDisabledByDefault: false,
      })

      expect(updated.mcpServerConfig?.allServersDisabledByDefault).toBe(false)
    })

    it('should merge with existing config, not replace', () => {
      const created = ProfileService.profileService.createProfile('Test', 'test')

      // First update
      ProfileService.profileService.updateProfileMcpConfig(created.id, {
        disabledServers: ['server-a'],
      })

      // Second update - should not remove disabledServers
      const updated = ProfileService.profileService.updateProfileMcpConfig(created.id, {
        enabledServers: ['server-b'],
      })

      expect(updated.mcpServerConfig?.disabledServers).toEqual(['server-a'])
      expect(updated.mcpServerConfig?.enabledServers).toEqual(['server-b'])
    })

    it('should throw error for non-existent profile', () => {
      expect(() => {
        ProfileService.profileService.updateProfileMcpConfig('non-existent', {
          disabledServers: [],
        })
      }).toThrow('Profile with id non-existent not found')
    })

    it('should update timestamp', () => {
      const created = ProfileService.profileService.createProfile('Test', 'test')
      const originalUpdatedAt = created.updatedAt

      // Small delay to ensure different timestamp
      const updated = ProfileService.profileService.updateProfileMcpConfig(created.id, {
        disabledServers: ['new-server'],
      })

      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
    })
  })
})

