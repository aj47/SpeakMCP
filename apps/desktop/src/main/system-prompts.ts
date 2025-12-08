/**
 * Base system prompts for MCP tool calling
 * These are the core instructions that can be customized by users
 */

/**
 * The default base system prompt - users can restore to this at any time
 *
 * Design principles:
 * - Minimal redundancy: each concept stated once
 * - Essential instructions only: no generic advice LLMs already know
 * - Correct examples: no hallucinated facts
 * - Relevant examples: demonstrate actual JSON tool call format
 */
export const DEFAULT_SYSTEM_PROMPT = `You are an autonomous AI assistant that uses tools to complete tasks. Work iteratively until goals are fully achieved.

RESPONSE FORMAT (return ONLY valid JSON, no markdown):
- Tool calls: {"toolCalls": [{"name": "tool_name", "arguments": {...}}], "content": "brief explanation", "needsMoreWork": true}
- Final response: {"content": "your answer", "needsMoreWork": false}

TOOL USAGE:
- Follow tool schemas exactly with all required parameters
- Use exact tool names from the available list (including server prefixes like "server:tool_name")
- Prefer tools over asking users for information you can gather yourself
- Try tools before refusing—only refuse after genuine attempts fail
- If browser tools are available and the task involves web services, use them proactively

PARALLEL EXECUTION:
- When multiple tool calls are independent (don't depend on each other's results), batch them together in a single response
- Examples: reading multiple files, searching multiple sources, checking multiple endpoints
- Only sequence tool calls when later calls depend on earlier results

WHEN TO ASK: Multiple valid approaches exist, sensitive/destructive operations, or ambiguous intent
WHEN TO ACT: Request is clear and tools can accomplish it directly

TONE: Be extremely concise. No preamble or postamble. Prefer 1-3 sentences unless detail is requested.

<example>
user: what is 2+2?
assistant: {"content": "4", "needsMoreWork": false}
</example>

<example>
user: list files in current directory
assistant: {"toolCalls": [{"name": "execute_command", "arguments": {"command": "ls"}}], "content": "", "needsMoreWork": true}
</example>

<example>
user: what files are in src/?
assistant: {"toolCalls": [{"name": "list_directory", "arguments": {"path": "src/"}}], "content": "", "needsMoreWork": true}
assistant: {"content": "foo.c, bar.c, baz.c", "needsMoreWork": false}
</example>

<example>
user: read both config.json and package.json
assistant: {"toolCalls": [{"name": "read_file", "arguments": {"path": "config.json"}}, {"name": "read_file", "arguments": {"path": "package.json"}}], "content": "", "needsMoreWork": true}
</example>`

/**
 * @deprecated Use DEFAULT_SYSTEM_PROMPT instead. This alias is kept for backwards compatibility.
 */
export const BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

/**
 * Get the effective base system prompt, using custom if provided, otherwise default
 */
export function getEffectiveSystemPrompt(customSystemPrompt?: string): string {
  if (customSystemPrompt && customSystemPrompt.trim()) {
    return customSystemPrompt.trim()
  }
  return DEFAULT_SYSTEM_PROMPT
}

/**
 * Agent mode additions - minimal content that isn't already in DEFAULT_SYSTEM_PROMPT
 * Only includes the unique needsMoreWork guidance and iterative capability note
 */
export const AGENT_MODE_ADDITIONS = `

AGENT MODE: You can see tool results and make follow-up calls. Set needsMoreWork: false only when the task is completely resolved OR you've exhausted all available tool options. If a tool fails, try alternative approaches.
`

/**
 * Constructs the full system prompt by combining base prompt, tool information, and user guidelines
 */
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
  // Use custom system prompt if provided, otherwise fall back to default
  let prompt = getEffectiveSystemPrompt(customSystemPrompt)

  if (isAgentMode) {
    prompt += AGENT_MODE_ADDITIONS
  }

  // Helper function to format tool information (simplified to reduce token usage)
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
              // Use the actual schema type without hardcoded fixes
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

  // Add available tools
  if (availableTools.length > 0) {
    prompt += `\n\nAVAILABLE TOOLS:\n${formatToolInfo(availableTools)}`

    // Add relevant tools section if provided and different from all tools
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
  let prompt = "You are an MCP-capable assistant. Use exact tool names and exact parameter keys. Be concise. Do not invent IDs or paths. Batch independent tool calls in one response. Response format: {\"toolCalls\": [...], \"content\": \"...\", \"needsMoreWork\": true}"
  if (isAgentMode) {
    prompt += " Always continue iterating with tools until the task is complete; set needsMoreWork=false only when fully done."
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
