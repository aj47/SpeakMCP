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

    // Handle Notion server with specific metadata
    const isNotion = this.baseUrl && this.baseUrl.includes('notion.com')
    if (isNotion) {
      return {
        issuer: 'https://api.notion.com',
        authorization_endpoint: 'https://api.notion.com/v1/oauth/authorize',
        token_endpoint: 'https://api.notion.com/v1/oauth/token',
        scopes_supported: ['user'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      }
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
    // Handle Notion-specific client ID
    const isNotionServer = this.baseUrl && this.baseUrl.includes('notion.com')
    if (isNotionServer) {
      // Use the actual Notion client ID for MCP
      return {
        clientId: '1f8d872b-594c-80a4-b2f4-00370af2b13f',
        clientSecret: undefined,
      }
    }

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

    // Check if this is the Notion server and use appropriate redirect URI
    const isNotionRedirect = this.baseUrl && this.baseUrl.includes('notion.com')
    const redirectUri = isNotionRedirect
      ? 'https://mcp.notion.com/callback' // Notion-specific redirect URI
      : (isDevelopment ? 'http://localhost:3000/callback' : 'speakmcp://oauth/callback')

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

    console.log('🔗 OAuth Authorization URL Details:')
    console.log('  📍 Authorization endpoint:', metadata.authorization_endpoint)
    console.log('  🎯 Redirect URI:', redirectUri)
    console.log('  🆔 Client ID:', clientId)
    console.log('  🔐 State:', state)
    console.log('  📋 Scope:', this.config.scope || 'user')
    console.log('  🔑 Code challenge method: S256')

    // Ensure consistent parameter encoding - use manual encoding for better control
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', this.config.scope || 'user')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    // Check URL format for potential issues
    const urlCheck = authUrl.toString()
    if (urlCheck.length > 2048) {
      console.warn('⚠️ URL exceeds 2048 characters, may cause issues')
    }

    // Validate URL encoding
    const encodedCheck = encodeURIComponent(redirectUri)
    console.log('Redirect URI encoding check:', encodedCheck)

    // Check if this is the Notion server and log specific details
    if (metadata.authorization_endpoint.includes('notion')) {
      console.log('📝 Notion-specific URL validation:')
      console.log('  Base URL:', metadata.authorization_endpoint)
      console.log('  Final URL:', authUrl.toString())
      console.log('  URL length:', authUrl.toString().length)
      console.log('  All parameters:')
      for (const [key, value] of authUrl.searchParams) {
        console.log(`    ${key}: ${value} (${encodeURIComponent(value)})`)
      }

      // Also log the raw URL for manual testing
      console.log('  Manual test URL:', authUrl.toString())
    }

    // Log the exact URL format for debugging
    const finalUrl = authUrl.toString()
    console.log('🌐 Complete authorization URL:', finalUrl)
    console.log('📏 URL length:', finalUrl.length)

    // Debug: Log URL components for validation
    const debugUrl = new URL(finalUrl)
    console.log('🔍 URL validation:')
    console.log('  response_type:', debugUrl.searchParams.get('response_type'))
    console.log('  client_id:', debugUrl.searchParams.get('client_id'))
    console.log('  redirect_uri:', debugUrl.searchParams.get('redirect_uri'))
    console.log('  scope:', debugUrl.searchParams.get('scope'))
    console.log('  state:', debugUrl.searchParams.get('state'))
    console.log('  code_challenge:', debugUrl.searchParams.get('code_challenge'))
    console.log('  code_challenge_method:', debugUrl.searchParams.get('code_challenge_method'))

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
    console.log('🔄 Starting token exchange...')

    const metadata = await this.discoverServerMetadata()
    const { clientId, clientSecret } = await this.registerClient()

    // Always use appropriate redirect URI based on current environment, ignoring stored config
    const isDevelopment = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL

    // Check if this is the Notion server and use appropriate redirect URI
    const isNotion = this.baseUrl && this.baseUrl.includes('notion.com')
    const redirectUri = isNotion
      ? 'https://mcp.notion.com/callback' // Notion-specific redirect URI
      : (isDevelopment ? 'http://localhost:3000/callback' : 'speakmcp://oauth/callback')

    console.log('🔗 Token Exchange URL Details:')
    console.log('  📍 Token endpoint:', metadata.token_endpoint)
    console.log('  🆔 Client ID:', clientId)
    console.log('  🎯 Redirect URI used:', redirectUri)
    console.log('  🔐 State:', request.state)
    console.log('  🔑 Has code verifier:', !!request.codeVerifier)
    console.log('  📦 Has authorization code:', !!request.code)

    console.log('📋 Complete token exchange request URL:', metadata.token_endpoint)

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
      console.log('🌐 Making token exchange request to:', metadata.token_endpoint)
      const response = await fetch(metadata.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: tokenRequest.toString(),
      })

      console.log('📡 Token exchange response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Token exchange failed:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText
        })
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const tokenResponse = await response.json()
      console.log('📦 Token response received:', {
        hasAccessToken: !!tokenResponse.access_token,
        hasRefreshToken: !!tokenResponse.refresh_token,
        tokenType: tokenResponse.token_type,
        expiresIn: tokenResponse.expires_in,
        scope: tokenResponse.scope
      })

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
      console.log('✅ Tokens stored successfully')
      return tokens
    } catch (error) {
      const errorMsg = `Failed to exchange code for token: ${error instanceof Error ? error.message : String(error)}`
      console.error('❌', errorMsg)
      throw new Error(errorMsg)
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
    const redirectUri = isDevelopment ? 'http://localhost:3000/callback' : 'speakmcp://oauth/callback'

    console.log(`🔄 Starting OAuth authorization flow for ${this.baseUrl}`)
    console.log(`📍 Environment: ${isDevelopment ? 'Development' : 'Production'}`)
    console.log(`🎯 Callback URL that will be used: ${redirectUri}`)

    if (isDevelopment) {
      console.log('🔧 Development mode: Using localhost callback for OAuth')
      // Use localhost callback server in development
      const { handleOAuthCallback } = await import('./oauth-callback-server')

      // Start authorization flow
      console.log('🚀 Starting authorization flow...')
      const authRequest = await this.startAuthorizationFlow()
      console.log('✅ Authorization request created:', {
        state: authRequest.state,
        hasCodeVerifier: !!authRequest.codeVerifier,
        authUrlLength: authRequest.authorizationUrl.length
      })

      // Start callback server first
      console.log('🚀 Starting OAuth callback server...')
      const callbackPromise = handleOAuthCallback(300000) // 5 minute timeout

      // Open authorization URL after server is ready
      console.log('🌐 Opening authorization URL in browser...')
      await this.openAuthorizationUrl(authRequest.authorizationUrl)

      // Wait for localhost callback
      console.log('⏳ Waiting for OAuth callback (5 minute timeout)...')
      const callbackResult = await callbackPromise

      console.log('📥 OAuth callback received:', {
        hasCode: !!callbackResult.code,
        hasState: !!callbackResult.state,
        hasError: !!callbackResult.error,
        error: callbackResult.error,
        errorDescription: callbackResult.error_description
      })

      if (callbackResult.error) {
        const errorMsg = `OAuth authorization failed: ${callbackResult.error} - ${callbackResult.error_description || 'Unknown error'}`
        console.error('❌', errorMsg)
        throw new Error(errorMsg)
      }

      if (!callbackResult.code) {
        console.error('❌ No authorization code received in callback')
        throw new Error('No authorization code received')
      }

      if (callbackResult.state !== authRequest.state) {
        console.error('❌ OAuth state mismatch:', {
          expected: authRequest.state,
          received: callbackResult.state
        })
        throw new Error('Invalid OAuth state parameter')
      }

      console.log('✅ OAuth callback validation successful, exchanging code for tokens...')
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForToken({
        code: callbackResult.code,
        codeVerifier: authRequest.codeVerifier,
        state: callbackResult.state,
      })

      console.log('🎉 OAuth flow completed successfully:', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
        tokenType: tokens.token_type
      })

      return tokens
    } else {
      console.log('🚀 Production mode: Using deep link callback for OAuth')
      // Use deep link callback in production
      const { handleOAuthCallback } = await import('./oauth-deeplink-handler')

      // Start authorization flow
      console.log('🚀 Starting authorization flow...')
      const authRequest = await this.startAuthorizationFlow()
      console.log('✅ Authorization request created:', {
        state: authRequest.state,
        hasCodeVerifier: !!authRequest.codeVerifier,
        authUrlLength: authRequest.authorizationUrl.length
      })

      // Start deep link handler first
      console.log('🚀 Starting deep link handler...')
      const callbackPromise = handleOAuthCallback(300000) // 5 minute timeout

      // Open authorization URL after handler is ready
      console.log('🌐 Opening authorization URL in browser...')
      await this.openAuthorizationUrl(authRequest.authorizationUrl)

      // Wait for deep link callback
      console.log('⏳ Waiting for deep link callback (5 minute timeout)...')
      const callbackResult = await callbackPromise

      console.log('📥 Deep link callback received:', {
        hasCode: !!callbackResult.code,
        hasState: !!callbackResult.state,
        hasError: !!callbackResult.error,
        error: callbackResult.error,
        errorDescription: callbackResult.error_description
      })

      if (callbackResult.error) {
        const errorMsg = `OAuth authorization failed: ${callbackResult.error} - ${callbackResult.error_description || 'Unknown error'}`
        console.error('❌', errorMsg)
        throw new Error(errorMsg)
      }

      if (!callbackResult.code) {
        console.error('❌ No authorization code received in deep link')
        throw new Error('No authorization code received')
      }

      if (callbackResult.state !== authRequest.state) {
        console.error('❌ OAuth state mismatch:', {
          expected: authRequest.state,
          received: callbackResult.state
        })
        throw new Error('Invalid OAuth state parameter')
      }

      console.log('✅ Deep link callback validation successful, exchanging code for tokens...')
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForToken({
        code: callbackResult.code,
        codeVerifier: authRequest.codeVerifier,
        state: callbackResult.state,
      })

      console.log('🎉 OAuth flow completed successfully:', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
        tokenType: tokens.token_type
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
}
