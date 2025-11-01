# Enhanced LLM Debugging Guide

## Overview
Enhanced debugging has been added to help diagnose issues with LLM models, particularly when using `google/gemini-2.5-flash` or other models that may have issues with structured output (JSON schema).

## How to Enable Debug Logging

Debug logging is controlled by environment variables. To enable LLM debugging:

```bash
# Enable LLM debugging only
DEBUG_LLM=1 npm run dev

# Enable all debugging
DEBUG=* npm run dev
```

## What's Been Added

### 1. Structured Output Error Detection
When a model fails to support JSON schema or structured output, you'll now see:
```
⚠️ STRUCTURED OUTPUT ERROR DETECTED {
  model: 'google/gemini-2.5-flash',
  errorMessage: '...',
  responseFormat: { type: 'json_schema', ... },
  fullError: { ... }
}
```

### 2. Response Structure Logging
Every LLM response now logs its structure:
```
Raw API response structure: {
  hasChoices: true,
  choicesLength: 1,
  firstChoiceExists: true,
  hasMessage: true,
  hasContent: true,
  fullResponse: "..." // First 1000 chars
}
```

### 3. Content Extraction Details
See exactly what content was extracted:
```
📝 Message content extracted: {
  contentLength: 150,
  contentPreview: "...",
  messageObjKeys: ['role', 'content'],
  messageObj: { ... }
}
```

### 4. JSON Extraction Results
When parsing JSON from the response:
```
🔍 JSON Extraction Result: {
  hasJsonObject: true,
  jsonObjectKeys: ['content', 'toolCalls', 'needsMoreWork'],
  hasToolCalls: true,
  hasContent: true,
  toolCallsCount: 2,
  extractedObject: { ... }
}
```

### 5. Fallback Mode Tracking
See when the system falls back from JSON Schema → JSON Object → Plain Text:
```
⚠️ JSON Schema mode FAILED for model google/gemini-2.5-flash - falling back to JSON Object mode
Error details: {
  message: "...",
  stack: "..."
}
```

### 6. Empty Response Detection
When responses are empty or invalid:
```
⚠️ EMPTY CONTENT - checking reasoning fallback {
  responseSummary: {
    hasChoices: true,
    hasMessage: true,
    content: null,
    contentType: 'object',
    hasReasoning: false
  }
}
```

### 7. Agent Mode Invalid Response Details
In agent mode, when a response is invalid:
```
❌ LLM null/empty response on iteration 3
Response details: {
  hasResponse: true,
  responseType: 'object',
  responseKeys: ['content', 'needsMoreWork'],
  content: undefined,
  contentType: 'undefined',
  hasToolCalls: false,
  toolCallsCount: 0,
  needsMoreWork: true,
  fullResponse: "{ ... }"
}
```

### 8. Call Attempt Tracking
Each LLM call attempt is logged:
```
🚀 Starting LLM call attempt {
  provider: 'openrouter',
  messagesCount: 5,
  lastMessagePreview: "..."
}
```

### 9. Return Value Logging
See what's being returned:
```
✅ Returning structured JSON response {
  hasContent: true,
  hasToolCalls: true,
  toolCallsCount: 2,
  needsMoreWork: false
}
```

### 10. HTTP Error Response Logging
When HTTP requests fail (non-200 status):
```
❌ HTTP Error Response {
  status: 400,
  statusText: 'Bad Request',
  errorText: '{"error": {"message": "json_schema is not supported"}}',
  headers: { ... }
}
🔴 Detected as structured output error
```

### 11. Successful HTTP Response Logging
When HTTP requests succeed (200 status):
```
✅ HTTP 200 Response received {
  hasError: false,
  hasChoices: true,
  choicesCount: 1,
  firstChoicePreview: {
    hasMessage: true,
    hasContent: true,
    contentType: 'string',
    contentLength: 150
  }
}
```

## Common Issues and What to Look For

### Issue: "Previous request had invalid response" Loop (YOUR CURRENT ISSUE)

This is exactly what you're experiencing with `google/gemini-2.5-flash` through OpenRouter.

**What to check in the logs:**

1. **Look for HTTP response status:**
   - If you see `❌ HTTP Error Response` with status 400/422, the model doesn't support the requested feature
   - If you see `✅ HTTP 200 Response received`, the request succeeded but the response format is wrong

2. **Check the error detection:**
   - Look for `🔴 Detected as structured output error` - this means it will try fallback modes
   - If you DON'T see this, the error isn't being caught properly

3. **Check what's in the response:**
   - Look at `firstChoicePreview` in the `✅ HTTP 200 Response received` log
   - If `hasContent: false` or `contentType: 'object'` (should be 'string'), something is wrong
   - If `contentLength: 0`, the model returned an empty response

4. **Look at the full response structure:**
   - Check `Raw API response structure` log
   - If `hasContent: false`, the response is malformed

**Possible causes:**
- Model doesn't support structured output at all (most likely for Gemini through OpenRouter)
- API provider (OpenRouter) doesn't properly proxy structured output requests to Google
- Model is returning empty responses
- Response format is incompatible with what the code expects

**✅ FIXED:**
I've already added `google/gemini` to the incompatible models list in `src/main/llm-fetch.ts`. This means:
- The model will skip JSON Schema mode entirely
- It will try JSON Object mode first
- If that fails, it will fall back to plain text mode
- The model should now work without the infinite retry loop

**To test the fix:**
1. Rebuild and restart your app
2. Try using `google/gemini-2.5-flash` again
3. You should see in the logs: "JSON Object mode for model: google/gemini-2.5-flash" instead of "JSON Schema mode"
4. The model should now respond properly

### Issue: Empty Responses

**What to check:**
1. Look for `⚠️ EMPTY CONTENT` messages
2. Check the `contentType` - if it's not 'string', something is wrong
3. Look at `messageObj` to see the raw message structure

**Possible causes:**
- API rate limiting (should auto-retry)
- Model configuration issues
- Provider-specific response format differences

### Issue: Model Not Following Instructions

**What to check:**
1. Look at `🔍 JSON Extraction Result` to see if JSON is being extracted
2. Check if `hasToolCalls` is false when you expect tool calls
3. Look at the `extractedObject` to see what was actually parsed

**Possible causes:**
- Model doesn't support tool calling well
- Prompt is too complex for the model
- Model is returning plain text instead of JSON

## Next Steps

If you're still having issues after reviewing the debug logs:

1. **Share the debug logs** - The enhanced logging will show exactly where things are failing
2. **Try a different model** - Some models handle structured output better than others
3. **Check provider compatibility** - Not all providers support all features (especially JSON schema)
4. **Disable structured output** - You can modify the code to skip structured output for specific models

## Files Modified

- `src/main/llm-fetch.ts` - Enhanced HTTP response logging, structured output fallback logging
- `src/main/llm.ts` - Enhanced agent mode response validation logging

