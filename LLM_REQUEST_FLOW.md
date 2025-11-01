# LLM Request Flow with Debug Points

This diagram shows where debug logging occurs in the LLM request/response flow.

```
┌─────────────────────────────────────────────────────────────────┐
│ makeLLMCallWithFetch()                                          │
│ 🚀 Starting LLM call attempt                                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Check: shouldAttemptStructuredOutput(model)?                    │
│                                                                 │
│ ✅ YES (most models) → Try JSON Schema                         │
│ ❌ NO (google/gemini) → Skip to JSON Object mode               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ makeAPICallAttempt() - JSON Schema Mode                         │
│ 📝 Attempting JSON Schema mode for model: ...                  │
│ 📝 Request Body (truncated)                                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ HTTP Request to API                                             │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                    ┌───────┴───────┐
                    │               │
            ❌ Error (4xx/5xx)   ✅ Success (200)
                    │               │
                    ↓               ↓
    ┌───────────────────────┐   ┌──────────────────────────┐
    │ ❌ HTTP Error Response│   │ ✅ HTTP 200 Response     │
    │ - status              │   │ - hasChoices             │
    │ - errorText           │   │ - hasContent             │
    │ - headers             │   │ - contentType            │
    └───────────────────────┘   └──────────────────────────┘
                    │               │
                    ↓               ↓
    ┌───────────────────────┐   ┌──────────────────────────┐
    │ Is Structured Output  │   │ Parse Response           │
    │ Error?                │   │ 📝 HTTP Response (full)  │
    └───────────────────────┘   └──────────────────────────┘
                    │               │
            ┌───────┴───────┐       │
            │               │       │
        ✅ YES          ❌ NO       │
            │               │       │
            ↓               ↓       │
    ┌───────────────┐   ┌─────────┴────────┐
    │ 🔴 Detected   │   │ Re-throw error   │
    │ Fallback to   │   │                  │
    │ JSON Object   │   └──────────────────┘
    └───────────────┘
            │
            ↓
    ┌───────────────────────────────────────┐
    │ ⚠️ JSON Schema mode FAILED            │
    │ - falling back to JSON Object mode    │
    └───────────────────────────────────────┘
            │
            ↓
    ┌───────────────────────────────────────┐
    │ Retry with JSON Object mode           │
    └───────────────────────────────────────┘
            │
            ↓ (if fails again)
    ┌───────────────────────────────────────┐
    │ ⚠️ JSON Object mode FAILED            │
    │ - falling back to plain text          │
    └───────────────────────────────────────┘
            │
            ↓
    ┌───────────────────────────────────────┐
    │ Retry with Plain Text mode            │
    └───────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Extract Content from Response                                   │
│ 📝 Message content extracted:                                   │
│ - contentLength                                                 │
│ - contentPreview                                                │
│ - messageObjKeys                                                │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                    ┌───────┴───────┐
                    │               │
            Content Empty?      Content Present
                    │               │
                    ↓               ↓
    ┌───────────────────────┐   ┌──────────────────────────┐
    │ ⚠️ EMPTY CONTENT      │   │ 🔍 JSON Extraction       │
    │ - checking reasoning  │   │ - hasJsonObject          │
    │   fallback            │   │ - hasToolCalls           │
    └───────────────────────┘   │ - extractedObject        │
                                └──────────────────────────┘
                                            │
                                            ↓
                                ┌───────────────────────────┐
                                │ ✅ Return Response        │
                                │ - hasContent              │
                                │ - hasToolCalls            │
                                │ - needsMoreWork           │
                                └───────────────────────────┘
```

## Key Debug Points

| Symbol | Meaning |
|--------|---------|
| 🚀 | Call initiated |
| 📝 | Information logged |
| ✅ | Success path |
| ❌ | Error path |
| ⚠️ | Warning/Fallback |
| 🔴 | Critical detection |
| 🔍 | Analysis/Parsing |

## For Gemini Models

When using `google/gemini-2.5-flash`, the flow is:

```
🚀 Start → Check model → ❌ Skip JSON Schema → 
📝 Try JSON Object → ✅ Success → 🔍 Extract JSON → ✅ Return
```

Instead of the old broken flow:

```
🚀 Start → Try JSON Schema → ❌ Fail → ❌ Invalid Response → 
Retry → ❌ Fail → ❌ Invalid Response → Retry → ... (infinite loop)
```

