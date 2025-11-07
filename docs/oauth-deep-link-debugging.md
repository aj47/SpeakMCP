# OAuth Deep Link Debugging Guide

## Issue
After clicking the OAuth deep link from Chrome, the authentication doesn't complete.

## Debugging Steps Added

### 1. Enhanced Deep Link Handler Logging

Added comprehensive logging to `src/main/oauth-deeplink-handler.ts`:

#### Deep Link Reception
- `🔗 Deep link received: [url]` - When any deep link is received
- `✓ OAuth callback deep link detected` - When it's an OAuth callback
- `ℹ️ Deep link is not an OAuth callback` - When it's a different deep link

#### Callback Details
- Shows code (first 10 chars)
- Shows state (first 10 chars)
- Shows error if present

#### Listener Status
- `✓ Active callback listener found, resolving...` - When there's a waiting promise
- `⚠️ No active callback listener, attempting automatic completion...` - When no listener

#### Automatic Completion
- `🔄 Attempting automatic OAuth completion...` - Starting automatic flow
- `✓ OAuth callback has code and state, finding server...` - Valid callback
- `✓ Found server: [name], completing OAuth flow...` - Server found
- `✅ Automatic OAuth completion successful` - Success

### 2. Enhanced Listener Setup Logging

#### Wait for Callback
- `⏳ Deep link handler waiting for OAuth callback (timeout: Xms)` - Starting wait
- `✓ Deep link handler listening for callbacks` - Listener active
- `❌ OAuth callback timeout after Xms` - Timeout occurred

#### Start Listening
- `🎧 Starting deep link listener (platform: [os])` - Starting listener
- `✓ Registered 'open-url' event listener` - macOS event registered
- `✓ Registered macOS 'will-finish-launching' listener` - macOS launch listener
- `🔍 Checking command line args for deep links` - Windows/Linux check
- `✓ Found deep link in command line args` - Deep link in args
- `✓ Registered 'second-instance' event listener` - Windows/Linux listener

### 3. Enhanced Protocol Registration Logging

#### Initialization
- `🔧 Initializing deep link handling...` - Starting initialization
- Shows NODE_ENV, ELECTRON_RENDERER_URL, and platform
- `Is default protocol client: [true/false]` - Current registration status
- `Set as default protocol client: [true/false]` - Registration result
- `Already registered as default protocol client` - Already registered
- `ℹ️ Skipping protocol registration in development mode` - Dev mode skip

## Common Issues and Solutions

### Issue 1: Deep Link Not Received
**Symptoms:**
- No `🔗 Deep link received` log after clicking link in browser

**Possible Causes:**
1. Protocol not registered (check initialization logs)
2. App not set as default protocol handler
3. Browser blocking the protocol

**Solutions:**
1. Check if `speakmcp://` protocol is registered:
   - Look for `Set as default protocol client: true` in logs
2. Manually register protocol (OS-specific)
3. Try different browser

### Issue 2: Deep Link Received But Not Parsed
**Symptoms:**
- `🔗 Deep link received` but no `✓ OAuth callback deep link detected`

**Possible Causes:**
1. URL format doesn't match expected pattern
2. Protocol or pathname mismatch

**Solutions:**
1. Check the received URL in logs
2. Verify it matches `speakmcp://oauth/callback?code=...&state=...`
3. Check for URL encoding issues

### Issue 3: No Active Listener
**Symptoms:**
- `⚠️ No active callback listener, attempting automatic completion...`

**Possible Causes:**
1. OAuth flow not initiated properly
2. Listener cleaned up prematurely
3. Timeout occurred before callback

**Solutions:**
1. Check if `⏳ Deep link handler waiting for OAuth callback` appears before the link is clicked
2. Verify timeout is sufficient (default: 5 minutes)
3. Check for errors in `initiateOAuthFlow`

### Issue 4: Automatic Completion Fails
**Symptoms:**
- `❌ No server found with matching OAuth state`

**Possible Causes:**
1. State parameter doesn't match any pending auth
2. Pending auth was cleaned up
3. State parameter corrupted

**Solutions:**
1. Check state parameter in logs
2. Verify `findServerByOAuthState` is working
3. Check if pending auth was saved properly

## Testing Checklist

### Development Mode
- [ ] Check logs show `ℹ️ Skipping protocol registration in development mode`
- [ ] OAuth uses `http://localhost:3000/callback`
- [ ] Localhost callback server starts
- [ ] Callback is received on localhost

### Production Build
- [ ] Check logs show protocol registration success
- [ ] OAuth uses `speakmcp://oauth/callback`
- [ ] Deep link handler starts listening
- [ ] Deep link is received when clicked
- [ ] Callback is parsed correctly
- [ ] Active listener resolves the promise
- [ ] OAuth flow completes successfully

## Log Sequence for Successful OAuth Flow

```
🔐 Initiating OAuth flow for [server]...
🔍 Discovering OAuth server metadata...
✓ OAuth server metadata discovered successfully
🔄 Registering OAuth client with redirect URI: speakmcp://oauth/callback
✓ OAuth client registered successfully: [client_id]
⏳ Deep link handler waiting for OAuth callback (timeout: 300000ms)
🎧 Starting deep link listener (platform: darwin)
✓ Registered 'open-url' event listener
✓ Deep link handler listening for callbacks
🌐 OAuth authorization URL opened in browser for [server]
⏳ Waiting for OAuth deep link callback...

[User completes authorization in browser]

🔗 Deep link received: speakmcp://oauth/callback?code=...&state=...
✓ OAuth callback deep link detected
   - Code: abc123...
   - State: xyz789...
   - Error: none
✓ Active callback listener found, resolving...
🔄 Completing OAuth flow for [server]...
✓ OAuth state validated for [server]
✓ OAuth client config saved for [server]
🔄 Exchanging authorization code for tokens for [server]...
✓ Access token received successfully
✓ OAuth tokens saved for [server]
🔄 Restarting server [server] with new OAuth tokens...
✅ OAuth flow completed successfully for [server]
```

## Next Steps

If the issue persists after adding these logs:
1. Run the app and initiate OAuth flow
2. Copy all console logs
3. Look for the specific error indicators (❌)
4. Match the issue to one of the common issues above
5. Apply the suggested solution

