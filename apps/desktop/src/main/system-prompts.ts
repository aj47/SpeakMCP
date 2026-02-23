import { acpSmartRouter } from './acp/acp-smart-router'
import { acpService } from './acp-service'
import { getInternalAgentInfo } from './acp/internal-agent'
import { agentProfileService } from './agent-profile-service'
import type { AgentMemory } from "../shared/types"

import { DEFAULT_SYSTEM_PROMPT } from './system-prompts-default'

export { DEFAULT_SYSTEM_PROMPT }

export const BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

/**
 * Format memories for injection into the system prompt
 * Prioritizes high importance memories and limits count for context budget
 */
function formatMemoriesForPrompt(memories: AgentMemory[], maxMemories: number = 15): string {
  if (!memories || memories.length === 0) return ""

  // Sort by importance (critical > high > medium > low) then by recency
  const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  const sorted = [...memories].sort((a, b) => {
    const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance]
    if (impDiff !== 0) return impDiff
    return b.createdAt - a.createdAt // More recent first
  })

  // Take top N memories
  const selected = sorted.slice(0, maxMemories)
  if (selected.length === 0) return ""

  // Format as single-line entries for maximum compactness
  // Normalize any legacy multi-line content to single line
  return selected.map(mem => `- ${mem.content.replace(/[\r\n]+/g, ' ')}`).join("\n")
}

export function getEffectiveSystemPrompt(customSystemPrompt?: string): string {
  if (customSystemPrompt && customSystemPrompt.trim()) {
    return customSystemPrompt.trim()
  }
  return DEFAULT_SYSTEM_PROMPT
}

export const AGENT_MODE_ADDITIONS = `

AGENT MODE: You can see tool results and make follow-up tool calls. Continue calling tools until the task is completely resolved. If a tool fails, try alternative approaches before giving up.

RESPONDING TO USER:
- Use speakmcp-settings:respond_to_user whenever you want to communicate directly with the user
- On voice interfaces this will be spoken aloud; on messaging channels (mobile, WhatsApp) it will be sent as a message
- Write respond_to_user text naturally and conversationally (no markdown, code blocks, or formatting)
- If respond_to_user is unavailable, provide your final user-facing answer in normal assistant text

SKILLS:
- Skills are optional instruction modules listed below.
- Before using a skill, ALWAYS call speakmcp-settings:load_skill_instructions(skillId). Do not guess a skill's contents from its name/description.

COMPLETION SIGNAL:
- When all requested work is fully complete:
  - If speakmcp-settings:respond_to_user is available, call it with the final user-facing response first
  - Then call speakmcp-settings:mark_work_complete with a concise completion summary (if available)
- If mark_work_complete is not available, provide a complete final user-facing answer directly
- Do not call mark_work_complete while work is still in progress or partially done

AGENT FILE & COMMAND EXECUTION:
- Use speakmcp-settings:execute_command as your primary tool for shell commands, file I/O, and automation
- Read files: execute_command with "cat path/to/file"
- Write files: execute_command with "cat > path/to/file << 'EOF'\\n...content...\\nEOF" or "echo 'content' > file"
- List directories: execute_command with "ls -la path/"
- Create directories: execute_command with "mkdir -p path/to/dir"
- Run scripts: execute_command with "./script.sh" or "python script.py" etc.
- For skills: pass skillId to run commands in the skill's directory automatically

MEMORIES (optional):
- Use speakmcp-settings:save_memory(content, importance) to store durable preferences/patterns (single line, ~80 chars).`

/**
 * Group tools by server and generate a brief description for each server
 */
function getServerSummaries(
  tools: Array<{ name: string; description: string; inputSchema?: any }>,
): Array<{ serverName: string; toolCount: number; toolNames: string[] }> {
  const serverMap = new Map<string, string[]>()

  for (const tool of tools) {
    const serverName = tool.name.includes(":") ? tool.name.split(":")[0] : "unknown"
    const toolName = tool.name.includes(":") ? tool.name.split(":")[1] : tool.name
    if (!serverMap.has(serverName)) {
      serverMap.set(serverName, [])
    }
    serverMap.get(serverName)!.push(toolName)
  }

  return Array.from(serverMap.entries()).map(([serverName, toolNames]) => ({
    serverName,
    toolCount: toolNames.length,
    toolNames,
  }))
}

/**
 * Format tools in a lightweight, server-centric way
 * Shows server names with brief tool listings to reduce token usage
 */
function formatLightweightToolInfo(
  tools: Array<{ name: string; description: string; inputSchema?: any }>,
): string {
  const serverSummaries = getServerSummaries(tools)

  return serverSummaries
    .map((server) => {
      // Show server name and list tools briefly
      const toolList = server.toolNames.slice(0, 5).join(", ")
      const moreCount = server.toolNames.length > 5 ? ` +${server.toolNames.length - 5} more` : ""
      return `- ${server.serverName}: ${toolList}${moreCount}`
    })
    .join("\n")
}

/**
 * Generate ACP routing prompt addition based on available agents.
 * Returns an empty string if no agents are ready.
 */
export function getACPRoutingPromptAddition(): string {
  // Get agents from acpService which has runtime status
  const agentStatuses = acpService.getAgents()

  // Filter to only ready agents
  const readyAgents = agentStatuses.filter(a => a.status === 'ready')

  if (readyAgents.length === 0) {
    return ''
  }

  // Format agents for the smart router
  const formattedAgents = readyAgents.map(a => ({
    definition: {
      name: a.config.name,
      displayName: a.config.displayName,
      description: a.config.description || '',
    },
    status: 'ready' as const,
    activeRuns: 0,
  }))

  return acpSmartRouter.generateDelegationPromptAddition(formattedAgents)
}

/**
 * Generate prompt addition for the internal agent.
 * This instructs the agent on when and how to use the internal agent for parallel work.
 */
export function getSubSessionPromptAddition(): string {
  const info = getInternalAgentInfo()

  return `
INTERNAL AGENT: Use \`delegate_to_agent\` with \`agentName: "internal"\` to spawn parallel sub-agents. Batch multiple calls for efficiency.
- USE FOR: Independent parallel tasks (analyzing multiple files, researching different topics, divide-and-conquer)
- AVOID FOR: Sequential dependencies, shared state/file conflicts, simple tasks
- LIMITS: Max depth ${info.maxRecursionDepth}, max ${info.maxConcurrent} concurrent per parent
`.trim()
}

/**
 * Generate prompt addition for available agents (delegation-targets).
 * These are agents that can be delegated to via delegate_to_agent.
 * Similar format to tools/skills for easy discoverability.
 */
export function getAgentsPromptAddition(): string {
  // Get enabled delegation-target profiles
  const delegationTargets = agentProfileService.getByRole('delegation-target')
    .filter(p => p.enabled)

  if (delegationTargets.length === 0) {
    return ''
  }

  // Format agents in a compact, discoverable format similar to tools/skills
  const agentsList = delegationTargets.map(p => {
    return `- **${p.name}**: ${p.description || p.displayName || 'No description'}`
  }).join('\n')

  return `
AVAILABLE AGENTS (${delegationTargets.length}):
${agentsList}

To delegate: \`delegate_to_agent(agentName: "agent_name", task: "...")\`
When user mentions an agent by name (e.g., "ask joker...", "have coder..."), delegate to that agent.
`.trim()
}

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
  agentProperties?: Record<string, string>,
  memories?: AgentMemory[],
): string {
  let prompt = getEffectiveSystemPrompt(customSystemPrompt)

  if (isAgentMode) {
    prompt += AGENT_MODE_ADDITIONS

    // Add ACP agent delegation information if agents are available
    const acpPromptAddition = getACPRoutingPromptAddition()
    if (acpPromptAddition) {
      prompt += '\n\n' + acpPromptAddition
    }

    // Add agents (delegation-targets) in a discoverable format
    const agentsAddition = getAgentsPromptAddition()
    if (agentsAddition) {
      prompt += '\n\n' + agentsAddition
    }

    // Add internal sub-session instructions (always available in agent mode)
    prompt += '\n\n' + getSubSessionPromptAddition()
  }

  // Add agent skills instructions if provided
  // Skills are injected early in the prompt so they can influence tool usage behavior
  if (skillsInstructions?.trim()) {
    prompt += `\n\n${skillsInstructions.trim()}`
  }

  // Add memories if provided (for agent mode context)
  // Memories are saved insights from previous sessions that help the agent
  // understand user preferences, past decisions, and important context
  const formattedMemories = formatMemoriesForPrompt(memories || [])
  if (formattedMemories) {
    prompt += `\n\nMEMORIES FROM PREVIOUS SESSIONS:\nThese are important insights and learnings saved from previous interactions. Use them to inform your decisions and provide context-aware assistance.\n\n${formattedMemories}`
  }

  // Format full tool info for relevant tools only (when provided)
  const formatFullToolInfo = (
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
    // Use lightweight format for ALL tools to reduce token usage
    // Full schemas are still available via native function calling
    prompt += `\n\nAVAILABLE MCP SERVERS (${availableTools.length} tools total):\n${formatLightweightToolInfo(availableTools)}`
    prompt += `\n\nTo discover tools: use speakmcp-settings:list_server_tools(serverName) to see all tools in a server, or speakmcp-settings:get_tool_schema(toolName) for full parameter details.`

    // If relevant tools are identified, show them with full details
    if (
      relevantTools &&
      relevantTools.length > 0 &&
      relevantTools.length < availableTools.length
    ) {
      prompt += `\n\nMOST RELEVANT TOOLS FOR THIS REQUEST:\n${formatFullToolInfo(relevantTools)}`
    }
  } else {
    prompt += `\n\nNo tools are currently available.`
  }

  // Add user guidelines if provided (with proper section header)
  if (userGuidelines?.trim()) {
    prompt += `\n\nUSER GUIDELINES:\n${userGuidelines.trim()}`
  }

  // Add agent properties if provided (dynamic key-value pairs)
  if (agentProperties && Object.keys(agentProperties).length > 0) {
    const propertiesText = Object.entries(agentProperties)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n\n')
    prompt += `\n\nAGENT PROPERTIES:\n${propertiesText}`
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
  skillsIndex?: string,
): string {
  // IMPORTANT: This prompt is a last-resort fallback used when the full system prompt
  // cannot fit in the model context window. It must preserve the core policies:
  // - Use tools proactively to complete tasks
  // - Work iteratively until goals are fully achieved
  // - Preserve skills discoverability (IDs) so skills aren't silently dropped
  let prompt =
    "You are an autonomous AI assistant that uses tools to complete tasks. Work iteratively until goals are fully achieved. " +
    "Use tools proactively - prefer tools over asking users for information you can gather yourself. " +
    "When calling tools, use exact tool names and parameter keys. Be concise. Batch independent tool calls when possible."

  if (isAgentMode) {
    prompt += " Agent mode: continue calling tools until the task is completely resolved. If a tool fails, try alternative approaches before giving up."
  }

  // Preserve skills policy + IDs under Tier-3 shrinking.
  prompt +=
    " Skills are optional instruction modules. Before using a skill, call speakmcp-settings:load_skill_instructions with { skillId }."

  if (skillsIndex?.trim()) {
    prompt += `\n\nAVAILABLE AGENT SKILLS (IDs):\n${skillsIndex.trim()}`
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
