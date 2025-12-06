/**
 * OAuth 2.1 Client Implementation for MCP Servers
 *
 * Implements OAuth 2.1 with PKCE, dynamic client registration (RFC7591),
 * and authorization server metadata discovery (RFC8414) for secure
 * authentication with MCP servers.
 */

import { shell } from "electron"
import crypto from "crypto"
import { OAuthConfig, OAuthTokens, OAuthServerMetadata, OAuthClientMetadata } from "@shared/types"

export interface OAuthAuthorizationRequest {
  authorizationUrl: string
  codeVerifier: string
  state: string
}

export interface OAuthTokenRequest {
  code: string
  codeVerifier: string
  state: string
}

export class OAuthClient {
  private config: OAuthConfig
  private baseUrl: string

  constructor(baseUrl: string, config: OAuthConfig = {}) {
    this.baseUrl = baseUrl
    this.config = {
      scope: "user",
      useDiscovery: true,
      useDynamicRegistration: true,
      ...config,
    }
  }

  /**
   * Discover OAuth server metadata using RFC8414
   */
  async discoverServerMetadata(): Promise<OAuthServerMetadata> {
    if (this.config.serverMetadata) {
      return this.config.serverMetadata
    }

    const url = new URL(this.baseUrl)
    const metadataUrl = `${url.protocol}//${url.host}/.well-known/oauth-authorization-server`

    try {
      const response = await fetch(metadataUrl, {
        headers: {
          'Accept': 'application/json',
          'MCP-Protocol-Version': '2025-03-26', // As per MCP spec
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to discover server metadata: ${response.status} ${response.statusText}`)
      }

      const metadata = await response.json() as OAuthServerMetadata

      // Validate required fields
      if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
        throw new Error('Invalid server metadata: missing required endpoints')
      }

      this.config.serverMetadata = metadata
      return metadata
    } catch (error) {
      // Fallback to default endpoints as per MCP spec
      const fallbackMetadata: OAuthServerMetadata = {
        issuer: `${url.protocol}//${url.host}`,
        authorization_endpoint: `${url.protocol}//${url.host}/authorize`,
        token_endpoint: `${url.protocol}//${url.host}/token`,
        registration_endpoint: `${url.protocol}//${url.host}/register`,
        scopes_supported: ['user'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      }

      this.config.serverMetadata = fallbackMetadata
      return fallbackMetadata
    }
  }

  /**
   * Register OAuth client dynamically using RFC7591
   */
  async registerClient(): Promise<{ clientId: string; clientSecret?: string }> {
    // If we already have a client ID, use it consistently
    if (this.config.clientId) {
      return {
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      }
    }

    const metadata = await this.discoverServerMetadata()

    if (!metadata.registration_endpoint) {
      throw new Error('Dynamic client registration not supported by server')
    }

    // Always determine redirect URI based on current environment, ignoring stored config
    const isDevelopment = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL
    const redirectUri = isDevelopment ? 'http://localhost:3000/callback' : 'speakmcp://oauth/callback'

    const clientMetadata: OAuthClientMetadata = {
      client_name: 'SpeakMCP',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: this.config.scope || 'user',
      token_endpoint_auth_method: 'none', // Public client
      // Don't merge stored clientMetadata to ensure we use the correct redirect URI for current environment
      ...(this.config.clientMetadata && {
        client_name: this.config.clientMetadata.client_name || 'SpeakMCP',
        grant_types: this.config.clientMetadata.grant_types || ['authorization_code', 'refresh_token'],
        response_types: this.config.clientMetadata.response_types || ['code'],
        scope: this.config.clientMetadata.scope || this.config.scope || 'user',
        token_endpoint_auth_method: this.config.clientMetadata.token_endpoint_auth_method || 'none',
      }),
    }

    try {
      const response = await fetch(metadata.registration_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(clientMetadata),
      })

      if (!response.ok) {
        throw new Error(`Client registration failed: ${response.status} ${response.statusText}`)
      }

      const registrationResponse = await response.json()

      this.config.clientId = registrationResponse.client_id
      this.config.clientSecret = registrationResponse.client_secret
      this.config.clientMetadata = clientMetadata

      // Ensure client configuration is saved
      await this.saveClientConfig()

      return {
        clientId: registrationResponse.client_id,
        clientSecret: registrationResponse.client_secret,
      }
    } catch (error) {
      throw new Error(`Failed to register OAuth client: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  private generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url')

    return { codeVerifier, codeChallenge }
  }

  /**
   * Generate authorization URL and initiate OAuth flow
   */
  async startAuthorizationFlow(): Promise<OAuthAuthorizationRequest> {
    const metadata = await this.discoverServerMetadata()
    const { clientId } = await this.registerClient()
    const { codeVerifier, codeChallenge } = this.generatePKCE()
    const state = crypto.randomBytes(16).toString('base64url')

    const authUrl = new URL(metadata.authorization_endpoint)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', clientId)

    // Always determine redirect URI based on current environment, ignoring stored config
    const isDevelopment = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL
    const redirectUri = isDevelopment ? 'http://localhost:3000/callback' : 'speakmcp://oauth/callback'

    // Set OAuth parameters
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', this.config.scope || 'user')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    return {
      authorizationUrl: authUrl.toString(),
      codeVerifier,
      state,
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(request: OAuthTokenRequest): Promise<OAuthTokens> {
    const metadata = await this.discoverServerMetadata()

    // Ensure we have a consistent client registration
    let { clientId, clientSecret } = this.config

    if (!clientId) {
      const registration = await this.registerClient()
      clientId = registration.clientId
      clientSecret = registration.clientSecret
    }

    // Always use appropriate redirect URI based on current environment, ignoring stored config
    const isDevelopment = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL
    const redirectUri = isDevelopment ? 'http://localhost:3000/callback' : 'speakmcp://oauth/callback'

    const tokenRequest = new URLSearchParams({
      grant_type: 'authorization_code',
      code: request.code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: request.codeVerifier,
    })

    if (clientSecret) {
      tokenRequest.set('client_secret', clientSecret)
    }

    try {
      const response = await fetch(metadata.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: tokenRequest.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const tokenResponse = await response.json()

      const tokens: OAuthTokens = {
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        refresh_token: tokenResponse.refresh_token,
        scope: tokenResponse.scope,
        expires_at: tokenResponse.expires_in
          ? Date.now() + (tokenResponse.expires_in * 1000)
          : undefined,
      }

      this.config.tokens = tokens
      return tokens
    } catch (error) {
      throw new Error(`Failed to exchange code for token: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(): Promise<OAuthTokens> {
    if (!this.config.tokens?.refresh_token) {
      throw new Error('No refresh token available')
    }

    const metadata = await this.discoverServerMetadata()
    const { clientId, clientSecret } = await this.registerClient()

    const tokenRequest = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.tokens.refresh_token,
      client_id: clientId,
    })

    if (clientSecret) {
      tokenRequest.set('client_secret', clientSecret)
    }

    try {
      const response = await fetch(metadata.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: tokenRequest.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const tokenResponse = await response.json()

      const tokens: OAuthTokens = {
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        refresh_token: tokenResponse.refresh_token || this.config.tokens.refresh_token,
        scope: tokenResponse.scope,
        expires_at: tokenResponse.expires_in
          ? Date.now() + (tokenResponse.expires_in * 1000)
          : undefined,
      }

      this.config.tokens = tokens
      return tokens
    } catch (error) {
      throw new Error(`Failed to refresh token: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Check if current token is valid and not expired
   */
  isTokenValid(): boolean {
    if (!this.config.tokens?.access_token) {
      return false
    }

    if (this.config.tokens.expires_at && Date.now() >= this.config.tokens.expires_at) {
      return false
    }

    return true
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  async getValidToken(): Promise<string> {
    if (this.isTokenValid()) {
      return this.config.tokens!.access_token
    }

    if (this.config.tokens?.refresh_token) {
      const tokens = await this.refreshToken()
      return tokens.access_token
    }

    throw new Error('No valid token available and no refresh token')
  }

  /**
   * Open authorization URL in default browser
   */
  async openAuthorizationUrl(authorizationUrl: string): Promise<void> {
    await shell.openExternal(authorizationUrl)
  }

  /**
   * Complete OAuth flow with callback (deep link in production, localhost in dev)
   */
  async completeAuthorizationFlow(): Promise<OAuthTokens> {
    // Always determine redirect URI based on current environment, ignoring stored config
    const isDevelopment = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL

    if (isDevelopment) {
      // Use localhost callback server in development
      const { handleOAuthCallback } = await import('./oauth-callback-server')

      // Start authorization flow
      const authRequest = await this.startAuthorizationFlow()

      // Start callback server first
      const callbackPromise = handleOAuthCallback(300000) // 5 minute timeout

      // Open authorization URL after server is ready
      await this.openAuthorizationUrl(authRequest.authorizationUrl)

      // Wait for localhost callback
      const callbackResult = await callbackPromise

      if (callbackResult.error) {
        throw new Error(`OAuth authorization failed: ${callbackResult.error} - ${callbackResult.error_description || 'Unknown error'}`)
      }

      if (!callbackResult.code) {
        throw new Error('No authorization code received')
      }

      if (callbackResult.state !== authRequest.state) {
        throw new Error('Invalid OAuth state parameter')
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForToken({
        code: callbackResult.code,
        codeVerifier: authRequest.codeVerifier,
        state: callbackResult.state,
      })

      return tokens
    } else {
      // Use deep link callback in production
      const { handleOAuthCallback } = await import('./oauth-deeplink-handler')

      // Start authorization flow
      const authRequest = await this.startAuthorizationFlow()

      // Start deep link handler first
      const callbackPromise = handleOAuthCallback(300000) // 5 minute timeout

      // Open authorization URL after handler is ready
      await this.openAuthorizationUrl(authRequest.authorizationUrl)

      // Wait for deep link callback
      const callbackResult = await callbackPromise

      if (callbackResult.error) {
        throw new Error(`OAuth authorization failed: ${callbackResult.error} - ${callbackResult.error_description || 'Unknown error'}`)
      }

      if (!callbackResult.code) {
        throw new Error('No authorization code received')
      }

      if (callbackResult.state !== authRequest.state) {
        throw new Error('Invalid OAuth state parameter')
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForToken({
        code: callbackResult.code,
        codeVerifier: authRequest.codeVerifier,
        state: callbackResult.state,
      })

      return tokens
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): OAuthConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<OAuthConfig>): void {
    this.config = { ...this.config, ...updates }
  }

  /**
   * Save client configuration to persistent storage
   */
  private async saveClientConfig(): Promise<void> {
    try {
      // Import OAuth storage and save client configuration
      const { oauthStorage } = await import('./oauth-storage')
      await oauthStorage.save(this.baseUrl, this.config)
    } catch (error) {
      // Silently fail - configuration will be re-registered if needed
    }
  }
}
