# Cloudflare 524 Gateway Timeout Fix

## Problem Summary

When the agent mode encountered a Cloudflare 524 Gateway Timeout error, it would fail immediately instead of retrying gracefully, breaking the agent workflow.

## Root Cause

The issue was in the structured output error detection logic in `src/main/llm-fetch.ts`:

### Bug 1: Overly Broad Structured Output Error Detection

```typescript
// BEFORE (lines 485-494)
const isStructuredOutputError = errorText.includes("json_schema") ||
                               errorText.includes("response_format") ||
                               errorText.includes("schema") ||
                               errorText.includes("json")  // ⚠️ TOO BROAD!
```

**Problem**: Cloudflare's 524 error pages often contain HTML with the word "json" in them (e.g., in error messages, scripts, or metadata). This caused:

1. The 524 error to be treated as a "structured output error" instead of an `HttpError`
2. It was thrown as a plain `Error` instead of `HttpError`
3. The retry logic's `isRetryableError()` function couldn't recognize it as retryable
4. The error was not retried, breaking the agent

### Bug 2: Missing Keywords in Retry Detection

The `isRetryableError()` function checked for keywords like "network", "timeout", "connection", but didn't check for "cloudflare" or "gateway", which are common in these error messages.

## Solution

### Fix 1: Restrict Structured Output Error Detection to 4xx Errors

```typescript
// AFTER (lines 485-494)
const isStructuredOutputError = response.status >= 400 && response.status < 500 &&
                               (errorText.includes("json_schema") ||
                                errorText.includes("response_format") ||
                                errorText.includes("schema") ||
                                errorText.includes("json"))
```

**Rationale**: 
- Structured output errors are always 4xx client errors (bad request format)
- Server errors (5xx) should ALWAYS be treated as retryable HTTP errors
- This ensures 524 and other 5xx errors are properly wrapped in `HttpError` class

### Fix 2: Add Cloudflare/Gateway Keywords to Retry Detection

```typescript
// Added to isRetryableError() (lines 227-242)
return message.includes('network') ||
       message.includes('timeout') ||
       message.includes('connection') ||
       message.includes('fetch') ||
       message.includes('empty response') ||
       message.includes('empty content') ||
       message.includes('cloudflare') ||     // NEW
       message.includes('gateway')           // NEW
```

### Fix 3: Enhanced Logging

Added detailed logging to help debug retry issues:

1. **Non-retryable errors**: Log error type, status code, and stack trace
2. **Retryable errors**: Log as warnings with retry attempt info
3. **Console output**: User-friendly messages showing retry progress

```typescript
// Example console output
⏳ HTTP 524 error - retrying in 2 seconds... (attempt 1/4)
⏳ HTTP 524 error - retrying in 4 seconds... (attempt 2/4)
✓ Request succeeded after 2 retries
```

## Testing

Created comprehensive unit tests in `src/main/llm-fetch.test.ts`:

1. ✅ 524 Gateway Timeout is retried and eventually succeeds
2. ✅ 524 error with "json" keyword is NOT treated as structured output error
3. ✅ 400 error with "json_schema" keyword IS treated as structured output error
4. ✅ 502 Bad Gateway is retried
5. ✅ 503 Service Unavailable is retried

All tests pass with proper retry behavior.

## Impact

### Before Fix
- Cloudflare 524 errors → Immediate failure
- Agent mode breaks
- User sees "Provider returned error"
- No retry attempts

### After Fix
- Cloudflare 524 errors → Automatic retry with exponential backoff
- Agent mode continues gracefully
- User sees retry progress in console
- Up to 3 retry attempts (configurable via `apiRetryCount`)
- Typical retry delays: 1s, 2s, 4s (with jitter)

## Configuration

Users can configure retry behavior in Settings:

- `apiRetryCount`: Number of retry attempts (default: 3)
- `apiRetryBaseDelay`: Base delay in milliseconds (default: 1000)
- `apiRetryMaxDelay`: Maximum delay in milliseconds (default: 30000)

## Related Files

- `src/main/llm-fetch.ts`: Main fix implementation
- `src/main/llm-fetch.test.ts`: Unit tests
- `src/main/config.ts`: Retry configuration defaults
- `src/shared/types.ts`: Config type definitions

## Future Improvements

1. Add exponential backoff visualization in UI
2. Allow users to configure retry behavior per provider
3. Add metrics/telemetry for retry success rates
4. Consider implementing circuit breaker pattern for persistent failures

