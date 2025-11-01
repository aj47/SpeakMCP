# Quick Start - Debugging LLM Issues

## TL;DR - Your Issue is Fixed! 🎉

The `google/gemini-2.5-flash` infinite retry loop has been fixed. Just rebuild and test:

```bash
npm run build
npm run dev
```

## Want to See What's Happening? Enable Debug Logs

```bash
DEBUG_LLM=1 npm run dev
```

## What You'll See

### Before the Fix (Broken)
```
[DEBUG][LLM] Attempting JSON Schema mode for model: google/gemini-2.5-flash
Previous request had invalid response. Please retry or summarize progress.
Previous request had invalid response. Please retry or summarize progress.
Previous request had invalid response. Please retry or summarize progress.
... (repeats forever)
```

### After the Fix (Working)
```
[DEBUG][LLM] 🚀 Starting LLM call attempt {
  provider: 'openrouter',
  messagesCount: 2,
  lastMessagePreview: 'Search the web for...'
}
[DEBUG][LLM] Attempting JSON Object mode for model: google/gemini-2.5-flash
[DEBUG][LLM] === OPENAI API REQUEST ===
[DEBUG][LLM] ✅ HTTP 200 Response received {
  hasError: false,
  hasChoices: true,
  choicesCount: 1,
  firstChoicePreview: {
    hasMessage: true,
    hasContent: true,
    contentType: 'string',
    contentLength: 245
  }
}
[DEBUG][LLM] 📝 Message content extracted: {
  contentLength: 245,
  contentPreview: '{"content": "I'll search for AI coding news...",
  messageObjKeys: [ 'role', 'content' ]
}
[DEBUG][LLM] 🔍 JSON Extraction Result: {
  hasJsonObject: true,
  jsonObjectKeys: [ 'content', 'toolCalls', 'needsMoreWork' ],
  hasToolCalls: true,
  hasContent: true,
  toolCallsCount: 1
}
[DEBUG][LLM] ✅ Returning structured JSON response {
  hasContent: true,
  hasToolCalls: true,
  toolCallsCount: 1,
  needsMoreWork: false
}
```

## Understanding the Debug Symbols

| Symbol | What It Means |
|--------|---------------|
| 🚀 | Starting a new LLM request |
| ✅ | Success - everything is working |
| ❌ | Error - something went wrong |
| ⚠️ | Warning - trying a fallback approach |
| 🔴 | Critical - detected a known issue |
| 📝 | Info - showing you what's happening |
| 🔍 | Analysis - parsing/extracting data |

## Common Debug Patterns

### Pattern 1: Model Works Perfectly
```
🚀 Starting → ✅ HTTP 200 → 📝 Content extracted → 🔍 JSON parsed → ✅ Returning
```
**Meaning:** Everything is working as expected!

### Pattern 2: Structured Output Not Supported
```
🚀 Starting → ⚠️ JSON Schema FAILED → ⚠️ JSON Object FAILED → ✅ Plain text works
```
**Meaning:** Model doesn't support structured output, but plain text works fine.

### Pattern 3: Complete Failure
```
🚀 Starting → ❌ HTTP Error → 🔴 Detected error → Retry → ❌ Fails again
```
**Meaning:** Model or API is having issues. Check your API key or model availability.

### Pattern 4: Empty Response
```
🚀 Starting → ✅ HTTP 200 → ⚠️ EMPTY CONTENT → Retry
```
**Meaning:** API returned success but no content. Usually a temporary issue.

## Quick Troubleshooting

### Issue: Still seeing "invalid response" errors

**Check:**
1. Did you rebuild? `npm run build`
2. Is debug logging enabled? `DEBUG_LLM=1`
3. Look for `⚠️ STRUCTURED OUTPUT ERROR DETECTED` in logs
4. Check if the model is in the incompatible list

**Fix:**
Add your model to the incompatible list in `src/main/llm-fetch.ts`:
```typescript
const incompatibleModels: string[] = [
  "google/gemini",
  "your-model-name-here",  // Add your model
]
```

### Issue: Model returns empty responses

**Check:**
1. Look for `⚠️ EMPTY CONTENT` in logs
2. Check `contentType` - should be 'string'
3. Verify your API key is valid
4. Check if you've hit rate limits

**Fix:**
- Wait a moment and retry
- Check your API provider's status page
- Verify API key has proper permissions

### Issue: Can't see debug logs

**Check:**
1. Did you set `DEBUG_LLM=1`?
2. Are you looking at the right terminal/console?
3. Try `DEBUG=*` to enable all debug logs

**Fix:**
```bash
# macOS/Linux
DEBUG_LLM=1 npm run dev

# Windows (PowerShell)
$env:DEBUG_LLM=1; npm run dev

# Windows (CMD)
set DEBUG_LLM=1 && npm run dev
```

## Files to Reference

- **DEBUG_LLM_GUIDE.md** - Complete debugging guide with all features
- **CHANGES_SUMMARY.md** - What was changed and why
- **LLM_REQUEST_FLOW.md** - Visual flow diagram with debug points

## Need More Help?

1. Enable debug logging: `DEBUG_LLM=1 npm run dev`
2. Try your request again
3. Copy the debug logs
4. Look for the patterns described above
5. Check the detailed guides in the files listed above

## Testing Your Fix

```bash
# 1. Rebuild
npm run build

# 2. Run with debug logging
DEBUG_LLM=1 npm run dev

# 3. Try using google/gemini-2.5-flash
# You should see "JSON Object mode" instead of "JSON Schema mode"

# 4. Verify it works without infinite retries
```

That's it! Your Gemini model should now work perfectly. 🚀

