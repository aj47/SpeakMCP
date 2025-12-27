import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupTestDb, teardownTestDb, resetTestDb } from '../test-utils.js'
import { oauthService } from './oauth-service.js'

describe('oauthService', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    teardownTestDb()
  })

  beforeEach(() => {
    resetTestDb()
  })

  describe('storeToken', () => {
    it('should store a basic token', () => {
      const token = oauthService.storeToken('test-server', 'access_token_123')

      expect(token).toBeDefined()
      expect(token.id).toMatch(/^oauth_/)
      expect(token.serverName).toBe('test-server')
      expect(token.accessToken).toBe('access_token_123')
      expect(token.tokenType).toBe('Bearer')
    })

    it('should store token with all options', () => {
      const token = oauthService.storeToken('full-server', 'access_xyz', {
        refreshToken: 'refresh_xyz',
        tokenType: 'CustomType',
        expiresIn: 3600, // 1 hour
        scope: 'read write',
      })

      expect(token.accessToken).toBe('access_xyz')
      expect(token.refreshToken).toBe('refresh_xyz')
      expect(token.tokenType).toBe('CustomType')
      expect(token.scope).toBe('read write')
      expect(token.expiresAt).toBeGreaterThan(Date.now())
    })

    it('should upsert existing token', () => {
      oauthService.storeToken('server', 'old_token')
      const updated = oauthService.storeToken('server', 'new_token')

      expect(updated.accessToken).toBe('new_token')

      // Should only have one token for this server
      const tokens = oauthService.listTokens()
      const serverTokens = tokens.filter(t => t.serverName === 'server')
      expect(serverTokens).toHaveLength(1)
    })

    it('should preserve refresh token on update if not provided', () => {
      oauthService.storeToken('server', 'token1', { refreshToken: 'refresh1' })
      oauthService.storeToken('server', 'token2') // No refresh token

      const token = oauthService.getToken('server')
      expect(token?.accessToken).toBe('token2')
      expect(token?.refreshToken).toBe('refresh1') // Should be preserved
    })
  })

  describe('getToken', () => {
    it('should return null for non-existent token', () => {
      const token = oauthService.getToken('nonexistent')
      expect(token).toBeNull()
    })

    it('should return stored token', () => {
      oauthService.storeToken('my-server', 'my_token')

      const token = oauthService.getToken('my-server')

      expect(token).not.toBeNull()
      expect(token!.accessToken).toBe('my_token')
    })
  })

  describe('isTokenExpired', () => {
    it('should return true for non-existent token', () => {
      expect(oauthService.isTokenExpired('nonexistent')).toBe(true)
    })

    it('should return false for token without expiry', () => {
      oauthService.storeToken('server', 'token')

      expect(oauthService.isTokenExpired('server')).toBe(false)
    })

    it('should return true for expired token', () => {
      // Store token that expires in -1 second (already expired)
      oauthService.storeToken('server', 'token', { expiresIn: -1 })

      expect(oauthService.isTokenExpired('server')).toBe(true)
    })

    it('should return true for token expiring soon (within 5 min buffer)', () => {
      // Store token that expires in 4 minutes (within 5 min buffer)
      oauthService.storeToken('server', 'token', { expiresIn: 240 })

      expect(oauthService.isTokenExpired('server')).toBe(true)
    })

    it('should return false for token not expiring soon', () => {
      // Store token that expires in 10 minutes
      oauthService.storeToken('server', 'token', { expiresIn: 600 })

      expect(oauthService.isTokenExpired('server')).toBe(false)
    })
  })

  describe('deleteToken', () => {
    it('should delete an existing token', () => {
      oauthService.storeToken('server', 'token')

      const deleted = oauthService.deleteToken('server')

      expect(deleted).toBe(true)
      expect(oauthService.getToken('server')).toBeNull()
    })

    it('should return false for non-existent token', () => {
      const deleted = oauthService.deleteToken('nonexistent')
      expect(deleted).toBe(false)
    })
  })

  describe('listTokens', () => {
    it('should return empty array when no tokens', () => {
      const tokens = oauthService.listTokens()
      expect(tokens).toEqual([])
    })

    it('should list all tokens without exposing secrets', () => {
      oauthService.storeToken('server1', 'secret1', { scope: 'read' })
      oauthService.storeToken('server2', 'secret2', { expiresIn: 3600 })

      const tokens = oauthService.listTokens()

      expect(tokens).toHaveLength(2)

      // Should NOT include access token or refresh token
      const token1 = tokens.find(t => t.serverName === 'server1')
      expect(token1).toBeDefined()
      expect(token1!.scope).toBe('read')
      expect((token1 as any).accessToken).toBeUndefined()
      expect((token1 as any).refreshToken).toBeUndefined()
    })

    it('should include isExpired status', () => {
      oauthService.storeToken('expired', 'token', { expiresIn: -1 })
      oauthService.storeToken('valid', 'token', { expiresIn: 3600 })

      const tokens = oauthService.listTokens()

      const expired = tokens.find(t => t.serverName === 'expired')
      const valid = tokens.find(t => t.serverName === 'valid')

      expect(expired!.isExpired).toBe(true)
      expect(valid!.isExpired).toBe(false)
    })
  })

  describe('clearAllTokens', () => {
    it('should clear all tokens', () => {
      oauthService.storeToken('server1', 'token1')
      oauthService.storeToken('server2', 'token2')
      oauthService.storeToken('server3', 'token3')

      const count = oauthService.clearAllTokens()

      expect(count).toBe(3)
      expect(oauthService.listTokens()).toHaveLength(0)
    })
  })

  describe('getAuthHeader', () => {
    it('should return null for non-existent token', () => {
      const header = oauthService.getAuthHeader('nonexistent')
      expect(header).toBeNull()
    })

    it('should return Bearer header', () => {
      oauthService.storeToken('server', 'my_access_token')

      const header = oauthService.getAuthHeader('server')

      expect(header).toBe('Bearer my_access_token')
    })

    it('should use custom token type', () => {
      oauthService.storeToken('server', 'token', { tokenType: 'Basic' })

      const header = oauthService.getAuthHeader('server')

      expect(header).toBe('Basic token')
    })
  })

  describe('updateAccessToken', () => {
    it('should update access token', () => {
      oauthService.storeToken('server', 'old_token')

      const updated = oauthService.updateAccessToken('server', 'new_token')

      expect(updated).toBe(true)
      expect(oauthService.getToken('server')!.accessToken).toBe('new_token')
    })

    it('should update expiry time', () => {
      oauthService.storeToken('server', 'token')

      oauthService.updateAccessToken('server', 'token', 7200)

      const token = oauthService.getToken('server')
      expect(token!.expiresAt).toBeGreaterThan(Date.now())
    })

    it('should return false for non-existent token', () => {
      const updated = oauthService.updateAccessToken('nonexistent', 'token')
      expect(updated).toBe(false)
    })
  })
})