/**
 * Dynamic Tool Filtering
 * 
 * Reduces token overhead by filtering tools based on the current task context.
 * Instead of sending all 64 tools (~14K tokens), we send only relevant ones.
 */

import type { MCPTool } from "./mcp-service"
import { isDebugTools, logTools } from "./debug"

// Maximum number of tools to send to LLM to manage token overhead
// 64 tools × ~225 tokens/tool = 14,400 tokens
// 20 tools × ~225 tokens/tool = 4,500 tokens (saves ~10K tokens per call)
export const MAX_TOOLS_PER_CALL = 20

// Tools that should always be included regardless of context
const ALWAYS_INCLUDE_TOOLS = new Set<string>([
  // Add any critical tools that should always be available
])

// Tool categories for smarter filtering
const TOOL_CATEGORIES: Record<string, string[]> = {
  browser: ["playwriter:", "browser:", "web:", "page:"],
  filesystem: ["fs:", "file:", "read:", "write:", "directory:"],
  git: ["git:", "github:", "repo:"],
  communication: ["slack:", "email:", "whatsapp:", "message:"],
  search: ["search:", "find:", "query:"],
  code: ["code:", "edit:", "refactor:", "lint:"],
}

/**
 * Extract keywords from user transcript for matching
 */
function extractKeywords(transcript: string): string[] {
  const lower = transcript.toLowerCase()
  const words = lower.split(/\s+/)
  
  // Add explicit action words
  const keywords: string[] = []
  
  if (lower.includes("browse") || lower.includes("website") || lower.includes("page") || lower.includes("click") || lower.includes("screenshot")) {
    keywords.push("browser", "playwriter", "web")
  }
  if (lower.includes("file") || lower.includes("read") || lower.includes("write") || lower.includes("directory") || lower.includes("folder")) {
    keywords.push("filesystem", "file", "fs")
  }
  if (lower.includes("git") || lower.includes("commit") || lower.includes("push") || lower.includes("pull") || lower.includes("branch")) {
    keywords.push("git", "github", "repo")
  }
  if (lower.includes("message") || lower.includes("send") || lower.includes("slack") || lower.includes("whatsapp") || lower.includes("email")) {
    keywords.push("communication", "message", "slack", "whatsapp")
  }
  if (lower.includes("search") || lower.includes("find") || lower.includes("look for") || lower.includes("query")) {
    keywords.push("search", "find", "query")
  }
  if (lower.includes("code") || lower.includes("edit") || lower.includes("refactor") || lower.includes("fix")) {
    keywords.push("code", "edit")
  }
  
  // Add raw words as fallback
  keywords.push(...words.filter(w => w.length > 3))
  
  return [...new Set(keywords)]
}

/**
 * Score a tool based on relevance to the current context
 */
function scoreTool(tool: MCPTool, keywords: string[], recentToolNames: string[]): number {
  let score = 0
  const toolNameLower = tool.name.toLowerCase()
  const descLower = (tool.description || "").toLowerCase()
  
  // High score if tool was recently used (context continuity)
  if (recentToolNames.includes(tool.name)) {
    score += 100
  }
  
  // Always-include tools get high priority
  if (ALWAYS_INCLUDE_TOOLS.has(tool.name)) {
    score += 200
  }
  
  // Check keyword matches in tool name
  for (const keyword of keywords) {
    if (toolNameLower.includes(keyword)) {
      score += 50
    }
    if (descLower.includes(keyword)) {
      score += 20
    }
  }
  
  // Check category matches
  for (const [category, prefixes] of Object.entries(TOOL_CATEGORIES)) {
    if (keywords.includes(category)) {
      for (const prefix of prefixes) {
        if (toolNameLower.startsWith(prefix)) {
          score += 40
        }
      }
    }
  }
  
  return score
}

export interface ToolFilterOptions {
  /** Current user request/transcript */
  transcript: string
  /** Tools executed in recent conversation history */
  recentToolNames?: string[]
  /** Maximum tools to return */
  maxTools?: number
  /** Force include specific tools */
  forceInclude?: string[]
}

export interface ToolFilterResult {
  tools: MCPTool[]
  filtered: boolean
  originalCount: number
  filteredCount: number
  reason?: string
}

/**
 * Filter tools based on task context to reduce token overhead
 */
export function filterToolsForContext(
  availableTools: MCPTool[],
  options: ToolFilterOptions
): ToolFilterResult {
  const maxTools = options.maxTools ?? MAX_TOOLS_PER_CALL
  
  // If already under limit, no filtering needed
  if (availableTools.length <= maxTools) {
    return {
      tools: availableTools,
      filtered: false,
      originalCount: availableTools.length,
      filteredCount: availableTools.length,
    }
  }
  
  const keywords = extractKeywords(options.transcript)
  const recentTools = options.recentToolNames || []
  
  // Score all tools
  const scored = availableTools.map(tool => ({
    tool,
    score: scoreTool(tool, keywords, recentTools),
  }))
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)
  
  // Take top N tools
  const selected = scored.slice(0, maxTools).map(s => s.tool)
  
  // Force include any required tools
  if (options.forceInclude) {
    for (const name of options.forceInclude) {
      if (!selected.find(t => t.name === name)) {
        const tool = availableTools.find(t => t.name === name)
        if (tool) {
          selected.push(tool)
        }
      }
    }
  }

  if (isDebugTools()) {
    logTools(`[ToolFilter] Filtered ${availableTools.length} → ${selected.length} tools`)
    logTools(`[ToolFilter] Keywords: ${keywords.slice(0, 10).join(", ")}`)
    logTools(`[ToolFilter] Top tools: ${selected.slice(0, 5).map(t => t.name).join(", ")}`)
  }

  return {
    tools: selected,
    filtered: true,
    originalCount: availableTools.length,
    filteredCount: selected.length,
    reason: `Filtered by context relevance (${keywords.slice(0, 3).join(", ")})`,
  }
}

/**
 * Get tool names from recent conversation history
 */
export function getRecentToolNames(
  conversationHistory: Array<{ role: string; toolCalls?: Array<{ name: string }> }>
): string[] {
  const names: string[] = []

  // Look at last 10 messages for recent tool usage
  const recent = conversationHistory.slice(-10)

  for (const msg of recent) {
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (!names.includes(tc.name)) {
          names.push(tc.name)
        }
      }
    }
  }

  return names
}
