import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { MCPServerConfig } from "../../shared/types"
import { OAuthClient } from "../oauth-client"
import { oauthStorage } from "../oauth-storage"
import { diagnosticsService } from "../diagnostics"
import { logTools } from "../debug"

/**
 * OAuthManager - Manages OAuth flows and tokens for MCP servers
 *
 * Responsibilities:
 * - Manage OAuth clients for servers
 * - Handle OAuth flows (initiate, complete)
 * - Token storage and retrieval
 * - OAuth status checking
 * - Token revocation
 */
export class OAuthManager {
  private oauthClients: Map<string, OAuthClient> = new Map()

  /**
   * Get or create OAuth client for a server
   */
  async getOrCreateOAuthClient(serverName: string, serverConfig: MCPServerConfig): Promise<OAuthClient> {
    if (!serverConfig.url || !serverConfig.oauth) {
      throw new Error(`OAuth configuration missing for server ${serverName}`)
    }

    // Check if we already have an OAuth client for this server
    let oauthClient = this.oauthClients.get(serverName)

    if (!oauthClient) {
      // Load stored OAuth config
      const storedConfig = await oauthStorage.load(serverConfig.url)
      const mergedConfig = { ...serverConfig.oauth, ...storedConfig }

      // Create new OAuth client
      oauthClient = new OAuthClient(serverConfig.url, mergedConfig)
      this.oauthClients.set(serverName, oauthClient)
    }

    return oauthClient
  }

  /**
   * Get valid OAuth token for a server
   */
  async getValidToken(serverName: string, serverConfig: MCPServerConfig): Promise<string | null> {
    // First, check if we have valid OAuth tokens
    const hasValidTokens = await oauthStorage.hasValidTokens(serverConfig.url!)

    if (hasValidTokens || serverConfig.oauth) {
      try {
        const oauthClient = await this.getOrCreateOAuthClient(serverName, serverConfig)
        return await oauthClient.getValidToken()
      } catch (error) {
        return null
      }
    }

    return null
  }

  /**
   * Handle 401 Unauthorized response by initiating OAuth flow
   * Implements MCP OAuth specification requirement
   */
  async handle401AndRetryWithOAuth(
    serverName: string,
    serverConfig: MCPServerConfig,
    configStore: any
  ): Promise<StreamableHTTPClientTransport> {
    if (!serverConfig.url) {
      throw new Error("URL is required for OAuth flow")
    }

    logTools(`🔐 Server ${serverName} requires OAuth authentication, initiating flow...`)
    diagnosticsService.logInfo("mcp-service", `Server ${serverName} requires OAuth authentication, initiating flow`)

    // Ensure OAuth configuration exists
    if (!serverConfig.oauth) {
      logTools(`📝 Creating default OAuth configuration for ${serverName}`)
      // Create default OAuth configuration for the server
      serverConfig.oauth = {
        scope: 'user',
        useDiscovery: true,
        useDynamicRegistration: true,
      }

      // Update the server configuration
      const config = configStore.get()
      if (config.mcpConfig?.mcpServers?.[serverName]) {
        config.mcpConfig.mcpServers[serverName] = serverConfig
        configStore.save(config)
        logTools(`✅ OAuth configuration saved for ${serverName}`)
      }
    }

    try {
      // Create OAuth client and complete the full flow
      const oauthClient = await this.getOrCreateOAuthClient(serverName, serverConfig)

      const tokens = await oauthClient.completeAuthorizationFlow()

      // Store the tokens
      await oauthStorage.storeTokens(serverConfig.url, tokens)

      // Create authenticated transport with custom headers
      const customHeaders = serverConfig.headers || {}
      const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
        requestInit: {
          headers: {
            ...customHeaders,
            'Authorization': `Bearer ${tokens.access_token}`,
          },
        },
      })

      logTools(`✅ OAuth authentication completed successfully for ${serverName}`)
      return transport
    } catch (error) {
      const errorMsg = `OAuth authentication failed for server ${serverName}: ${error instanceof Error ? error.message : String(error)}`
      logTools(`❌ ${errorMsg}`)
      diagnosticsService.logError("mcp-service", errorMsg)
      throw new Error(errorMsg)
    }
  }

  /**
   * Initiate OAuth flow for a server
   */
  async initiateOAuthFlow(serverName: string, serverConfig: MCPServerConfig): Promise<{ authorizationUrl: string; state: string }> {
    if (!serverConfig?.oauth || !serverConfig.url) {
      throw new Error(`OAuth not configured for server ${serverName}`)
    }

    const oauthClient = await this.getOrCreateOAuthClient(serverName, serverConfig)

    try {
      const authRequest = await oauthClient.startAuthorizationFlow()

      // Store the code verifier and state for later use
      const currentConfig = oauthClient.getConfig()
      currentConfig.pendingAuth = {
        codeVerifier: authRequest.codeVerifier,
        state: authRequest.state,
      }
      oauthClient.updateConfig(currentConfig)

      // Save updated config
      await oauthStorage.save(serverConfig.url, currentConfig)

      // Open authorization URL in browser
      await oauthClient.openAuthorizationUrl(authRequest.authorizationUrl)

      return {
        authorizationUrl: authRequest.authorizationUrl,
        state: authRequest.state,
      }
    } catch (error) {
      throw new Error(`Failed to initiate OAuth flow for ${serverName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Complete OAuth flow with authorization code
   */
  async completeOAuthFlow(
    serverName: string,
    serverConfig: MCPServerConfig,
    code: string,
    state: string,
    restartServer: (serverName: string) => Promise<{ success: boolean; error?: string }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!serverConfig?.oauth || !serverConfig.url) {
        return {
          success: false,
          error: `OAuth not configured for server ${serverName}`,
        }
      }

      const oauthClient = this.oauthClients.get(serverName)
      if (!oauthClient) {
        return {
          success: false,
          error: `OAuth client not found for server ${serverName}`,
        }
      }

      const currentConfig = oauthClient.getConfig()
      const pendingAuth = (currentConfig as any).pendingAuth

      if (!pendingAuth || pendingAuth.state !== state) {
        return {
          success: false,
          error: 'Invalid or expired OAuth state',
        }
      }

      // Ensure client registration is saved before token exchange
      const clientConfig = oauthClient.getConfig()
      if (clientConfig.clientId) {
        await oauthStorage.save(serverConfig.url, clientConfig)
      }

      // Exchange code for tokens
      const tokens = await oauthClient.exchangeCodeForToken({
        code,
        codeVerifier: pendingAuth.codeVerifier,
        state,
      })

      // Clean up pending auth
      delete (currentConfig as any).pendingAuth
      oauthClient.updateConfig(currentConfig)

      // Save tokens (which also saves the client config)
      await oauthStorage.storeTokens(serverConfig.url, tokens)

      // Try to restart the server with new tokens
      const restartResult = await restartServer(serverName)

      return restartResult
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Check OAuth status for a server
   */
  async getOAuthStatus(serverConfig: MCPServerConfig): Promise<{
    configured: boolean
    authenticated: boolean
    tokenExpiry?: number
    error?: string
  }> {
    try {
      if (!serverConfig?.oauth || !serverConfig.url) {
        return {
          configured: false,
          authenticated: false,
        }
      }

      const hasValidTokens = await oauthStorage.hasValidTokens(serverConfig.url)
      const tokens = await oauthStorage.getTokens(serverConfig.url)

      return {
        configured: true,
        authenticated: hasValidTokens,
        tokenExpiry: tokens?.expires_at,
      }
    } catch (error) {
      return {
        configured: false,
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Revoke OAuth tokens for a server
   */
  async revokeOAuthTokens(
    serverName: string,
    serverConfig: MCPServerConfig,
    stopServer: (serverName: string) => Promise<{ success: boolean; error?: string }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!serverConfig?.url) {
        return {
          success: false,
          error: `Server ${serverName} not found`,
        }
      }

      // Clear stored tokens
      await oauthStorage.clearTokens(serverConfig.url)

      // Remove OAuth client
      this.oauthClients.delete(serverName)

      // Stop the server since it will no longer be able to authenticate
      await stopServer(serverName)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Find server by OAuth state parameter
   */
  async findServerByOAuthState(state: string): Promise<string | null> {
    try {
      // Check all OAuth clients for matching pending auth state
      for (const [serverName, oauthClient] of this.oauthClients.entries()) {
        const config = oauthClient.getConfig()
        const pendingAuth = (config as any).pendingAuth

        if (pendingAuth && pendingAuth.state === state) {
          return serverName
        }
      }

      return null
    } catch (error) {
      logTools('Error finding server by OAuth state:', error)
      return null
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup(): void {
    this.oauthClients.clear()
  }
}
