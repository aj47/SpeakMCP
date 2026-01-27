/**
 * System Prompt Construction for SpeakMCP Server
 * Simplified version of desktop's system-prompts.ts without ACP dependencies
 */

import type { AgentMemory } from '../types'

export const DEFAULT_SYSTEM_PROMPT = `You are an autonomous AI assistant that uses tools to complete tasks. Work iteratively until goals are fully achieved.

TOOL USAGE:
- Use the provided tools to accomplish tasks - call them directly using the native function calling interface
- Follow tool schemas exactly with all required parameters
- Use exact tool names from the available list (including server prefixes like "server:tool_name")
- Prefer tools over asking users for information you can gather yourself
- Try tools before refusing—only refuse after genuine attempts fail
- If browser tools are available and the task involves web services, use them proactively
- You can call multiple tools in a single response for efficiency

TOOL RELIABILITY:
- Check tool schemas to discover optional parameters before use
- Work incrementally - verify each step before continuing
- On failure: read the error, don't retry the same call blindly
- After 2-3 failures: try a different approach or ask the user
- STRONGLY RECOMMENDED: When having issues with a tool, use speakmcp-settings:get_tool_schema(toolName) to read the full specification before retrying

SHELL COMMANDS & FILE OPERATIONS:
- Use speakmcp-settings:execute_command for running shell commands, scripts, file operations, and automation
- For skill-related tasks, pass the skillId to run commands in that skill's directory
- Common file operations: cat (read), echo/printf with redirection (write), mkdir -p (create dirs), ls (list), rm (delete)
- Supports any shell command: git, npm, python, curl, etc.

WHEN TO ASK: Multiple valid approaches exist, sensitive/destructive operations, or ambiguous intent
WHEN TO ACT: Request is clear and tools can accomplish it directly

TONE: Be extremely concise. No preamble or postamble. Prefer 1-3 sentences unless detail is requested.`

export const BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

export const AGENT_MODE_ADDITIONS = `

AGENT MODE: You can see tool results and make follow-up tool calls. Continue calling tools until the task is completely resolved. If a tool fails, try alternative approaches before giving up.

AGENT FILE & COMMAND EXECUTION:
- Use speakmcp-settings:execute_command as your primary tool for shell commands, file I/O, and automation
- Read files: execute_command with "cat path/to/file"
- Write files: execute_command with "cat > path/to/file << 'EOF'\\n...content...\\nEOF" or "echo 'content' > file"
- List directories: execute_command with "ls -la path/"
- Create directories: execute_command with "mkdir -p path/to/dir"
- Run scripts: execute_command with "./script.sh" or "python script.py" etc.
- For skills: pass skillId to run commands in the skill's directory automatically`

/**
 * Format memories for injection into the system prompt
 * Prioritizes high importance memories and limits count for context budget
 */
function formatMemoriesForPrompt(memories: AgentMemory[], maxMemories: number = 15): string {
  if (!memories || memories.length === 0) return ""

  // Sort by importance (critical > high > medium > low) then by recency
  const importanceOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const sorted = [...memories].sort((a, b) => {
    const impDiff = (importanceOrder[a.importance] || 3) - (importanceOrder[b.importance] || 3)
    if (impDiff !== 0) return impDiff
    return b.createdAt - a.createdAt // More recent first
  })

  // Take top N memories
  const selected = sorted.slice(0, maxMemories)
  if (selected.length === 0) return ""

  // Format as single-line entries for maximum compactness
  return selected.map(mem => `- ${mem.content.replace(/[\r\n]+/g, ' ')}`).join("\n")
}

export function getEffectiveSystemPrompt(customSystemPrompt?: string): string {
  if (customSystemPrompt && customSystemPrompt.trim()) {
    return customSystemPrompt.trim()
  }
  return DEFAULT_SYSTEM_PROMPT
}

/**
 * Group tools by server and generate a brief description for each server
 */
function getServerSummaries(
  tools: Array<{ name: string; description: string; inputSchema?: unknown }>,
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
 * Format available tools as a concise list organized by server
 */
function formatAvailableTools(
  tools: Array<{ name: string; description: string; inputSchema?: unknown }>,
): string {
  const serverSummaries = getServerSummaries(tools)

  if (serverSummaries.length === 0) {
    return "No tools available."
  }

  const lines: string[] = ["AVAILABLE TOOLS:"]
  for (const server of serverSummaries) {
    lines.push(`  ${server.serverName} (${server.toolCount} tools): ${server.toolNames.join(", ")}`)
  }

  return lines.join("\n")
}

/**
 * Construct the complete system prompt for the agent
 */
export function constructSystemPrompt(
  availableTools: Array<{ name: string; description: string; inputSchema?: unknown }>,
  userGuidelines?: string,
  isAgentMode: boolean = false,
  errorContext?: string,
  customSystemPrompt?: string,
  skillsInstructions?: string,
  personaProperties?: Record<string, string>,
  memories?: AgentMemory[],
): string {
  const parts: string[] = []

  // Start with base system prompt
  parts.push(getEffectiveSystemPrompt(customSystemPrompt))

  // Add agent mode additions if in agent mode
  if (isAgentMode) {
    parts.push(AGENT_MODE_ADDITIONS)
  }

  // Add available tools section
  if (availableTools.length > 0) {
    parts.push("")
    parts.push(formatAvailableTools(availableTools))
  }

  // Add user guidelines if provided
  if (userGuidelines && userGuidelines.trim()) {
    parts.push("")
    parts.push("USER GUIDELINES:")
    parts.push(userGuidelines.trim())
  }

  // Add skills instructions if provided
  if (skillsInstructions && skillsInstructions.trim()) {
    parts.push("")
    parts.push("SKILLS:")
    parts.push(skillsInstructions.trim())
  }

  // Add persona properties if provided
  if (personaProperties && Object.keys(personaProperties).length > 0) {
    parts.push("")
    parts.push("PERSONA CONTEXT:")
    for (const [key, value] of Object.entries(personaProperties)) {
      parts.push(`  ${key}: ${value}`)
    }
  }

  // Add memories if provided
  if (memories && memories.length > 0) {
    const formattedMemories = formatMemoriesForPrompt(memories)
    if (formattedMemories) {
      parts.push("")
      parts.push("RELEVANT MEMORIES:")
      parts.push(formattedMemories)
    }
  }

  // Add error context if provided (for retry scenarios)
  if (errorContext && errorContext.trim()) {
    parts.push("")
    parts.push("PREVIOUS ERROR CONTEXT:")
    parts.push(errorContext.trim())
  }

  return parts.join("\n")
}

