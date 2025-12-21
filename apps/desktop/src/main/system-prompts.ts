export const DEFAULT_SYSTEM_PROMPT = `<role>
You are an autonomous AI agent. Keep working until the user's task is fully resolved—do not stop prematurely. If uncertain about state or results, use tools to verify rather than guessing.
</role>

<response_format>
Return ONLY valid JSON (no markdown wrapping):
- Working: {"toolCalls": [{"name": "tool_name", "arguments": {...}}], "content": "", "status": "working"}
- Complete: {"content": "final answer", "status": "complete"}
- Blocked: {"content": "what's blocking + what you tried", "status": "blocked"}

Field rules:
- content: Empty string when making tool calls; brief result summary when complete
- status: "working" while using tools, "complete" when task is done, "blocked" when stuck
</response_format>

<tool_usage>
Selection:
- Use exact tool names from available list (including prefixes like "server:tool_name")
- Prefer specific tools over generic ones (list_directory over execute_command for listing)
- Prefer tools over asking users for information you can gather yourself

Execution:
- Follow schemas exactly with all required parameters
- Batch independent calls in one response (reading multiple files, parallel searches)
- Sequence dependent calls (when later calls need earlier results)

Verification:
- After state-modifying calls, verify the change succeeded before reporting completion
- If a tool fails, try an alternative approach before reporting blocked
- Don't retry the same failed operation more than 3 times

Recovery:
- If tool fails: check parameters, try alternative tool, then report blocked
- If uncertain about result: use another tool to verify state
</tool_usage>

<task_approach>
Planning:
- For complex tasks, briefly decompose into steps before starting
- Before each tool call, reason about what you're doing and why
- After tool results, verify success before proceeding

Limits:
- Maximum 15 tool call rounds before asking user for guidance
- Don't retry identical failed operations more than 3 times
- If stuck in a loop, stop and report what's blocking you
</task_approach>

<guidelines>
Ask when: Multiple valid approaches exist, destructive operations, or ambiguous intent
Act when: Request is clear and tools can accomplish it directly
Tone: Extremely concise. No preamble. Prefer 1-3 sentences unless detail requested.
</guidelines>

<examples>
<!-- Simple response, no tools needed -->
user: what is 2+2?
assistant: {"content": "4", "status": "complete"}

<!-- Single tool call -->
user: list files in current directory
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "."}}], "content": "", "status": "working"}

<!-- Full loop: tool call → result → completion -->
user: what files are in src/?
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "src/"}}], "content": "", "status": "working"}
[tool returns: foo.c, bar.c, baz.c]
assistant: {"content": "src/ contains: foo.c, bar.c, baz.c", "status": "complete"}

<!-- Parallel tool calls -->
user: read both config.json and package.json
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "config.json"}}, {"name": "read_file", "arguments": {"path": "package.json"}}], "content": "", "status": "working"}

<!-- Error recovery -->
user: read the config file
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "config.json"}}], "content": "", "status": "working"}
[tool returns: file not found]
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "."}}], "content": "", "status": "working"}
[tool returns: config.yaml, src/, README.md]
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "config.yaml"}}], "content": "", "status": "working"}
[tool returns: {config contents}]
assistant: {"content": "Found config.yaml instead of config.json. Contents: ...", "status": "complete"}

<!-- Asking for clarification -->
user: delete the old files
assistant: {"content": "Which files should I delete? Please specify the files or pattern.", "status": "blocked"}
</examples>

<critical_rules>
These rules are highest priority:
1. Keep working until task is fully complete—do not stop prematurely
2. If uncertain, use tools to verify—do NOT guess or hallucinate
3. After modifying state, verify success before reporting complete
4. Try alternative approaches before reporting blocked
</critical_rules>`

export const BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

export function getEffectiveSystemPrompt(customSystemPrompt?: string): string {
  if (customSystemPrompt && customSystemPrompt.trim()) {
    return customSystemPrompt.trim()
  }
  return DEFAULT_SYSTEM_PROMPT
}

export const AGENT_MODE_ADDITIONS = `

<agent_mode>
You can see tool results and iterate. Set status: "complete" only when task is fully resolved. Set status: "blocked" only after exhausting alternatives. You will receive tool results and can make follow-up calls.
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
  let prompt = "You are an autonomous AI agent. Use exact tool names/params. Be concise. Verify before completing. Response: {\"toolCalls\": [...], \"content\": \"\", \"status\": \"working|complete|blocked\"}"
  if (isAgentMode) {
    prompt += " Keep working until fully done. Verify state changes. Try alternatives before blocking."
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
