# [Refactor] Consolidate OAuth implementation

## Problem

OAuth implementation is scattered across **4 files** with ~1,200+ LOC total:
- `oauth-client.ts` (464 LOC) - OAuth client, discovery, PKCE
- `oauth-storage.ts` (430 LOC) - Token persistence
- `oauth-callback-server.ts` (284 LOC) - HTTP callback handler
- Plus OAuth logic embedded in `mcp-service.ts` (~300 LOC)

This leads to:
- Unclear boundaries between files
- Token management logic in multiple places
- Hard to understand the complete OAuth flow
- Difficult to debug authentication issues

## Current State

```
oauth-client.ts:
├── OAuthClient class
├── Discovery endpoint fetching
├── Dynamic client registration
├── PKCE code verifier/challenge
└── Token exchange

oauth-storage.ts:
├── Token persistence (file-based)
├── Client config storage
├── Token expiry checking
└── Token refresh logic (partial)

oauth-callback-server.ts:
├── Fastify HTTP server
├── Callback route handling
├── Code extraction
└── Window communication

mcp-service.ts (OAuth parts):
├── handle401AndRetryWithOAuth()
├── getOrCreateOAuthClient()
├── initiateOAuthFlow()
├── completeOAuthFlow()
└── OAuth status checking
```

## Proposed Solution

Consolidate into a clean OAuth module:

```
apps/desktop/src/main/oauth/
├── index.ts                 # Public API exports
├── OAuthClient.ts           # Core OAuth client (~300 LOC)
│   ├── Discovery
│   ├── Registration
│   ├── PKCE
│   └── Token exchange
├── TokenManager.ts          # Token lifecycle (~200 LOC)
│   ├── Storage (file-based)
│   ├── Refresh logic
│   ├── Expiry checking
│   └── Cache management
├── CallbackServer.ts        # HTTP callback (~150 LOC)
│   ├── Server lifecycle
│   └── Code handling
├── types.ts                 # OAuth types
└── utils.ts                 # Shared utilities
```

### Clean Interface

```typescript
// oauth/index.ts
export class OAuthManager {
  constructor(private tokenManager: TokenManager) {}

  async authenticate(serverUrl: string): Promise<OAuthTokens> {
    const client = new OAuthClient(serverUrl)
    const { authUrl, codeVerifier } = await client.startFlow()
    const code = await this.callbackServer.waitForCode(authUrl)
    const tokens = await client.exchangeCode(code, codeVerifier)
    await this.tokenManager.store(serverUrl, tokens)
    return tokens
  }

  async getValidToken(serverUrl: string): Promise<string> {
    return this.tokenManager.getOrRefresh(serverUrl)
  }
}
```

## Benefits

- **Single Source of Truth**: All OAuth logic in one place
- **Clear Token Lifecycle**: TokenManager owns all token operations
- **Easier Debugging**: Follow the complete flow in one module
- **Testable**: Mock TokenManager for testing
- **Reusable**: OAuth module could be extracted to shared package

## Acceptance Criteria

- [ ] Create `oauth/` directory structure
- [ ] Consolidate OAuthClient
- [ ] Create TokenManager with all token logic
- [ ] Simplify CallbackServer
- [ ] Remove OAuth logic from mcp-service.ts
- [ ] Add comprehensive error handling
- [ ] Add unit tests for each component
- [ ] Document the OAuth flow
- [ ] No file exceeds 300 LOC

## Labels

`refactor`, `tech-debt`, `oauth`, `security`
