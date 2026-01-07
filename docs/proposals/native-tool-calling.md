# Native Tool Calling API Proposal

## Overview

This document proposes migrating SpeakMCP from structured JSON output for tool calls to using **native tool calling APIs** where supported. Native tool calling provides better reliability, structured responses, and eliminates the need for XML parsing workarounds.

## Current Architecture

### How Tool Calls Work Today

1. **System prompt injection**: Tools are embedded in the system prompt as text descriptions
2. **Structured JSON output**: LLM is instructed to respond with `{"toolCalls": [...], "content": "...", "needsMoreWork": true}`
3. **XML fallback parsing**: Some models emit `<function_calls>...</function_calls>` wrappers that require manual parsing
4. **Response extraction**: `extractJsonObject()` searches for JSON in the response text

**Files involved:**
- `apps/desktop/src/main/llm-fetch.ts` - Main LLM call logic
- `apps/desktop/src/main/system-prompts.ts` - Tool embedding in prompts
- `apps/desktop/src/main/mcp-service.ts` - MCP tool definitions

### Current Pain Points

1. **XML wrapper emission**: Models like Claude sometimes emit `<function_calls>` XML instead of clean JSON
2. **Unreliable parsing**: Need `normalizeXmlToolCalls()` to handle malformed responses
3. **Token overhead**: Tool definitions in system prompt consume context tokens
4. **No parallel tool calls**: Current approach doesn't leverage native parallel calling
5. **Inconsistent behavior**: Different models have different response patterns

## Proposed Solution: Native Tool Calling

### OpenAI Tool Calling Format

The OpenAI API supports native `tools` parameter:

```typescript
const tools = [
  {
    type: "function",
    function: {
      name: "filesystem:read_file",
      description: "Read a file from the filesystem",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to read"
          }
        },
        required: ["path"]
      }
    }
  }
];

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [...],
  tools: tools,
  tool_choice: "auto"  // "auto" | "none" | {type: "function", function: {name: "..."}}
});

// Response includes tool_calls in message object
const toolCalls = response.choices[0].message.tool_calls;
// Each: { id: "call_abc123", type: "function", function: { name: "...", arguments: "{...}" }}
```

### Tool Call Response Flow

```
Request → LLM → Response with tool_calls → Execute tools → Continue conversation

// Message format for tool results:
{
  role: "tool",
  tool_call_id: "call_abc123",
  content: "File contents here..."
}
```

## Provider Support Matrix

| Provider | Native Tool Calling | Parallel Tools | Notes |
|----------|---------------------|----------------|-------|
| **OpenAI** | ✅ Full | ✅ Yes | GPT-4o, GPT-4, GPT-3.5-turbo |
| **OpenRouter** | ✅ Full | ✅ Yes | Proxies to underlying provider, check model |
| **Groq** | ✅ Full | ✅ Yes | Llama 3.1, Llama 3.3 native support |
| **Gemini** | ✅ Full | ✅ Yes | Different API format, needs translation |

### Model-Specific Support

**OpenAI Native:**
- `gpt-4o`, `gpt-4o-mini` - Full support
- `gpt-4-turbo`, `gpt-4` - Full support
- `gpt-3.5-turbo` - Full support

**Groq (via OpenAI-compatible API):**
- `llama-3.3-70b-versatile` - Native tool calling
- `llama-3.1-*` - Native tool calling
- `llama-3-groq-*-tool-use` - Specialized for tools

**OpenRouter (depends on underlying model):**
- `anthropic/claude-3.5-sonnet` - Full support
- `google/gemini-*` - Full support
- `meta-llama/llama-3.1-*` - Full support
- Models without support fall back gracefully

## Detection Strategy

### Option 1: Static Model List (Recommended for MVP)

```typescript
const NATIVE_TOOL_CALLING_MODELS: Record<string, boolean> = {
  // OpenAI native
  "gpt-4o": true,
  "gpt-4o-mini": true,
  "gpt-4-turbo": true,
  "gpt-4": true,
  "gpt-3.5-turbo": true,

  // Groq
  "llama-3.3-70b-versatile": true,
  "llama-3.1-70b-versatile": true,
  "llama-3-groq-70b-tool-use": true,
  "llama-3-groq-8b-tool-use": true,

  // OpenRouter patterns (handled separately)
};

function supportsNativeToolCalling(model: string, baseUrl: string): boolean {
  // OpenRouter: most modern models support it
  if (baseUrl.includes("openrouter.ai")) {
    return !model.includes("gemma") && !model.includes("phi");
  }
  
  // Check static list
  for (const [pattern, supported] of Object.entries(NATIVE_TOOL_CALLING_MODELS)) {
    if (model.includes(pattern)) return supported;
  }
  
  return false;
}
```

### Option 2: Runtime Discovery via OpenRouter API

OpenRouter provides model metadata at `/api/v1/models/{author}/{slug}`:

```typescript
interface OpenRouterModelInfo {
  id: string;
  name: string;
  supported_parameters?: string[]; // May include "tools"
}

async function checkToolCallingSupport(model: string): Promise<boolean> {
  const response = await fetch(`https://openrouter.ai/api/v1/models/${model}`);
  const info = await response.json();
  return info.supported_parameters?.includes("tools") ?? false;
}
```

### Option 3: Runtime Capability Learning (Current Pattern Extension)

Extend the existing `modelCapabilityCache` pattern:

```typescript
const modelCapabilityCache = new Map<string, {
  supportsJsonSchema: boolean;
  supportsJsonObject: boolean;
  supportsNativeToolCalling: boolean;  // NEW
  lastTested: number;
}>();
```

## Implementation: MCP to OpenAI Tool Mapping

### Current MCPTool Interface

```typescript
interface MCPTool {
  name: string;           // e.g., "filesystem:read_file"
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, JsonSchema>;
    required?: string[];
  };
}
```

### Conversion Function

```typescript
function mcpToolToOpenAITool(mcpTool: MCPTool): OpenAI.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: {
        type: "object",
        properties: mcpTool.inputSchema.properties || {},
        required: mcpTool.inputSchema.required || []
      }
    }
  };
}

function mcpToolsToOpenAITools(mcpTools: MCPTool[]): OpenAI.ChatCompletionTool[] {
  return mcpTools.map(mcpToolToOpenAITool);
}
```

### Converting Tool Call Responses

```typescript
interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

function openAIToolCallsToMCP(toolCalls: OpenAIToolCall[]): MCPToolCall[] {
  return toolCalls.map(tc => ({
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments)
  }));
}
```

## Proposed Architecture Changes

### New `llm-fetch.ts` Structure

```typescript
async function makeOpenAICompatibleCall(
  messages: Array<{ role: string; content: string }>,
  providerId: string,
  options: {
    useStructuredOutput?: boolean;
    tools?: MCPTool[];           // NEW: Pass tools for native calling
    toolChoice?: "auto" | "none";
  }
): Promise<any> {
  const model = getModel(providerId, "mcp");
  const baseURL = getBaseURL(providerId);

  // Determine if we should use native tool calling
  const useNativeTools = options.tools?.length &&
                         supportsNativeToolCalling(model, baseURL);

  const requestBody: any = {
    model,
    messages,
    temperature: 0,
    seed: 1,
  };

  if (useNativeTools) {
    // Native tool calling path
    requestBody.tools = mcpToolsToOpenAITools(options.tools);
    requestBody.tool_choice = options.toolChoice || "auto";
  } else if (options.useStructuredOutput) {
    // Fallback: structured JSON output
    requestBody.response_format = {
      type: "json_schema",
      json_schema: toolCallResponseSchema
    };
  }

  const response = await makeAPICallAttempt(baseURL, apiKey, requestBody);

  // Handle native tool call response
  if (useNativeTools && response.choices[0].message.tool_calls) {
    return {
      ...response,
      nativeToolCalls: true  // Flag for response handler
    };
  }

  return response;
}
```

### Response Processing

```typescript
function processLLMResponse(
  response: any,
  usedNativeTools: boolean
): LLMToolCallResponse {
  const message = response.choices[0].message;

  if (usedNativeTools && message.tool_calls?.length) {
    // Native tool calling response
    return {
      toolCalls: openAIToolCallsToMCP(message.tool_calls),
      content: message.content || "",
      needsMoreWork: true  // Tools need to be executed
    };
  }

  // Existing structured output parsing
  return parseStructuredResponse(message.content);
}
```

### Tool Result Messages

When using native tool calling, tool results must be sent back:

```typescript
function formatToolResultForNativeAPI(
  toolCallId: string,
  result: MCPToolResult
): { role: "tool"; tool_call_id: string; content: string } {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: result.content.map(c => c.text).join("\n")
  };
}
```

## Pros and Cons

### Advantages of Native Tool Calling

| Benefit | Description |
|---------|-------------|
| **Reliability** | No XML/JSON parsing issues; structured response format |
| **Token Efficiency** | Tools sent as API parameter, not in system prompt |
| **Parallel Calls** | Native support for `parallel_tool_calls` |
| **Tool Call IDs** | Unique IDs enable proper result correlation |
| **Better Errors** | API validates tool schemas; clearer error messages |
| **Streaming Support** | Tool calls can be streamed progressively |

### Disadvantages / Risks

| Risk | Mitigation |
|------|------------|
| **Not universal** | Maintain fallback to structured output |
| **Different Gemini format** | Abstract behind unified interface |
| **Migration complexity** | Phased rollout, feature flag |
| **OpenRouter variability** | Per-model detection needed |

## Migration Strategy

### Phase 1: Add Infrastructure (Low Risk)

1. Add `mcpToolsToOpenAITools()` conversion functions
2. Add `supportsNativeToolCalling()` detection
3. Add capability tracking to `modelCapabilityCache`

### Phase 2: Implement Native Path (Medium Risk)

1. Add `tools` parameter support to `makeOpenAICompatibleCall()`
2. Process `tool_calls` in responses
3. Format tool results with `tool_call_id`

### Phase 3: Enable & Fallback (Feature Flag)

```typescript
const config = configStore.get();
const useNativeToolCalling = config.experimental?.nativeToolCalling ?? false;

if (useNativeToolCalling && supportsNativeToolCalling(model, baseURL)) {
  // New native path
} else {
  // Existing structured output path
}
```

### Phase 4: Gradual Rollout

1. Enable by default for known-good models (GPT-4o, Claude 3.5)
2. Add runtime detection for OpenRouter models
3. Remove structured output for fully-supported providers

## Affected Code Paths

| File | Changes Needed |
|------|----------------|
| `llm-fetch.ts` | Add `tools` param, handle `tool_calls` response |
| `llm.ts` | Pass tools to API calls, handle tool result flow |
| `system-prompts.ts` | Optionally skip tool injection when native |
| `mcp-service.ts` | Add MCP→OpenAI tool conversion |
| `config.ts` | Add `experimental.nativeToolCalling` flag |

## Conclusion

Native tool calling is the recommended approach for reliable tool execution. The implementation can be done incrementally with a fallback to the current structured output approach. Priority should be:

1. **MVP**: OpenAI (gpt-4o, gpt-4o-mini) + Groq (llama-3.1/3.3)
2. **Phase 2**: OpenRouter with model detection
3. **Phase 3**: Gemini native format support

This eliminates the XML parsing workarounds and provides a more robust foundation for agentic workflows.

