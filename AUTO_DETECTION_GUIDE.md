# Auto-Detection of Model Capabilities

## Overview

The system now **automatically learns** which models support structured output (JSON Schema, JSON Object) and remembers this for future requests. This eliminates the need to hardcode every incompatible model.

## How It Works

### 1. Try and Remember Approach

```
First Request with New Model
    ↓
Try JSON Schema mode
    ↓
    ├─ Success? → ✅ Record: "This model supports JSON Schema"
    │              Next time: Use JSON Schema directly
    │
    └─ Failure? → ❌ Record: "This model doesn't support JSON Schema"
                   Next time: Skip JSON Schema, try JSON Object
```

### 2. Runtime Capability Cache

The system maintains an in-memory cache:

```typescript
{
  "google/gemini-2.5-flash": {
    supportsJsonSchema: false,    // Learned from failure
    supportsJsonObject: true,     // Learned from success
    lastTested: 1730476800000     // Timestamp
  },
  "gpt-4": {
    supportsJsonSchema: true,     // Learned from success
    supportsJsonObject: true,
    lastTested: 1730476900000
  }
}
```

### 3. Cache Lifetime

- Capabilities are cached for **24 hours**
- After 24 hours, the system will re-test the model
- This handles cases where providers add support for new features

## Benefits Over Hardcoding

| Approach | Hardcoded List | Auto-Detection |
|----------|----------------|----------------|
| **New models** | Must manually add | Works automatically |
| **Provider updates** | Must manually update | Adapts automatically |
| **Maintenance** | High - requires code changes | Low - self-learning |
| **Accuracy** | Can become outdated | Always current |
| **First request** | Fast (if in list) | May try and fail once |
| **Subsequent requests** | Fast | Fast (cached) |

## Example Flow

### First Time Using a New Model

```
User: "Use model xyz/new-model-v1"

System:
  🚀 Starting LLM call attempt
  📝 No cached info for xyz/new-model-v1
  📝 Attempting JSON Schema mode...
  ❌ HTTP Error: "json_schema not supported"
  🔴 Detected as structured output error
  ✅ Recorded: xyz/new-model-v1 doesn't support JSON Schema
  📝 Attempting JSON Object mode...
  ✅ HTTP 200 Response received
  ✅ Recorded: xyz/new-model-v1 supports JSON Object
  ✅ Success!
```

### Second Time Using Same Model

```
User: "Use model xyz/new-model-v1 again"

System:
  🚀 Starting LLM call attempt
  📝 Found cached info for xyz/new-model-v1
  📝 Cache says: Skip JSON Schema, use JSON Object
  📝 Attempting JSON Object mode...
  ✅ HTTP 200 Response received
  ✅ Success! (No wasted attempt on JSON Schema)
```

## Hybrid Approach

The system uses **both** hardcoded lists AND auto-detection:

### 1. Hardcoded List (Seed Knowledge)
```typescript
const incompatibleModels: string[] = [
  "google/gemini",  // Known incompatible
]
```

**Purpose:**
- Provides initial knowledge
- Prevents first-request failures for known models
- Serves as documentation of known issues

### 2. Runtime Cache (Learned Knowledge)
```typescript
modelCapabilityCache.set(model, {
  supportsJsonSchema: false,
  supportsJsonObject: true,
  lastTested: Date.now()
})
```

**Purpose:**
- Learns from actual usage
- Adapts to new models automatically
- Updates when providers change

### 3. Decision Logic

```typescript
function shouldAttemptStructuredOutput(model: string): boolean {
  // 1. Check runtime cache first (most accurate)
  const cached = modelCapabilityCache.get(model)
  if (cached && isCacheFresh(cached)) {
    return cached.supportsJsonSchema
  }
  
  // 2. Fall back to hardcoded list
  return !isInHardcodedList(model)
}
```

## Debug Output

When enabled with `DEBUG_LLM=1`, you'll see:

### Recording Failure
```
⚠️ JSON Schema mode FAILED for model google/gemini-2.5-flash
📝 Recorded capability for google/gemini-2.5-flash: {
  supportsJsonSchema: false,
  supportsJsonObject: true,
  lastTested: 1730476800000
}
```

### Recording Success
```
✅ Confirmed capability for gpt-4: {
  supportsJsonSchema: true,
  supportsJsonObject: true,
  lastTested: 1730476900000
}
```

### Using Cached Info
```
📝 Found cached info for google/gemini-2.5-flash
📝 Cache says: Skip JSON Schema, use JSON Object
```

## Advantages

### 1. **Zero Configuration for New Models**
- Add a new model? It just works
- No code changes needed
- No deployment required

### 2. **Adapts to Provider Changes**
- Provider adds JSON Schema support? System learns it
- Provider removes support? System adapts
- Cache expires after 24h, so changes are detected

### 3. **Optimal Performance**
- First request: May try and fail once (learning)
- All subsequent requests: Use optimal mode immediately
- No wasted API calls after learning

### 4. **Self-Documenting**
- Debug logs show what was learned
- Cache shows current state of all models
- Easy to understand what's happening

## Limitations & Trade-offs

### 1. **First Request May Fail**
- Unknown models will try JSON Schema first
- If it fails, falls back (adds latency to first request)
- **Mitigation:** Keep hardcoded list for common models

### 2. **Cache is In-Memory**
- Lost on app restart
- Each instance learns independently
- **Mitigation:** Could persist to disk (future enhancement)

### 3. **24-Hour Cache**
- Changes take up to 24h to detect
- **Mitigation:** Reasonable balance between freshness and efficiency

## Future Enhancements

### 1. Persistent Cache
```typescript
// Save to disk
fs.writeFileSync('model-capabilities.json', 
  JSON.stringify(Array.from(modelCapabilityCache.entries()))
)

// Load on startup
const saved = JSON.parse(fs.readFileSync('model-capabilities.json'))
modelCapabilityCache = new Map(saved)
```

### 2. Shared Cache Across Users
```typescript
// Fetch community-maintained capability database
const capabilities = await fetch('https://api.example.com/model-capabilities')
```

### 3. Configurable Cache TTL
```typescript
// Allow users to configure cache lifetime
const CAPABILITY_CACHE_TTL = config.modelCacheTTL || (24 * 60 * 60 * 1000)
```

## Summary

**Before:** Had to manually add every incompatible model to a hardcoded list

**After:** System automatically learns and remembers model capabilities

**Result:** 
- ✅ Works with any new model automatically
- ✅ Adapts to provider changes
- ✅ Optimal performance after first request
- ✅ Low maintenance
- ✅ Self-documenting through debug logs

