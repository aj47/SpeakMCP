/**
 * OAuth Integration Tests
 * 
 * Tests for OAuth 2.1 client implementation, token management,
 * and integration with MCP services.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OAuthClient } from '../src/main/oauth-client'
import { OAuthStorage } from '../src/main/oauth-storage'
import { OAuthCallbackServer } from '../src/main/oauth-callback-server'
import { MCPService } from '../src/main/mcp-service'
import { OAuthConfig, OAuthTokens, OAuthServerMetadata } from '../src/shared/types'

// Mock fetch for testing
global.fetch = vi.fn()

// Mock Electron modules
vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
  app: {
    whenReady: vi.fn(() => Promise.resolve()),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((data: string) => Buffer.from(data, 'utf8')),
    decryptString: vi.fn((buffer: Buffer) => buffer.toString('utf8')),
  },
}))

// Mock fs for testing
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

describe('OAuthClient', () => {
  let oauthClient: OAuthClient
  let mockConfig: OAuthConfig

  beforeEach(() => {
    mockConfig = {
      scope: 'user',
      useDiscovery: true,
      useDynamicRegistration: true,
    }
    oauthClient = new OAuthClient('https://example.com', mockConfig)
    vi.clearAllMocks()
  })

  describe('Server Metadata Discovery', () => {
    it('should discover server metadata from well-known endpoint', async () => {
      const mockMetadata: OAuthServerMetadata = {
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/authorize',
        token_endpoint: 'https://example.com/token',
        registration_endpoint: 'https://example.com/register',
        scopes_supported: ['user'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMetadata),
      })

      const metadata = await oauthClient.discoverServerMetadata()
      
      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/.well-known/oauth-authorization-server',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json',
            'MCP-Protocol-Version': '2025-03-26',
          }),
        })
      )
      expect(metadata).toEqual(mockMetadata)
    })

    it('should fallback to default endpoints when discovery fails', async () => {
      ;(global.fetch as any).mockRejectedValueOnce(new Error('Network error'))

      const metadata = await oauthClient.discoverServerMetadata()
      
      expect(metadata).toEqual({
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/authorize',
        token_endpoint: 'https://example.com/token',
        registration_endpoint: 'https://example.com/register',
        scopes_supported: ['user'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      })
    })
  })

  describe('Dynamic Client Registration', () => {
    it('should register client dynamically', async () => {
      const mockMetadata: OAuthServerMetadata = {
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/authorize',
        token_endpoint: 'https://example.com/token',
        registration_endpoint: 'https://example.com/register',
      }

      const mockRegistrationResponse = {
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
      }

      ;(global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockMetadata),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRegistrationResponse),
        })

      const result = await oauthClient.registerClient()
      
      expect(result).toEqual({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      })
    })

    it('should return existing client if already registered', async () => {
      const configWithClient = {
        ...mockConfig,
        clientId: 'existing-client-id',
        clientSecret: 'existing-client-secret',
      }
      
      const clientWithExisting = new OAuthClient('https://example.com', configWithClient)
      const result = await clientWithExisting.registerClient()
      
      expect(result).toEqual({
        clientId: 'existing-client-id',
        clientSecret: 'existing-client-secret',
      })
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('Authorization Flow', () => {
    it('should generate authorization URL with PKCE', async () => {
      const mockMetadata: OAuthServerMetadata = {
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/authorize',
        token_endpoint: 'https://example.com/token',
        registration_endpoint: 'https://example.com/register',
      }

      const mockRegistrationResponse = {
        client_id: 'test-client-id',
      }

      ;(global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockMetadata),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRegistrationResponse),
        })

      const authRequest = await oauthClient.startAuthorizationFlow()
      
      expect(authRequest.authorizationUrl).toContain('https://example.com/authorize')
      expect(authRequest.authorizationUrl).toContain('response_type=code')
      expect(authRequest.authorizationUrl).toContain('client_id=test-client-id')
      expect(authRequest.authorizationUrl).toContain('code_challenge_method=S256')
      expect(authRequest.codeVerifier).toBeDefined()
      expect(authRequest.state).toBeDefined()
    })
  })

  describe('Token Exchange', () => {
    it('should exchange authorization code for tokens', async () => {
      const mockMetadata: OAuthServerMetadata = {
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/authorize',
        token_endpoint: 'https://example.com/token',
      }

      const mockTokenResponse = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'test-refresh-token',
        scope: 'user',
      }

      ;(global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockMetadata),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ client_id: 'test-client-id' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })

      const tokens = await oauthClient.exchangeCodeForToken({
        code: 'test-code',
        codeVerifier: 'test-verifier',
        state: 'test-state',
      })
      
      expect(tokens.access_token).toBe('test-access-token')
      expect(tokens.token_type).toBe('Bearer')
      expect(tokens.expires_in).toBe(3600)
      expect(tokens.refresh_token).toBe('test-refresh-token')
      expect(tokens.expires_at).toBeDefined()
    })
  })

  describe('Token Refresh', () => {
    it('should refresh access token using refresh token', async () => {
      const mockMetadata: OAuthServerMetadata = {
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/authorize',
        token_endpoint: 'https://example.com/token',
      }

      const mockTokenResponse = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'user',
      }

      // Set up client with existing tokens
      const configWithTokens = {
        ...mockConfig,
        clientId: 'test-client-id',
        tokens: {
          access_token: 'old-access-token',
          token_type: 'Bearer',
          refresh_token: 'test-refresh-token',
          expires_at: Date.now() - 1000, // Expired
        } as OAuthTokens,
      }

      const clientWithTokens = new OAuthClient('https://example.com', configWithTokens)

      ;(global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockMetadata),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })

      const tokens = await clientWithTokens.refreshToken()
      
      expect(tokens.access_token).toBe('new-access-token')
      expect(tokens.refresh_token).toBe('test-refresh-token') // Should preserve existing refresh token
    })
  })

  describe('Token Validation', () => {
    it('should validate token correctly', () => {
      const validTokens: OAuthTokens = {
        access_token: 'valid-token',
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000, // 1 hour from now
      }

      const configWithValidTokens = {
        ...mockConfig,
        tokens: validTokens,
      }

      const clientWithValidTokens = new OAuthClient('https://example.com', configWithValidTokens)
      expect(clientWithValidTokens.isTokenValid()).toBe(true)
    })

    it('should detect expired tokens', () => {
      const expiredTokens: OAuthTokens = {
        access_token: 'expired-token',
        token_type: 'Bearer',
        expires_at: Date.now() - 1000, // 1 second ago
      }

      const configWithExpiredTokens = {
        ...mockConfig,
        tokens: expiredTokens,
      }

      const clientWithExpiredTokens = new OAuthClient('https://example.com', configWithExpiredTokens)
      expect(clientWithExpiredTokens.isTokenValid()).toBe(false)
    })
  })
})

describe('OAuthCallbackServer', () => {
  let callbackServer: OAuthCallbackServer

  beforeEach(() => {
    callbackServer = new OAuthCallbackServer(3001)
  })

  afterEach(() => {
    callbackServer.stop()
  })

  it('should provide correct redirect URI', () => {
    expect(callbackServer.getRedirectUri()).toBe('http://localhost:3001/callback')
  })

  it('should report correct port', () => {
    expect(callbackServer.getPort()).toBe(3001)
  })

  it('should start and stop correctly', () => {
    expect(callbackServer.isRunning()).toBe(false)
    callbackServer.stop()
    expect(callbackServer.isRunning()).toBe(false)
  })
})

describe('OAuth Integration with MCP Service', () => {
  let mcpService: MCPService

  beforeEach(() => {
    mcpService = new MCPService()
  })

  it('should handle OAuth status check for non-existent server', async () => {
    const status = await mcpService.getOAuthStatus('non-existent-server')
    
    expect(status.configured).toBe(false)
    expect(status.authenticated).toBe(false)
  })

  it('should handle OAuth token revocation for non-existent server', async () => {
    const result = await mcpService.revokeOAuthTokens('non-existent-server')
    
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})
