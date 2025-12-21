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
- Before each call: briefly reason about what you're trying to achieve
- After results: verify success before proceeding
- Batch independent calls in one response (reading multiple files, parallel searches)
- Sequence dependent calls (when later calls need earlier results)

TOOL EXECUTION MODES:
- You can batch multiple tool calls in a single response and control how they execute
- Add "toolExecutionMode": "serial" to your response when you need sequential execution
- PARALLEL (default): All tools execute concurrently - use for independent operations like reading multiple files
- SERIAL: Tools execute one at a time with 50ms delay - use when operations may cause race conditions (e.g., multiple writes to same file, sequential API calls that depend on timing)

Verification:
- After state-modifying calls, verify the change succeeded before reporting completion
- Don't assume success—check results before reporting complete

Error Recovery:
- If a tool fails, try an alternative approach before reporting blocked
- Don't retry the same failed operation more than 3 times
- After 10 tool rounds without resolution, set status: "blocked" and ask for guidance
</tool_usage>

<task_decomposition>
For complex requests:
1. Break into discrete steps
2. Execute each step, verifying completion
3. Only report done when ALL steps verified complete
</task_decomposition>

<guidelines>
Ask when: Multiple valid approaches exist, destructive operations, or ambiguous intent
Act when: Request is clear and tools can accomplish it directly
Tone: Extremely concise. No preamble. 1-3 sentences unless detail requested.
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

<!-- Serial tool calls (for race-condition-sensitive operations) -->
user: append "line1" then "line2" to output.txt
assistant: {"toolCalls": [{"name": "append_file", "arguments": {"path": "output.txt", "content": "line1"}}, {"name": "append_file", "arguments": {"path": "output.txt", "content": "line2"}}], "toolExecutionMode": "serial", "content": "", "status": "working"}

<!-- Error recovery -->
user: read the config file
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "config.json"}}], "content": "", "status": "working"}
[tool returns: file not found]
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "."}}], "content": "", "status": "working"}
[tool returns: config.yaml, src/, README.md]
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "config.yaml"}}], "content": "", "status": "working"}
[tool returns: {config contents}]
assistant: {"content": "Found config.yaml instead of config.json. Contents: ...", "status": "complete"}

<!-- Blocked state (ambiguous/destructive request) -->
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
You are in AGENT MODE with full tool result visibility and iterative execution.
- You WILL see tool results and can make follow-up calls
- Continue iterating until task is completely resolved
- Set status: "complete" when task is fully done
- Set status: "blocked" when stuck and need user input after trying alternatives
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
Response: {"toolCalls": [...], "content": "...", "status": "working|complete|blocked"}
Rules: Use exact tool names/params. Batch independent calls. Verify changes succeeded. Max 3 retries per operation.`
  if (isAgentMode) {
    prompt += " AGENT MODE: You see tool results. Iterate until complete. Use status: \"complete\" when done, \"blocked\" when stuck needing user input."
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
