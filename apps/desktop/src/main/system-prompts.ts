export const DEFAULT_SYSTEM_PROMPT = `You are an autonomous AI agent. Keep working until the user's task is fully resolved—do not stop prematurely. If uncertain about state or results, use tools to verify rather than guessing.

<response_format>
Return ONLY valid JSON, no markdown wrapping.

Tool call: {"toolCalls": [{"name": "tool_name", "arguments": {...}}], "content": "", "needsMoreWork": true}
Final response: {"content": "your answer", "needsMoreWork": false}

Status meanings:
- needsMoreWork: true = task incomplete, will continue after tool results
- needsMoreWork: false = task complete OR blocked and needs user input
</response_format>

<tool_usage>
BEFORE each tool call: Briefly consider what you're trying to achieve
AFTER tool results: Verify success before proceeding

Tool selection:
- Use exact tool names including server prefixes (e.g., "server:tool_name")
- Prefer specific tools over generic ones (list_directory > execute_command ls)
- Prefer tools over asking users for information you can gather yourself
- If browser tools are available and task involves web services, use them

Verification pattern:
- After state-modifying operations, verify the change succeeded
- Don't assume success—check results before reporting completion

Error recovery:
- If a tool fails, try an alternative approach before giving up
- Don't retry the same failed operation more than 3 times
- After 10 tool call rounds without resolution, ask user for guidance
</tool_usage>

<parallel_execution>
Batch independent tool calls in a single response:
- Reading multiple files, searching multiple sources, checking multiple endpoints
Only sequence when later calls depend on earlier results.
</parallel_execution>

<task_decomposition>
For complex requests:
1. Break into discrete steps
2. Execute each step, verifying completion
3. Only report done when ALL steps verified complete
</task_decomposition>

<when_to_ask>
Ask user when: multiple valid approaches, destructive operations, ambiguous intent
Act directly when: request is clear and tools can accomplish it
</when_to_ask>

<tone>
Extremely concise. No preamble or postamble. 1-3 sentences unless detail requested.
</tone>

<examples>
Simple response (no tools needed):
user: what is 2+2?
assistant: {"content": "4", "needsMoreWork": false}

Single tool call:
user: list files in current directory
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "."}}], "content": "", "needsMoreWork": true}

Full loop (tool → result → completion):
user: what files are in src/?
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "src/"}}], "content": "", "needsMoreWork": true}
[tool returns: ["foo.c", "bar.c", "baz.c"]]
assistant: {"content": "foo.c, bar.c, baz.c", "needsMoreWork": false}

Parallel tool calls:
user: read both config.json and package.json
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "config.json"}}, {"name": "read_file", "arguments": {"path": "package.json"}}], "content": "", "needsMoreWork": true}

Error recovery:
user: read data.txt
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "data.txt"}}], "content": "", "needsMoreWork": true}
[tool returns: error - file not found]
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "."}}], "content": "", "needsMoreWork": true}
[tool returns: ["data.json", "config.txt"]]
assistant: {"content": "data.txt not found. Did you mean data.json or config.txt?", "needsMoreWork": false}

Ambiguous request (ask for clarification):
user: delete the files
assistant: {"content": "Which files should I delete? Please specify the files or pattern.", "needsMoreWork": false}
</examples>

<critical_instructions>
These are the most important rules—follow them strictly:
1. PERSISTENCE: Keep working until task is FULLY complete. Only set needsMoreWork: false when done or blocked.
2. NO GUESSING: If uncertain about state, use tools to verify. Never assume or hallucinate results.
3. VERIFY CHANGES: After modifying state, confirm the change succeeded before reporting completion.
4. CIRCUIT BREAKER: After 3 retries of same operation or 10 total rounds, stop and ask user for guidance.
</critical_instructions>`

export const BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

export function getEffectiveSystemPrompt(customSystemPrompt?: string): string {
  if (customSystemPrompt && customSystemPrompt.trim()) {
    return customSystemPrompt.trim()
  }
  return DEFAULT_SYSTEM_PROMPT
}

export const AGENT_MODE_ADDITIONS = `

<agent_mode>
You are in AGENT MODE with full tool result visibility and iterative execution.
- You WILL see tool results and can make follow-up calls
- Continue iterating until task is completely resolved
- Only set needsMoreWork: false when done OR genuinely blocked after trying alternatives
- Verify each step's success before proceeding to the next
</agent_mode>`

export function constructSystemPrompt(
  availableTools: Array<{
    name: string
    description: string
    inputSchema?: any
  }>,
  userGuidelines?: string,
  isAgentMode: boolean = false,
  relevantTools?: Array<{
    name: string
    description: string
    inputSchema?: any
  }>,
  customSystemPrompt?: string,
): string {
  let prompt = getEffectiveSystemPrompt(customSystemPrompt)

  if (isAgentMode) {
    prompt += AGENT_MODE_ADDITIONS
  }

  const formatToolInfo = (
    tools: Array<{ name: string; description: string; inputSchema?: any }>,
  ) => {
    return tools
      .map((tool) => {
        let info = `- ${tool.name}: ${tool.description}`
        if (tool.inputSchema?.properties) {
          const params = Object.entries(tool.inputSchema.properties)
            .map(([key, schema]: [string, any]) => {
              const type = schema.type || "any"
              const required = tool.inputSchema.required?.includes(key)
                ? " (required)"
                : ""
              return `${key}: ${type}${required}`
            })
            .join(", ")
          if (params) {
            info += `\n  Parameters: {${params}}`
          }
        }
        return info
      })
      .join("\n")
  }

  if (availableTools.length > 0) {
    prompt += `\n\nAVAILABLE TOOLS:\n${formatToolInfo(availableTools)}`

    if (
      relevantTools &&
      relevantTools.length > 0 &&
      relevantTools.length < availableTools.length
    ) {
      prompt += `\n\nMOST RELEVANT TOOLS FOR THIS REQUEST:\n${formatToolInfo(relevantTools)}`
    }
  } else {
    prompt += `\n\nNo tools are currently available.`
  }

  // Add user guidelines if provided (with proper section header)
  if (userGuidelines?.trim()) {
    prompt += `\n\nUSER GUIDELINES:\n${userGuidelines.trim()}`
  }
  return prompt
}

/**
 * Construct a compact minimal system prompt that preserves tool and parameter names
 */
export function constructMinimalSystemPrompt(
  availableTools: Array<{
    name: string
    description?: string
    inputSchema?: any
  }>,
  isAgentMode: boolean = false,
  relevantTools?: Array<{
    name: string
    description?: string
    inputSchema?: any
  }>,
): string {
  let prompt = `You are an autonomous AI agent. Keep working until task is fully resolved. If uncertain, verify with tools—don't guess.
Response: {"toolCalls": [...], "content": "...", "needsMoreWork": true|false}
Rules: Use exact tool names/params. Batch independent calls. Verify changes succeeded. Max 3 retries per operation.`
  if (isAgentMode) {
    prompt += " AGENT MODE: You see tool results. Iterate until complete. Only needsMoreWork=false when done or blocked."
  }

  const list = (tools: Array<{ name: string; inputSchema?: any }>) =>
    tools
      .map((t) => {
        const keys = t.inputSchema?.properties
          ? Object.keys(t.inputSchema.properties)
          : []
        const params = keys.join(", ")
        return params ? `- ${t.name}(${params})` : `- ${t.name}()`
      })
      .join("\n")

  if (availableTools?.length) {
    prompt += `\n\nAVAILABLE TOOLS (name(params)):\n${list(availableTools)}`
  } else {
    prompt += `\n\nNo tools are currently available.`
  }

  if (
    relevantTools &&
    relevantTools.length > 0 &&
    availableTools &&
    relevantTools.length < availableTools.length
  ) {
    prompt += `\n\nMOST RELEVANT FOR THIS REQUEST:\n${list(relevantTools)}`
  }

  return prompt
}
