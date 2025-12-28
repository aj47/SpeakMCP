# Robust Multi-Format LLM Response Parser

## Executive Summary

Different LLM providers and models output tool calls in various formats. This proposal defines a comprehensive parsing strategy that normalizes all known formats into SpeakMCP's canonical envelope format.

## Current State Analysis

### Canonical Output Format (Target)

All parsing should produce the `LLMToolCallResponse` type:

```typescript
interface LLMToolCallResponse {
  content?: string           // Text response to display to user
  toolCalls?: MCPToolCall[]  // Array of {name: string, arguments: object}
  needsMoreWork?: boolean    // true = continue agent loop, false = complete
}
```

### Current Parsing Implementation

**llm-fetch.ts:**
- `normalizeXmlToolCalls()` - Handles XML-wrapped JSON arrays
- `extractJsonObject()` - Finds JSON objects in text, prefers envelope objects
- `isToolCallEnvelope()` - Validates object has `toolCalls` or `needsMoreWork`

**llm.ts:**
- XML marker detection regex for cleanup (`xmlToolCallPattern`)
- Nudging mechanism for malformed responses

### Current Gaps

1. **Limited XML handling**: Only handles `function_calls` with JSON array inside
2. **No Anthropic-style parsing**: `invoke` with nested `parameter` tags not parsed
3. **No markdown unwrapping**: JSON in code blocks not explicitly handled
4. **Scattered logic**: Parsing split between files

---

## Catalog of Known LLM Output Formats

### Format 1: Clean JSON Envelope (Ideal)

```json
{"toolCalls": [{"name": "read_file", "arguments": {"path": "config.json"}}], "content": "", "needsMoreWork": true}
```

**Sources:** OpenAI with structured output, compliant models

### Format 2: XML-Wrapped JSON Array

Structure: `<function_calls>[...JSON array...]</function_calls>`

**Sources:** Some open-source models (Llama variants), Groq with certain prompts

### Format 3: Anthropic-Style XML Invocation

Structure: `<function_calls><invoke name="..."><parameter name="...">value</parameter></invoke></function_calls>`

Also supports namespaced variant: `<invoke>` with `<parameter>`

**Sources:** Claude models (when not using structured output), Anthropic API

### Format 4: Markdown-Wrapped JSON

Structure: Triple backticks with json/no language followed by JSON

**Sources:** ChatGPT, various models when asked to "format as JSON"

### Format 5: Mixed Text with Embedded JSON

Plain text with JSON object somewhere in the content.

**Sources:** Many models, especially without strict structured output

### Format 6: Special Token Markers (DeepSeek, etc.)

Structure: `<|tool_calls_section_begin|>...<|tool_call_end|>`

**Sources:** DeepSeek, Qwen, some fine-tuned models

### Format 7: Single Tool Object (Not Array)

Structure: `{"name": "...", "arguments": {...}}` (missing toolCalls wrapper)

**Sources:** Simplified responses, some smaller models

### Format 8: OpenAI Native Tool Calls

Handled at API layer via `message.tool_calls` - not a parsing concern.

---

## Unified Parsing Strategy

### Parser Pipeline

```
Raw LLM Output
     |
     v
+---------------------------------------------+
| 1. Strip markdown code fences               |
|    (triple backticks json -> inner content) |
+---------------------------------------------+
     |
     v
+---------------------------------------------+
| 2. Parse Anthropic-style XML                |
|    (invoke/parameter tags -> toolCalls)     |
+---------------------------------------------+
     |
     v
+---------------------------------------------+
| 3. Parse XML-wrapped JSON arrays            |
|    (function_calls -> JSON array -> envelope|
+---------------------------------------------+
     |
     v
+---------------------------------------------+
| 4. Parse special token markers              |
|    (tool_call_begin etc -> toolCalls)       |
+---------------------------------------------+
     |
     v
+---------------------------------------------+
| 5. Extract JSON objects (current logic)     |
|    (prefer envelope format)                 |
+---------------------------------------------+
     |
     v
+---------------------------------------------+
| 6. Normalize single tool to array           |
|    ({name, arguments} -> {toolCalls: [...]}) |
+---------------------------------------------+
     |
     v
LLMToolCallResponse
```

---

## Proposed Code Structure

### New File: `apps/desktop/src/main/response-parser.ts`

```typescript
/**
 * Unified LLM Response Parser
 * 
 * Normalizes all known LLM output formats to canonical LLMToolCallResponse.
 * Parsing is done in layers, from most structured to least.
 */

import { LLMToolCallResponse, MCPToolCall } from "./mcp-service"

/**
 * Main entry point: parse any LLM response into canonical format
 */
export function parseLLMResponse(rawContent: string): LLMToolCallResponse {
  // Pre-processing: strip markdown fences
  let content = stripMarkdownCodeFences(rawContent)
  
  // Try Anthropic-style XML (invoke/parameter)
  const anthropicResult = parseAnthropicStyleXML(content)
  if (anthropicResult) return anthropicResult
  
  // Try XML-wrapped JSON array  
  const xmlJsonResult = parseXMLWrappedJSON(content)
  if (xmlJsonResult) return xmlJsonResult
  
  // Try special token markers (DeepSeek style)
  const tokenMarkerResult = parseTokenMarkers(content)
  if (tokenMarkerResult) return tokenMarkerResult
  
  // Try extracting JSON objects (current behavior)
  const jsonResult = extractBestJSONObject(content)
  if (jsonResult) return normalizeToEnvelope(jsonResult, content)
  
  // Fallback: plain text response
  return { content: content.trim(), needsMoreWork: undefined }
}

/**
 * Strip markdown code fences
 */
function stripMarkdownCodeFences(str: string): string {
  const fencePattern = /```(?:json|javascript|typescript|)?\s*\n?([\s\S]*?)\n?```/gi
  const match = str.match(fencePattern)
  if (match) {
    return str.replace(fencePattern, '$1').trim()
  }
  return str
}

/**
 * Parse Anthropic-style XML: invoke tags with parameter children
 */
function parseAnthropicStyleXML(str: string): LLMToolCallResponse | null {
  // Matches: <invoke name="toolName"><parameter name="param">value</parameter></invoke>
  // Also matches antml: prefixed variants
  const invokePattern = /<(?:antml:)?invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:antml:)?invoke>/gi
  
  const toolCalls: MCPToolCall[] = []
  let invokeMatch: RegExpExecArray | null
  
  while ((invokeMatch = invokePattern.exec(str)) \!== null) {
    const toolName = invokeMatch[1]
    const invokeContent = invokeMatch[2]
    const args = parseParameterTags(invokeContent)
    toolCalls.push({ name: toolName, arguments: args })
  }
  
  if (toolCalls.length > 0) {
    const cleanedContent = str
      .replace(/<(?:antml:)?function_calls[\s\S]*?<\/(?:antml:)?function_calls>/gi, '')
      .replace(/<(?:antml:)?invoke[\s\S]*?<\/(?:antml:)?invoke>/gi, '')
      .trim()
    
    return {
      toolCalls,
      content: cleanedContent || 'Executing tools',
      needsMoreWork: true
    }
  }
  return null
}

function parseParameterTags(content: string): Record<string, any> {
  const paramPattern = /<(?:antml:)?parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:antml:)?parameter>/gi
  const args: Record<string, any> = {}
  let match: RegExpExecArray | null
  
  while ((match = paramPattern.exec(content)) \!== null) {
    const paramName = match[1]
    const paramValue = match[2].trim()
    try {
      args[paramName] = JSON.parse(paramValue)
    } catch {
      args[paramName] = paramValue
    }
  }
  return args
}

/**
 * Parse XML-wrapped JSON arrays (existing normalizeXmlToolCalls logic)
 */
function parseXMLWrappedJSON(str: string): LLMToolCallResponse | null {
  const xmlPattern = /<function_calls\s*>[\s\S]*?<\/function_calls\s*>/gi
  const match = str.match(xmlPattern)
  if (\!match) return null

  const innerContent = match[0]
    .replace(/<\/?function_calls\s*>/gi, '')
    .trim()

  try {
    const parsed = JSON.parse(innerContent)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) {
      return {
        toolCalls: parsed,
        content: str.replace(xmlPattern, '').trim() || 'Executing tools',
        needsMoreWork: true
      }
    }
  } catch { /* Not valid JSON */ }
  return null
}

/**
 * Parse special token markers (DeepSeek, Qwen style)
 */
function parseTokenMarkers(str: string): LLMToolCallResponse | null {
  const markerPattern = /<\|tool_call_begin\|>([\s\S]*?)<\|tool_call_end\|>/gi
  const toolCalls: MCPToolCall[] = []
  let match: RegExpExecArray | null
  
  while ((match = markerPattern.exec(str)) \!== null) {
    const toolContent = match[1].trim()
    try {
      const parsed = JSON.parse(toolContent)
      if (parsed.name && parsed.arguments) {
        toolCalls.push(parsed)
      }
    } catch { /* Skip invalid */ }
  }
  
  if (toolCalls.length > 0) {
    const cleanedContent = str
      .replace(/<\|[^|]*\|>/g, '')
      .trim()
    return {
      toolCalls,
      content: cleanedContent || 'Executing tools',
      needsMoreWork: true
    }
  }
  return null
}

/**
 * Extract best JSON object from string (existing extractJsonObject logic)
 */
function extractBestJSONObject(str: string): any | null {
  const candidates: any[] = []
  let braceCount = 0
  let startIndex = -1

  for (let i = 0; i < str.length; i++) {
    if (str[i] === "{") {
      if (braceCount === 0) startIndex = i
      braceCount++
    } else if (str[i] === "}") {
      braceCount--
      if (braceCount === 0 && startIndex \!== -1) {
        try {
          const obj = JSON.parse(str.substring(startIndex, i + 1))
          candidates.push(obj)
        } catch { /* Skip */ }
        startIndex = -1
      }
    }
  }

  if (candidates.length === 0) return null
  
  // Prefer envelope objects
  const envelope = candidates.find(obj => 'toolCalls' in obj || 'needsMoreWork' in obj)
  return envelope ?? candidates[0]
}

/**
 * Normalize any parsed object to envelope format
 */
function normalizeToEnvelope(obj: any, originalContent: string): LLMToolCallResponse {
  // Already an envelope
  if ('toolCalls' in obj || 'needsMoreWork' in obj) {
    return obj as LLMToolCallResponse
  }
  
  // Single tool object - wrap in envelope
  if (obj.name && obj.arguments) {
    return {
      toolCalls: [obj],
      content: '',
      needsMoreWork: true
    }
  }
  
  // Unknown structure - treat as content
  return {
    content: originalContent.trim(),
    needsMoreWork: undefined
  }
}
```

---

## Test Cases

### Test File: `apps/desktop/src/main/response-parser.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { parseLLMResponse } from './response-parser'

describe('parseLLMResponse', () => {
  describe('Format 1: Clean JSON Envelope', () => {
    it('parses clean JSON envelope', () => {
      const input = '{"toolCalls": [{"name": "read_file", "arguments": {"path": "x.txt"}}], "needsMoreWork": true}'
      const result = parseLLMResponse(input)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls\![0].name).toBe('read_file')
      expect(result.needsMoreWork).toBe(true)
    })
    
    it('parses content-only response', () => {
      const input = '{"content": "The answer is 42", "needsMoreWork": false}'
      const result = parseLLMResponse(input)
      expect(result.content).toBe('The answer is 42')
      expect(result.needsMoreWork).toBe(false)
    })
  })

  describe('Format 2: XML-Wrapped JSON Array', () => {
    it('parses function_calls with JSON array', () => {
      const input = '<function_calls>[{"name": "list_dir", "arguments": {"path": "."}}]</function_calls>'
      const result = parseLLMResponse(input)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls\![0].name).toBe('list_dir')
    })

    it('preserves text outside function_calls', () => {
      const input = 'I will list that directory.\n<function_calls>[{"name": "list_dir", "arguments": {"path": "."}}]</function_calls>'
      const result = parseLLMResponse(input)
      expect(result.content).toContain('I will list that directory')
    })
  })

  describe('Format 3: Anthropic-Style XML', () => {
    it('parses invoke tags with parameters', () => {
      const input = '<function_calls><invoke name="read_file"><parameter name="path">config.json</parameter></invoke></function_calls>'
      const result = parseLLMResponse(input)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls\![0].name).toBe('read_file')
      expect(result.toolCalls\![0].arguments.path).toBe('config.json')
    })

    it('parses multiple invoke tags', () => {
      const input = '<function_calls><invoke name="read_file"><parameter name="path">a.txt</parameter></invoke><invoke name="read_file"><parameter name="path">b.txt</parameter></invoke></function_calls>'
      const result = parseLLMResponse(input)
      expect(result.toolCalls).toHaveLength(2)
    })
  })

  describe('Format 4: Markdown-Wrapped JSON', () => {
    it('extracts JSON from markdown code block', () => {
      const input = 'Here is the result:\n```json\n{"toolCalls": [{"name": "test", "arguments": {}}], "needsMoreWork": true}\n```'
      const result = parseLLMResponse(input)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls\![0].name).toBe('test')
    })
  })

  describe('Format 5: Mixed Text with Embedded JSON', () => {
    it('extracts JSON from mixed content', () => {
      const input = 'I will help you with that.\n\n{"toolCalls": [{"name": "search", "arguments": {"q": "test"}}], "needsMoreWork": true}'
      const result = parseLLMResponse(input)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls\![0].name).toBe('search')
    })
  })

  describe('Format 6: Token Markers', () => {
    it('parses DeepSeek-style token markers', () => {
      const input = '<|tool_calls_section_begin|><|tool_call_begin|>{"name": "test", "arguments": {}}<|tool_call_end|><|tool_calls_section_end|>'
      const result = parseLLMResponse(input)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls\![0].name).toBe('test')
    })
  })

  describe('Format 7: Single Tool Object', () => {
    it('wraps single tool in envelope', () => {
      const input = '{"name": "read_file", "arguments": {"path": "test.txt"}}'
      const result = parseLLMResponse(input)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls\![0].name).toBe('read_file')
      expect(result.needsMoreWork).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('handles plain text response', () => {
      const input = 'The answer to your question is 42.'
      const result = parseLLMResponse(input)
      expect(result.content).toBe('The answer to your question is 42.')
      expect(result.toolCalls).toBeUndefined()
    })

    it('handles empty string', () => {
      const result = parseLLMResponse('')
      expect(result.content).toBe('')
    })

    it('handles malformed JSON gracefully', () => {
      const input = '{"toolCalls": [{"name": "test"'
      const result = parseLLMResponse(input)
      expect(result.content).toBe('{"toolCalls": [{"name": "test"')
    })
  })
})
```

---

## Migration Plan

### Phase 1: Create Parser Module
1. Create `response-parser.ts` with all parsing functions
2. Add comprehensive test suite
3. Export `parseLLMResponse` as main entry point

### Phase 2: Integrate with llm-fetch.ts
1. Replace `normalizeXmlToolCalls()` calls with `parseLLMResponse()`
2. Remove `extractJsonObject()` and `isToolCallEnvelope()` (now internal)
3. Update imports

### Phase 3: Simplify llm.ts
1. Remove XML detection/cleanup logic (now handled by parser)
2. Remove nudging for XML formats (parser handles them)
3. Keep only the conversation loop logic

### Phase 4: Cleanup
1. Remove deprecated functions
2. Update documentation
3. Add integration tests

---

## Benefits

1. **Single source of truth**: All parsing logic in one module
2. **Comprehensive coverage**: Handles all known LLM output formats
3. **Testable**: Each format has dedicated test cases
4. **Extensible**: Easy to add new formats as they emerge
5. **Graceful degradation**: Always produces valid output

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Regex performance on large responses | Limit input size, use early returns |
| False positives in format detection | Order parsers from most specific to least |
| Breaking existing behavior | Comprehensive test suite, gradual rollout |
| New formats from future models | Modular design allows easy additions |

---

## Appendix: Real-World Examples

### Example A: Groq with Llama 3.1

Input:
```
<function_calls>
[{"name": "read_file", "arguments": {"path": "/etc/hosts"}}]
</function_calls>
```

Expected output:
```json
{
  "toolCalls": [{"name": "read_file", "arguments": {"path": "/etc/hosts"}}],
  "content": "Executing tools",
  "needsMoreWork": true
}
```

### Example B: Claude without structured output

Input:
```
<function_calls>
<invoke name="search_web">
<parameter name="query">weather today</parameter>
<parameter name="num_results">5</parameter>
</invoke>
</function_calls>
```

Expected output:
```json
{
  "toolCalls": [{"name": "search_web", "arguments": {"query": "weather today", "num_results": 5}}],
  "content": "Executing tools",
  "needsMoreWork": true
}
```

### Example C: ChatGPT with markdown

Input:
```
I'll search for that information.

\`\`\`json
{"toolCalls": [{"name": "web_search", "arguments": {"q": "latest news"}}], "needsMoreWork": true}
\`\`\`
```

Expected output:
```json
{
  "toolCalls": [{"name": "web_search", "arguments": {"q": "latest news"}}],
  "needsMoreWork": true
}
```
