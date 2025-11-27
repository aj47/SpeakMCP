# OAuth Deep Link Testing Results

## Issue #249: CloudFlare Remote MCP Deep Link Callbacks Not Working

### Problem Identified

The OAuth deep link callbacks for CloudFlare Remote MCP servers were failing due to how Node.js `URL` class parses custom protocol URLs.

**Root Cause:**
When parsing a URL like `speakmcp://oauth/callback?code=xxx&state=yyy`, the Node.js `URL` class treats:
- `speakmcp:` as the protocol
- `oauth` as the **host/authority** (not part of the pathname!)
- `/callback` as the pathname

This caused the original code to fail matching `/oauth/callback` because it was only checking `pathname` which was `/callback`.

### Solution Implemented

Updated `src/main/oauth-deeplink-handler.ts` to:
1. Combine `host` and `pathname` to get the full path
2. Normalize the combined path by removing extra leading slashes
3. Handle both URL formats (with and without authority)

**Code Change:**
```typescript
// Before (incorrect):
const pathname = parsedUrl.pathname.replace(/^\/+/, '/')
const isOAuthPath = pathname === '/oauth/callback'

// After (correct):
let fullPath = parsedUrl.pathname
if (parsedUrl.host) {
  fullPath = `/${parsedUrl.host}${parsedUrl.pathname}`
}
const pathname = fullPath.replace(/^\/+/, '/')
const isOAuthPath = pathname === '/oauth/callback'
```

### Test Results

Created `tests/test-oauth-deeplink.js` to verify URL parsing behavior:

| URL Format | Protocol | Host | Pathname | Full Path | Matches? |
|------------|----------|------|----------|-----------|----------|
| `speakmcp://oauth/callback?code=test123` | `speakmcp:` | `oauth` | `/callback` | `/oauth/callback` | ✅ YES |
| `speakmcp:/oauth/callback?code=test456` | `speakmcp:` | (empty) | `/oauth/callback` | `/oauth/callback` | ✅ YES |
| `speakmcp:///oauth/callback?code=test789` | `speakmcp:` | (empty) | `/oauth/callback` | `/oauth/callback` | ✅ YES |

All test cases now correctly match the expected OAuth callback path.

### Unit Tests

All existing unit tests pass:
```
✓ src/main/llm-fetch.test.ts (5)
✓ src/main/tts-preprocessing.test.ts (9)
✓ src/shared/shell-parse.test.ts (10)

Test Files  3 passed (3)
Tests  24 passed (24)
```

### Manual Testing

1. Started app with CDP debugging: `pnpm dev dui --remote-debugging-port=9222`
2. App successfully loaded with updated OAuth deep link handler
3. Hot reload confirmed the fix was applied correctly

### Commits

1. `678cacf` - Initial fix: normalize pathname in OAuth deep link handler
2. `0bc792d` - Improved fix: properly handle host+pathname in OAuth deep link URLs

### PR Status

- **PR #290**: https://github.com/aj47/SpeakMCP/pull/290
- **Status**: Open
- **Branch**: `fix/249-cloudflare-deeplink-callbacks`
- **Base**: `main`

### Next Steps

1. ✅ Fix implemented and tested
2. ✅ All unit tests passing
3. ✅ Changes committed and pushed
4. ✅ PR created
5. ⏳ Awaiting CI checks
6. ⏳ Awaiting code review
7. ⏳ Merge to main

### Technical Notes

**Why This Matters:**
- CloudFlare Remote MCP servers use OAuth 2.1 with PKCE for authentication
- The OAuth flow redirects back to `speakmcp://oauth/callback` after authorization
- Without this fix, the callback would not be recognized, breaking the OAuth flow
- This affects any remote MCP server that requires OAuth authentication

**URL Parsing Quirks:**
- Custom protocols with `://` parse the first segment as the host
- Custom protocols with `:/` (single slash) parse the entire path as pathname
- This is standard URL parsing behavior, not a bug
- The fix handles both formats correctly

---

**Test Date**: November 22, 2025  
**Tested By**: Augment Agent  
**Status**: ✅ All Tests Passing

