import { DiscoveryContext, MCPToolSummary, SkillSummary } from '@shared/file-discovery-types'

export const DEFAULT_SYSTEM_PROMPT = `You are an autonomous AI assistant that uses tools to complete tasks. Work iteratively until goals are fully achieved.

TOOL USAGE:
- Use the provided tools to accomplish tasks - call them directly using the native function calling interface
- Follow tool schemas exactly with all required parameters
- Use exact tool names from the available list (including server prefixes like "server:tool_name")
- Prefer tools over asking users for information you can gather yourself
- Try tools before refusing—only refuse after genuine attempts fail
- If browser tools are available and the task involves web services, use them proactively
- You can call multiple tools in a single response for efficiency

WHEN TO ASK: Multiple valid approaches exist, sensitive/destructive operations, or ambiguous intent
WHEN TO ACT: Request is clear and tools can accomplish it directly

TONE: Be extremely concise. No preamble or postamble. Prefer 1-3 sentences unless detail is requested.`

export const BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

export function getEffectiveSystemPrompt(customSystemPrompt?: string): string {
  if (customSystemPrompt && customSystemPrompt.trim()) {
    return customSystemPrompt.trim()
  }
  return DEFAULT_SYSTEM_PROMPT
}

export const AGENT_MODE_ADDITIONS = `

AGENT MODE: You can see tool results and make follow-up tool calls. Continue calling tools until the task is completely resolved. If a tool fails, try alternative approaches before giving up.`

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
  skillsInstructions?: string,
): string {
  let prompt = getEffectiveSystemPrompt(customSystemPrompt)

  if (isAgentMode) {
    prompt += AGENT_MODE_ADDITIONS
  }

  // Add agent skills instructions if provided
  // Skills are injected early in the prompt so they can influence tool usage behavior
  if (skillsInstructions?.trim()) {
    prompt += `\n\n${skillsInstructions.trim()}`
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
 * Used for context summarization when full prompt is too long
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
  let prompt = "You are an MCP-capable assistant. Use exact tool names and parameter keys. Be concise. Call multiple tools at once when possible."
  if (isAgentMode) {
    prompt += " Continue calling tools until the task is complete."
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
    prompt += `\n\nAVAILABLE TOOLS:\n${list(availableTools)}`
  } else {
    prompt += `\n\nNo tools are currently available.`
  }

  if (
    relevantTools &&
    relevantTools.length > 0 &&
    availableTools &&
    relevantTools.length < availableTools.length
  ) {
    prompt += `\n\nMOST RELEVANT:\n${list(relevantTools)}`
  }

  return prompt
}

/**
 * Format tool summaries for compact system prompt (names only)
 */
function formatToolSummaries(summaries: MCPToolSummary[]): string {
  return summaries
    .filter(s => s.status === 'connected')
    .map(s => `- ${s.serverName}: ${s.toolNames.join(', ')}`)
    .join('\n')
}

/**
 * Format skill summaries for system prompt
 */
function formatSkillSummaries(skills: SkillSummary[]): string {
  return skills
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n')
}

/**
 * Construct a discovery-aware system prompt that uses file hints
 * This reduces token usage by only including tool names, not full descriptions
 */
export function constructDiscoverySystemPrompt(
  context: DiscoveryContext,
  userGuidelines?: string,
  isAgentMode: boolean = false,
  customSystemPrompt?: string,
  skillsInstructions?: string,
): string {
  let prompt = getEffectiveSystemPrompt(customSystemPrompt)

  if (isAgentMode) {
    prompt += AGENT_MODE_ADDITIONS
  }

  // Add agent skills instructions if provided
  // Skills are injected early in the prompt so they can influence tool usage behavior
  if (skillsInstructions?.trim()) {
    prompt += `\n\n${skillsInstructions.trim()}`
  }

  // Add discovery folder hint
  prompt += `\n\nDYNAMIC CONTEXT DISCOVERY:`
  prompt += `\nTool and skill details are available as files in: ${context.discoveryFolderPath}`
  prompt += `\nRead {server}/{tool}.json for full tool schemas when needed.`

  // Add compact tool summaries (names only)
  if (context.mcpToolSummaries.length > 0) {
    prompt += `\n\nAVAILABLE MCP SERVERS AND TOOLS:\n${formatToolSummaries(context.mcpToolSummaries)}`
  }

  // Add skill summaries with clear usage instructions
  if (context.skillSummaries.length > 0) {
    prompt += `\n\nAVAILABLE SKILLS:\n${formatSkillSummaries(context.skillSummaries)}`
    prompt += `\n\nUSING SKILLS:`
    prompt += `\nWhen a user request matches a skill's description, you MUST:`
    prompt += `\n1. Read the skill file: ${context.skillsFolderPath}/{skill-id}/SKILL.md`
    prompt += `\n2. Follow the instructions in the skill file exactly`
    prompt += `\n3. Use any scripts or tools mentioned in the skill`
  }

  // Add active profile hint
  if (context.activeProfilePath) {
    prompt += `\n\nACTIVE PROFILE: ${context.activeProfilePath}`
  }

  // Add user guidelines
  if (userGuidelines?.trim()) {
    prompt += `\n\nUSER GUIDELINES:\n${userGuidelines.trim()}`
  }

  return prompt
}

/**
 * Get discovery context hint for the agent
 * This tells the agent where to find detailed information
 */
export function getDiscoveryHint(discoveryFolderPath: string): string {
  return `For detailed tool schemas, read files from ${discoveryFolderPath}/mcp-tools/{server}/{tool}.json
For skill instructions, read ${discoveryFolderPath}/skills/{skill-id}/SKILL.md
For profile details, read ${discoveryFolderPath}/profiles/{profile}.md`
}
