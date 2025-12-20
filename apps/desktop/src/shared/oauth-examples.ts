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
  notion: {
    name: "Notion",
    description: "Connect to Notion workspace with OAuth authentication",
    config: {
      transport: "streamableHttp",
      url: "https://api.notion.com/mcp",
      oauth: {
        scope: "read write",
        useDiscovery: true,
        useDynamicRegistration: true,
      },
    },
    setupInstructions: [
      "Go to https://www.notion.so/my-integrations to create a new integration",
      "Copy the OAuth client ID and secret to your OAuth configuration",
      "Add your redirect URI to the integration settings",
      "Grant the integration access to your Notion workspace",
    ],
    requiredScopes: ["read", "write"],
    documentationUrl: "https://developers.notion.com/docs/authorization",
  },
}

export function getOAuthExample(key: string): OAuthMCPExample | undefined {
  return OAUTH_MCP_EXAMPLES[key]
}

export function getOAuthExampleKeys(): string[] {
  return Object.keys(OAUTH_MCP_EXAMPLES)
}
