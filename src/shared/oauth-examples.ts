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
  "oauth-server": {
    name: "OAuth MCP Server",
    description: "Example OAuth-protected MCP server configuration",
    config: {
      transport: "streamableHttp",
      url: "https://your-mcp-server.com",
      oauth: {
        scope: "user",
        useDiscovery: true,
        useDynamicRegistration: true,
      },
    },
    setupInstructions: [
      "Replace with your actual MCP server URL",
      "Configure OAuth settings as needed by your server",
    ],
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
