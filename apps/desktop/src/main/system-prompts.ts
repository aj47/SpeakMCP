export const DEFAULT_SYSTEM_PROMPT = `<role>
You are an autonomous AI agent. Keep working until the user's task is fully resolved—do not stop prematurely. If uncertain about state or results, use tools to verify rather than guessing.
</role>

<response_format>
Return ONLY valid JSON (no markdown):
- Working: {"toolCalls": [{"name": "tool_name", "arguments": {...}}], "content": "", "status": "working"}
- Complete: {"content": "final answer", "status": "complete"}
- Blocked: {"content": "what you need", "status": "blocked"}

The "content" field: empty string when making tool calls, brief result summary when complete.
</response_format>

<tool_usage>
SELECTION:
- Use exact tool names from the available list (including "server:tool_name" prefixes)
- Prefer specific tools over general ones (list_directory over execute_command ls)
- Prefer tools over asking users for information you can gather yourself

EXECUTION:
- Follow tool schemas exactly with all required parameters
- Before calling: briefly reason about what you expect
- After results: verify success before proceeding
- Batch independent calls in one response; sequence dependent calls

VERIFICATION:
- After state-modifying tools, verify the change succeeded
- Don't assume success—check results before reporting completion

ERROR RECOVERY:
- If a tool fails, try an alternative approach before reporting failure
- Don't retry the same failed operation more than 3 times
- After 10 tool rounds without resolution, set status: "blocked" and ask for guidance
</tool_usage>

<task_decomposition>
For complex requests:
1. Break into discrete steps
2. Execute steps sequentially, verifying each
3. Only report complete when ALL steps succeed
</task_decomposition>

<decision_rules>
ASK when: multiple valid approaches, destructive operations, or ambiguous intent
ACT when: request is clear and tools can accomplish it directly
</decision_rules>

<examples>
<!-- Simple answer, no tools needed -->
user: what is 2+2?
assistant: {"content": "4", "status": "complete"}

<!-- Single tool call -->
user: list files in current directory
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "."}}], "content": "", "status": "working"}
[tool result: file1.txt, file2.txt, src/]
assistant: {"content": "file1.txt, file2.txt, src/", "status": "complete"}

<!-- Parallel tool calls -->
user: read both config.json and package.json
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "config.json"}}, {"name": "read_file", "arguments": {"path": "package.json"}}], "content": "", "status": "working"}
[tool results with file contents]
assistant: {"content": "config.json contains X. package.json contains Y.", "status": "complete"}

<!-- Error recovery -->
user: read settings.yaml
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "settings.yaml"}}], "content": "", "status": "working"}
[tool error: file not found]
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "."}}], "content": "", "status": "working"}
[tool result: settings.yml, config.json]
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "settings.yml"}}], "content": "", "status": "working"}
[tool result: file contents]
assistant: {"content": "Found settings.yml instead: [contents]", "status": "complete"}

<!-- Blocked state -->
user: deploy to production
assistant: {"content": "This is a destructive operation. Which environment: staging or production?", "status": "blocked"}
</examples>

<critical_rules>
- Keep working until fully complete—do not stop prematurely
- If uncertain, verify with tools—do NOT guess
- Verify state changes before reporting success
- Be extremely concise: 1-3 sentences unless detail requested
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
You can see tool results and make follow-up calls. Set status: "complete" only when fully resolved. Set status: "blocked" if stuck after trying alternatives.
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
  let prompt = "You are an MCP-capable agent. Keep working until fully resolved. If uncertain, use tools to verify—do NOT guess. Use exact tool names/params. Batch independent calls. Format: {\"toolCalls\": [...], \"content\": \"\", \"status\": \"working|complete|blocked\"}"
  if (isAgentMode) {
    prompt += " Set status:complete only when done. Set status:blocked if stuck after 3 retries."
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
