# OAuth Setup Guide for SpeakMCP

This guide explains how to configure OAuth 2.1 authentication for MCP servers in SpeakMCP.

## Overview

SpeakMCP supports OAuth 2.1 with PKCE (Proof Key for Code Exchange) for secure authentication with MCP servers. This enables access to protected resources and services that require user authorization.

## Supported Features

- **OAuth 2.1 with PKCE**: Industry-standard security for public clients
- **Dynamic Client Registration (RFC7591)**: Automatic client registration with compatible servers
- **Authorization Server Metadata Discovery (RFC8414)**: Automatic endpoint discovery
- **Secure Token Storage**: Encrypted token storage using Electron's safeStorage API
- **Automatic Token Refresh**: Background token refresh to maintain connectivity
- **Streamable HTTP Transport**: Optimized for production deployments

## Quick Start

### 1. Add an OAuth-Enabled MCP Server

1. Open SpeakMCP and navigate to **Settings > MCP Configuration**
2. Click **Add Server** or choose from **OAuth Examples**
3. Configure the server:
   - **Server Name**: A unique identifier for your server
   - **Transport**: Select "streamableHttp"
   - **URL**: Your MCP server's base URL
   - **Enable OAuth Authentication**: Toggle this on

### 2. Configure OAuth Settings

- **Scope**: Specify the OAuth scopes required (e.g., "user", "read", "write")
- **Use server metadata discovery**: Enable automatic endpoint discovery
- **Use dynamic client registration**: Enable automatic client registration
- **Client ID**: (Optional) Manually specify if not using dynamic registration

### 3. Set Up Redirect URI

When configuring your OAuth application (GitHub, Google, etc.), use this redirect URI:
```
speakmcp://oauth/callback
```

This is a custom URL scheme that allows SpeakMCP to receive OAuth callbacks directly as a native app, providing a better user experience than localhost redirects.

### 4. Authenticate

1. Click **Start Authentication**
2. Your browser will open to the authorization server
3. Complete the login and authorization process
4. The browser will redirect back to SpeakMCP automatically
5. Authentication should complete seamlessly

## Server Configuration Examples

### Naptha OAuth Proxy

```json
{
  "transport": "streamableHttp",
  "url": "https://your-oauth-proxy.naptha.ai",
  "oauth": {
    "scope": "user",
    "useDiscovery": true,
    "useDynamicRegistration": true
  }
}
```

### GitHub OAuth

```json
{
  "transport": "streamableHttp",
  "url": "https://github-mcp-server.example.com",
  "oauth": {
    "scope": "repo read:user",
    "useDiscovery": false,
    "useDynamicRegistration": false,
    "clientId": "your-github-client-id",
    "serverMetadata": {
      "issuer": "https://github.com",
      "authorization_endpoint": "https://github.com/login/oauth/authorize",
      "token_endpoint": "https://github.com/login/oauth/access_token"
    }
  }
}
```

**Setup Instructions:**
1. Create a GitHub OAuth App in your repository settings
2. Set the redirect URI to: `speakmcp://oauth/callback`
3. Copy the Client ID to your SpeakMCP configuration

### Google OAuth

```json
{
  "transport": "streamableHttp",
  "url": "https://google-mcp-server.example.com",
  "oauth": {
    "scope": "openid profile email",
    "useDiscovery": true,
    "useDynamicRegistration": false,
    "clientId": "your-google-client-id",
    "serverMetadata": {
      "issuer": "https://accounts.google.com",
      "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
      "token_endpoint": "https://oauth2.googleapis.com/token"
    }
  }
}
```

## Manual Configuration

### Server Metadata

If your server doesn't support metadata discovery, configure endpoints manually:

```json
{
  "oauth": {
    "useDiscovery": false,
    "serverMetadata": {
      "issuer": "https://your-auth-server.com",
      "authorization_endpoint": "https://your-auth-server.com/authorize",
      "token_endpoint": "https://your-auth-server.com/token",
      "registration_endpoint": "https://your-auth-server.com/register"
    }
  }
}
```

### Client Registration

If your server doesn't support dynamic registration, register manually:

```json
{
  "oauth": {
    "useDynamicRegistration": false,
    "clientId": "your-pre-registered-client-id",
    "clientSecret": "your-client-secret-if-required"
  }
}
```

## Implementing OAuth in Your MCP Server

### Requirements

Your MCP server must implement:

1. **OAuth 2.1 Authorization Server** with PKCE support
2. **Authorization endpoint** for user consent
3. **Token endpoint** for code exchange and refresh
4. **Protected MCP endpoints** that validate Bearer tokens

### Recommended Endpoints

- `/.well-known/oauth-authorization-server` - Server metadata (RFC8414)
- `/authorize` - Authorization endpoint
- `/token` - Token endpoint
- `/register` - Dynamic client registration (RFC7591, optional)

### Example Server Metadata

```json
{
  "issuer": "https://your-mcp-server.com",
  "authorization_endpoint": "https://your-mcp-server.com/authorize",
  "token_endpoint": "https://your-mcp-server.com/token",
  "registration_endpoint": "https://your-mcp-server.com/register",
  "scopes_supported": ["mcp:read", "mcp:write", "user"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
  "code_challenge_methods_supported": ["S256"]
}
```

### MCP Request Authentication

Include the access token in MCP requests:

```http
POST /mcp/endpoint
Authorization: Bearer <access_token>
Content-Type: application/json
MCP-Protocol-Version: 2025-03-26

{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

## Troubleshooting

### Common Issues

**Authentication fails with "Invalid client"**
- Verify your client ID is correct
- Check if dynamic registration is properly configured
- Ensure redirect URI matches exactly

**Token refresh fails**
- Check if your server supports refresh tokens
- Verify the refresh token hasn't expired
- Ensure proper token endpoint configuration

**Connection fails after authentication**
- Verify the MCP server URL is correct
- Check if the server properly validates Bearer tokens
- Ensure the access token has required scopes

### Debug Information

Check the OAuth status in SpeakMCP:
1. Go to **Settings > MCP Configuration**
2. Find your OAuth-enabled server
3. Check the authentication status and token expiry
4. Use **Test Connection** to verify functionality

### Logs

Enable debug logging by setting the environment variable:
```bash
DEBUG=oauth:* npm start
```

## Security Considerations

- **PKCE is mandatory** for all OAuth flows
- **Tokens are encrypted** using Electron's safeStorage API
- **Automatic token refresh** minimizes exposure time
- **Native deep link redirect** uses custom URL scheme (speakmcp://)
- **State parameter validation** prevents CSRF attacks

## Support

For additional help:
- Check the [MCP OAuth specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- Review [OAuth 2.1 RFC](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- See [PKCE RFC](https://datatracker.ietf.org/doc/html/rfc7636)
- Visit the [SpeakMCP GitHub repository](https://github.com/aj47/SpeakMCP)
