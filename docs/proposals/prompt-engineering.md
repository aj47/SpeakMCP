# Prompt Engineering Analysis for Reliable JSON Tool Calls

## Executive Summary

This document analyzes the current system prompts in SpeakMCP and proposes improvements to ensure reliable JSON output from LLMs, particularly for weaker models like Claude Haiku.

---

## 1. Current Prompt Analysis

### Current System Prompt Structure (`system-prompts.ts`)

The current `DEFAULT_SYSTEM_PROMPT` follows this structure:
1. Role definition
2. Response format rules
3. Tool usage guidelines
4. When to ask/act rules
5. Tone guidance
6. Examples (4 XML-wrapped examples)

### Identified Weaknesses

#### 1.1 Schema Not First
- The JSON schema is embedded mid-prompt in prose form
- Schema is described textually rather than shown as actual JSON
- Weaker models may "forget" format by the time they reach the task

#### 1.2 Examples Use XML Wrapper
```xml
<example>
user: what is 2+2?
assistant: {"content": "4", "needsMoreWork": false}
</example>
```
- Using XML tags for examples may confuse models about allowed formats
- Models see XML in the prompt and may assume XML is acceptable

#### 1.3 Anti-Pattern Warning Buried
- The critical rule "NEVER use XML-style tool call formats" appears mid-prompt
- Negative instructions are less effective than positive demonstrations
- Rule is mixed with other format guidance

#### 1.4 No Explicit JSON-Only Boundary
- Missing clear structural delimiter between rules and task
- No "everything below this line must be JSON" marker

#### 1.5 Tool Schema Format is Verbose
The current tool formatting in `formatToolInfo()`:
```
- tool_name: description
  Parameters: {key: type (required), key2: type}
```
- Not a parseable schema, just descriptive text
- Mismatch between what model sees and what it must produce

---

## 2. Recommended Prompt Structure

### Optimal Order: Schema → Example → Rules → Task

Research shows this order maximizes JSON adherence:
1. **Schema first** - Model learns the target structure immediately
2. **Perfect examples** - Concrete demonstrations reinforce schema
3. **Explicit rules** - Constraints are fresh in context
4. **Task/tools** - User request comes last, closest to response

### 2.1 Proposed Prompt Template

```typescript
export const IMPROVED_SYSTEM_PROMPT = `## OUTPUT SCHEMA (STRICT)

You MUST respond with ONLY this JSON structure. No other format is accepted.

\`\`\`json
{
  "toolCalls": [{"name": "string", "arguments": {...}}],  // Optional: tool invocations
  "content": "string",                                     // Required: response text
  "needsMoreWork": boolean                                 // Required: false when complete
}
\`\`\`

## VALID EXAMPLES

Example 1 - Simple answer:
{"content": "4", "needsMoreWork": false}

Example 2 - Single tool call:
{"toolCalls": [{"name": "list_directory", "arguments": {"path": "src/"}}], "content": "", "needsMoreWork": true}

Example 3 - Multiple tool calls:
{"toolCalls": [{"name": "read_file", "arguments": {"path": "a.txt"}}, {"name": "read_file", "arguments": {"path": "b.txt"}}], "content": "", "needsMoreWork": true}

Example 4 - Final response after tools:
{"content": "The files contain: foo, bar, baz", "needsMoreWork": false}

## STRICT RULES

1. Output ONLY valid JSON - no markdown, no text before/after
2. NEVER use XML formats (<function_calls>, <invoke>, <tool_call>)
3. Tool names must exactly match available tools (with server prefix)
4. Use needsMoreWork: false only when task is complete

## ROLE

You are an autonomous AI assistant using tools to complete tasks.

## BEHAVIOR

- Follow tool schemas exactly
- Batch independent tool calls in one response
- Try tools before refusing
- Be concise (1-3 sentences unless detail requested)

`
```

---

## 3. Tool Schema Improvements

### Current Format (Problematic)
```
- server:tool_name: Some description
  Parameters: {param1: string (required), param2: number}
```

### Proposed Format (JSON Schema)

Show tools as actual JSON schemas to match output expectations:

```typescript
const formatToolAsSchema = (tool: MCPTool) => {
  const schema = {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema || { type: "object", properties: {} }
  }
  return JSON.stringify(schema, null, 2)
}
```

Output:
```json
{
  "name": "filesystem:read_file",
  "description": "Read contents of a file",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "File path to read" }
    },
    "required": ["path"]
  }
}
```

This creates schema symmetry - the model sees JSON and produces JSON.

---

## 4. Model-Specific Variations

### 4.1 Strong Models (Claude Opus/Sonnet, GPT-4)
- Can use structured output via API (`response_format: json_schema`)
- Full prompt still helpful as fallback
- Lower temperature (0) enforces consistency

### 4.2 Weaker Models (Claude Haiku, GPT-3.5, Open-Source)
Need additional reinforcement:

```typescript
const HAIKU_REINFORCEMENT = `
CRITICAL: Your ENTIRE response must be a single JSON object.
Do not write anything before the opening {
Do not write anything after the closing }
Do not use markdown code blocks
Do not use XML tags of any kind
`
```

### 4.3 Model Detection Logic

```typescript
function getModelTier(model: string): 'strong' | 'weak' {
  const strongModels = [
    'gpt-4', 'gpt-4o', 'gpt-4-turbo',
    'claude-3-opus', 'claude-3-sonnet', 'claude-3.5',
    'claude-sonnet-4', 'claude-opus-4'
  ]
  return strongModels.some(s => model.toLowerCase().includes(s))
    ? 'strong' : 'weak'
}

function constructPrompt(tools, model) {
  let prompt = IMPROVED_SYSTEM_PROMPT

  if (getModelTier(model) === 'weak') {
    prompt = HAIKU_REINFORCEMENT + prompt
  }

  return prompt + formatTools(tools)
}
```

---

## 5. Concrete Implementation Changes

### 5.1 Update `DEFAULT_SYSTEM_PROMPT`

Replace the current prompt with schema-first structure:

```typescript
export const DEFAULT_SYSTEM_PROMPT = `## JSON OUTPUT SCHEMA

Respond with ONLY this JSON structure:
{"toolCalls": [{"name": "tool", "arguments": {...}}], "content": "text", "needsMoreWork": bool}

## EXAMPLES

{"content": "4", "needsMoreWork": false}
{"toolCalls": [{"name": "fs:read", "arguments": {"path": "x.txt"}}], "content": "", "needsMoreWork": true}

## RULES

- Output ONLY valid JSON, nothing else
- NO XML (<function_calls>, <invoke>, <tool_call> are FORBIDDEN)
- needsMoreWork: false only when fully complete

## ROLE

Autonomous AI assistant using MCP tools. Be concise.
`
```

### 5.2 Remove XML-Style Example Wrappers

Current:
```typescript
<example>
user: what is 2+2?
assistant: {"content": "4", "needsMoreWork": false}
</example>
```

Proposed:
```typescript
## EXAMPLES

User says: "what is 2+2?"
Correct response: {"content": "4", "needsMoreWork": false}

User says: "list files in src/"
Correct response: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "src/"}}], "content": "", "needsMoreWork": true}
```

### 5.3 Update `constructMinimalSystemPrompt`

The minimal prompt should still include the core schema:

```typescript
export function constructMinimalSystemPrompt(...): string {
  return `JSON ONLY: {"toolCalls": [...], "content": "...", "needsMoreWork": bool}
NO XML. Use exact tool names.
${formatToolList(tools)}`
}
```

---

## 6. Additional Recommendations

### 6.1 Add JSON Validation Reminder in Tool Results

When returning tool results to the LLM, include a format reminder:

```typescript
const toolResultMessage = {
  role: "user",
  content: `Tool result: ${result}\n\nRemember: respond with valid JSON only.`
}
```

### 6.2 Pre-fill Technique for Claude

For Claude models, use assistant pre-fill to force JSON start:

```typescript
messages.push({
  role: "assistant",
  content: "{"  // Pre-fill forces continuation in JSON
})
```

Note: Must strip leading `{` from parsed response.

### 6.3 Error Recovery Prompts

When JSON parsing fails, the recovery prompt should be explicit:

```typescript
const RECOVERY_PROMPT = `Your previous response was not valid JSON.
You MUST respond with ONLY a JSON object like:
{"content": "your response", "needsMoreWork": false}
or
{"toolCalls": [...], "content": "", "needsMoreWork": true}

No other text allowed. Try again:`
```

---

## 7. Testing Recommendations

### 7.1 Test Matrix

| Model | Prompt Version | Tool Count | Success Rate |
|-------|---------------|------------|--------------|
| Haiku | Current | 5 | Baseline |
| Haiku | Improved | 5 | Target >95% |
| Haiku | Current | 50 | Baseline |
| Haiku | Improved | 50 | Target >90% |

### 7.2 Edge Cases to Test

1. Very long tool lists (context pressure)
2. Tools with complex nested schemas
3. Multi-step agentic workflows
4. Recovery from parsing errors
5. XML in user input (shouldn't trigger XML response)

---

## 8. Summary of Changes

| Component | Current | Proposed |
|-----------|---------|----------|
| Schema position | Mid-prompt | First |
| Schema format | Prose | JSON code block |
| Examples | XML-wrapped | Plain JSON |
| Anti-XML rule | Buried | Prominent + examples |
| Tool format | Descriptive | JSON schema |
| Model handling | Uniform | Tiered by capability |
| Recovery | Implicit | Explicit JSON reminder |

---

## 9. Implementation Priority

1. **High**: Replace `DEFAULT_SYSTEM_PROMPT` with schema-first structure
2. **High**: Remove XML wrappers from examples
3. **Medium**: Update `formatToolInfo` to use JSON schema format
4. **Medium**: Add model-tier detection for weak model reinforcement
5. **Low**: Implement assistant pre-fill for Claude models
6. **Low**: Add JSON reminder to tool result messages

---

## Appendix: Full Proposed Prompt

```typescript
export const SCHEMA_FIRST_SYSTEM_PROMPT = `## RESPONSE FORMAT (MANDATORY)

Your response MUST be a single JSON object with this exact structure:

{
  "toolCalls": [{"name": "tool_name", "arguments": {...}}],
  "content": "your text response",
  "needsMoreWork": true_or_false
}

Rules:
- toolCalls: Array of tool invocations (optional, omit if not calling tools)
- content: Your text response (required, can be empty string "")
- needsMoreWork: Set false ONLY when task is fully complete

## EXAMPLES

Answering directly:
{"content": "The answer is 42.", "needsMoreWork": false}

Calling one tool:
{"toolCalls": [{"name": "server:read_file", "arguments": {"path": "config.json"}}], "content": "", "needsMoreWork": true}

Calling multiple tools:
{"toolCalls": [{"name": "server:read_file", "arguments": {"path": "a.txt"}}, {"name": "server:read_file", "arguments": {"path": "b.txt"}}], "content": "Reading both files", "needsMoreWork": true}

After receiving tool results:
{"content": "The config file shows port 8080.", "needsMoreWork": false}

## FORBIDDEN FORMATS

NEVER use these formats - they will break the system:
- XML: <function_calls>, <invoke>, <tool_call>, etc.
- Markdown code blocks around your JSON
- Text before or after the JSON object
- Multiple JSON objects

## YOUR ROLE

You are an autonomous AI assistant that uses tools to complete tasks. Work iteratively until goals are fully achieved.

## BEHAVIOR GUIDELINES

- Use exact tool names from the available list (including server prefixes)
- Follow tool schemas exactly with all required parameters
- Batch independent tool calls in one response for efficiency
- Be concise: 1-3 sentences unless detail is requested
- Try tools before refusing - only refuse after genuine attempts fail
`
```

