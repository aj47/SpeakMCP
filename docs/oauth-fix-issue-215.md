# OAuth Fix for Issue #215

## Problem Description

MCP OAuth functionality was not working properly in build 0.2.2. The issue was caused by a fundamental flaw in how the OAuth flow was initiated and completed.

## Root Cause

The OAuth flow had a critical state mismatch issue:

1. **When manually initiating OAuth from the UI** (`initiateOAuthFlow()`):
   - Generated authorization URL and PKCE parameters
   - Saved the state and code verifier
   - Opened the browser
   - **BUT** returned immediately without waiting for the callback
   - The user had to manually complete the flow, but there was no active listener

2. **When auto-retrying with OAuth** (401 error, `handle401AndRetryWithOAuth()`):
   - Called `completeAuthorizationFlow()` which started a **NEW** OAuth flow
   - Generated **NEW** state and code verifier
   - This invalidated any pending OAuth flow from the UI
   - Created a race condition and state mismatch

## The Fix

### 1. Fixed `initiateOAuthFlow()` Method

The method now properly:
- Starts the authorization flow and generates auth URL
- Saves the pending auth state (code verifier and state)
- Starts the appropriate callback handler (localhost in dev, deep link in production)
- Opens the browser
- **Waits for the callback in the background** and automatically completes the flow
- Returns immediately to the UI so it doesn't block

### 2. Enhanced Logging

Added comprehensive logging throughout the OAuth flow:
- Server metadata discovery
- Client registration
- Authorization URL generation
- Token exchange
- State validation
- Error details

This makes it much easier to diagnose OAuth issues.

### 3. Better Error Handling

- More descriptive error messages
- Proper error propagation
- Console logging for debugging
- Diagnostic service integration

## Changes Made

### `src/main/mcp-service.ts`

1. **`initiateOAuthFlow()` method** (lines 1424-1540):
   - Now starts callback handler (localhost or deep link based on environment)
   - Waits for callback in background
   - Automatically calls `completeOAuthFlow()` when callback is received
   - Added comprehensive logging

2. **`completeOAuthFlow()` method** (lines 1542-1640):
   - Added detailed logging for each step
   - Better error messages with context
   - State validation logging

### `src/main/oauth-client.ts`

1. **`discoverServerMetadata()` method** (lines 39-93):
   - Added logging for metadata discovery
   - Better fallback handling

2. **`registerClient()` method** (lines 95-176):
   - Added logging for client registration
   - Better error messages with response text

3. **`exchangeCodeForToken()` method** (lines 222-304):
   - Added detailed logging for token exchange
   - Logs request parameters (sanitized)
   - Logs token response details

## Testing

To test the OAuth flow:

1. **Development Mode**:
   ```bash
   pnpm dev
   ```
   - OAuth will use `http://localhost:3000/callback`
   - Check console for detailed logs

2. **Production Build**:
   ```bash
   pnpm build
   ```
   - OAuth will use `speakmcp://oauth/callback` deep link
   - Ensure the protocol is registered on the system

## Expected Behavior

1. User clicks "Authenticate" button in UI
2. Browser opens with OAuth authorization URL
3. User completes authorization on the OAuth provider
4. Browser redirects to callback URL (localhost or deep link)
5. SpeakMCP receives the callback automatically
6. Tokens are exchanged and saved
7. Server restarts with new tokens
8. User sees success message

## Debugging

If OAuth still doesn't work, check the console logs for:
- `🔐 Initiating OAuth flow for...` - Flow started
- `🔍 Discovering OAuth server metadata...` - Metadata discovery
- `🔄 Registering OAuth client...` - Client registration
- `🌐 OAuth authorization URL opened...` - Browser opened
- `⏳ Waiting for OAuth callback...` - Waiting for user
- `🔄 Completing OAuth flow for...` - Callback received
- `✓ OAuth state validated...` - State matches
- `🔄 Exchanging authorization code...` - Token exchange
- `✅ OAuth flow completed successfully...` - Success!

Any `❌` or `⚠️` messages indicate errors or warnings.

## Related Files

- `src/main/mcp-service.ts` - Main OAuth flow orchestration
- `src/main/oauth-client.ts` - OAuth 2.1 client implementation
- `src/main/oauth-callback-server.ts` - Localhost callback server (dev)
- `src/main/oauth-deeplink-handler.ts` - Deep link handler (production)
- `src/main/oauth-storage.ts` - Secure token storage

## Future Improvements

1. Add OAuth flow timeout handling in UI
2. Add retry mechanism for failed token exchanges
3. Add OAuth flow cancellation
4. Add better user feedback during OAuth flow
5. Add OAuth troubleshooting guide in UI

