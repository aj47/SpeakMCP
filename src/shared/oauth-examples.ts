/**
 * OAuth MCP Server Examples
 * 
 * Pre-configured examples for popular OAuth-enabled MCP servers
 * to help users get started quickly with OAuth authentication.
 */

import { MCPServerConfig } from "./types"

export interface OAuthMCPExample {
  name: string
  description: string
  config: MCPServerConfig
  setupInstructions: string[]
  requiredScopes?: string[]
  documentationUrl?: string
}

export const OAUTH_MCP_EXAMPLES: Record<string, OAuthMCPExample> = {
  "naptha-oauth-proxy": {
    name: "Naptha OAuth Proxy",
    description: "OAuth proxy server for accessing protected MCP servers with Auth0 authentication",
    config: {
      transport: "streamableHttp",
      url: "https://your-oauth-proxy.naptha.ai",
      oauth: {
        scope: "user",
        useDiscovery: true,
        useDynamicRegistration: true,
      },
    },
    setupInstructions: [
      "Deploy the Naptha OAuth proxy server",
      "Configure Auth0 application with appropriate scopes",
      "Update the URL to point to your deployed proxy",
      "Ensure the proxy is configured to forward to your target MCP server",
    ],
    requiredScopes: ["user"],
    documentationUrl: "https://github.com/NapthaAI/http-oauth-mcp-server",
  },

  "custom-oauth-server": {
    name: "Custom OAuth MCP Server",
    description: "Template for a custom OAuth-protected MCP server",
    config: {
      transport: "streamableHttp",
      url: "https://your-mcp-server.com",
      oauth: {
        scope: "mcp:read mcp:write",
        useDiscovery: true,
        useDynamicRegistration: true,
      },
    },
    setupInstructions: [
      "Implement OAuth 2.1 with PKCE in your MCP server",
      "Add authorization server metadata endpoint (.well-known/oauth-authorization-server)",
      "Implement dynamic client registration (RFC7591) if desired",
      "Configure appropriate scopes for MCP operations",
      "Update the URL to point to your server",
    ],
    requiredScopes: ["mcp:read", "mcp:write"],
  },

  "github-oauth-mcp": {
    name: "GitHub OAuth MCP Server",
    description: "MCP server with GitHub OAuth for repository access",
    config: {
      transport: "streamableHttp",
      url: "https://github-mcp-server.example.com",
      oauth: {
        scope: "repo read:user",
        useDiscovery: false,
        useDynamicRegistration: false,
        serverMetadata: {
          issuer: "https://github.com",
          authorization_endpoint: "https://github.com/login/oauth/authorize",
          token_endpoint: "https://github.com/login/oauth/access_token",
        },
      },
    },
    setupInstructions: [
      "Create a GitHub OAuth App in your GitHub settings",
      "Configure the redirect URI to speakmcp://oauth/callback",
      "Deploy an MCP server that uses GitHub's OAuth for authentication",
      "Update the URL to point to your deployed server",
      "Manually configure the client ID in the OAuth settings",
    ],
    requiredScopes: ["repo", "read:user"],
    documentationUrl: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps",
  },

  "google-oauth-mcp": {
    name: "Google OAuth MCP Server",
    description: "MCP server with Google OAuth for Google services access",
    config: {
      transport: "streamableHttp",
      url: "https://google-mcp-server.example.com",
      oauth: {
        scope: "openid profile email",
        useDiscovery: true,
        useDynamicRegistration: false,
        serverMetadata: {
          issuer: "https://accounts.google.com",
          authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
        },
      },
    },
    setupInstructions: [
      "Create a Google Cloud Project and enable OAuth 2.0",
      "Configure OAuth consent screen and add required scopes",
      "Create OAuth 2.0 credentials with redirect URI speakmcp://oauth/callback",
      "Deploy an MCP server that uses Google OAuth for authentication",
      "Update the URL to point to your deployed server",
      "Configure the client ID in the OAuth settings",
    ],
    requiredScopes: ["openid", "profile", "email"],
    documentationUrl: "https://developers.google.com/identity/protocols/oauth2",
  },

  "microsoft-oauth-mcp": {
    name: "Microsoft OAuth MCP Server",
    description: "MCP server with Microsoft OAuth for Microsoft 365 access",
    config: {
      transport: "streamableHttp",
      url: "https://microsoft-mcp-server.example.com",
      oauth: {
        scope: "openid profile email User.Read",
        useDiscovery: true,
        useDynamicRegistration: false,
        serverMetadata: {
          issuer: "https://login.microsoftonline.com/common/v2.0",
          authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
          token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        },
      },
    },
    setupInstructions: [
      "Register an application in Azure Active Directory",
      "Configure redirect URI to speakmcp://oauth/callback",
      "Add required API permissions and scopes",
      "Deploy an MCP server that uses Microsoft OAuth for authentication",
      "Update the URL to point to your deployed server",
      "Configure the client ID in the OAuth settings",
    ],
    requiredScopes: ["openid", "profile", "email", "User.Read"],
    documentationUrl: "https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow",
  },

  "auth0-oauth-mcp": {
    name: "Auth0 OAuth MCP Server",
    description: "MCP server with Auth0 OAuth for universal authentication",
    config: {
      transport: "streamableHttp",
      url: "https://auth0-mcp-server.example.com",
      oauth: {
        scope: "openid profile email",
        useDiscovery: true,
        useDynamicRegistration: true,
      },
    },
    setupInstructions: [
      "Create an Auth0 application in your Auth0 dashboard",
      "Configure the application as a Single Page Application",
      "Add speakmcp://oauth/callback to allowed callback URLs",
      "Deploy an MCP server that uses Auth0 for authentication",
      "Update the URL to point to your deployed server",
      "The server should auto-discover Auth0 metadata and register dynamically",
    ],
    requiredScopes: ["openid", "profile", "email"],
    documentationUrl: "https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-proof-key-for-code-exchange-pkce",
  },

  "keycloak-oauth-mcp": {
    name: "Keycloak OAuth MCP Server",
    description: "MCP server with Keycloak OAuth for enterprise authentication",
    config: {
      transport: "streamableHttp",
      url: "https://keycloak-mcp-server.example.com",
      oauth: {
        scope: "openid profile email",
        useDiscovery: true,
        useDynamicRegistration: false,
      },
    },
    setupInstructions: [
      "Set up a Keycloak realm and client",
      "Configure the client as a public client with PKCE",
      "Add speakmcp://oauth/callback to valid redirect URIs",
      "Deploy an MCP server that uses Keycloak for authentication",
      "Update the URL to point to your deployed server",
      "Configure the client ID in the OAuth settings",
    ],
    requiredScopes: ["openid", "profile", "email"],
    documentationUrl: "https://www.keycloak.org/docs/latest/securing_apps/index.html#_javascript_adapter",
  },
}

/**
 * Get OAuth example by key
 */
export function getOAuthExample(key: string): OAuthMCPExample | undefined {
  return OAUTH_MCP_EXAMPLES[key]
}

/**
 * Get all OAuth example keys
 */
export function getOAuthExampleKeys(): string[] {
  return Object.keys(OAUTH_MCP_EXAMPLES)
}

/**
 * Search OAuth examples by name or description
 */
export function searchOAuthExamples(query: string): Array<{ key: string; example: OAuthMCPExample }> {
  const lowerQuery = query.toLowerCase()
  return Object.entries(OAUTH_MCP_EXAMPLES)
    .filter(([_, example]) => 
      example.name.toLowerCase().includes(lowerQuery) ||
      example.description.toLowerCase().includes(lowerQuery)
    )
    .map(([key, example]) => ({ key, example }))
}

/**
 * Validate OAuth configuration
 */
export function validateOAuthConfig(config: MCPServerConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (config.transport !== "streamableHttp") {
    errors.push("OAuth is only supported with streamableHttp transport")
  }

  if (!config.url) {
    errors.push("Server URL is required for OAuth configuration")
  }

  if (!config.oauth) {
    errors.push("OAuth configuration is missing")
    return { valid: false, errors }
  }

  if (!config.oauth.scope) {
    errors.push("OAuth scope is required")
  }

  if (config.oauth.useDiscovery === false && !config.oauth.serverMetadata) {
    errors.push("Server metadata is required when discovery is disabled")
  }

  if (config.oauth.serverMetadata) {
    if (!config.oauth.serverMetadata.authorization_endpoint) {
      errors.push("Authorization endpoint is required in server metadata")
    }
    if (!config.oauth.serverMetadata.token_endpoint) {
      errors.push("Token endpoint is required in server metadata")
    }
  }

  return { valid: errors.length === 0, errors }
}
