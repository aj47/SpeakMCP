/**
 * Types for File-Based Dynamic Context Discovery
 * 
 * Following Cursor's approach of using files as a primitive for dynamic context discovery.
 * See: https://cursor.com/blog/dynamic-context-discovery
 */

// ============================================================================
// MCP Tool File Types
// ============================================================================

/**
 * Metadata for an MCP server, stored in _server.json
 */
export interface MCPServerMetadata {
  name: string
  status: "connected" | "disconnected" | "error" | "needs-auth"
  transport: "stdio" | "websocket" | "streamableHttp"
  toolCount: number
  lastConnected?: number
  lastError?: string
  command?: string // For stdio transport
  url?: string // For websocket/streamableHttp transport
}

/**
 * Tool description file content, stored as {tool_name}.json
 */
export interface MCPToolFile {
  name: string
  serverName: string
  description: string
  inputSchema: Record<string, unknown>
  lastUpdated: number
}

/**
 * Summary of available tools for system prompt (names only, not full descriptions)
 */
export interface MCPToolSummary {
  serverName: string
  status: MCPServerMetadata["status"]
  toolNames: string[]
}

// ============================================================================
// Profile File Types
// ============================================================================

/**
 * Frontmatter metadata for profile markdown files
 */
export interface ProfileFrontmatter {
  id: string
  name: string
  created: string // ISO date
  updated: string // ISO date
  isDefault?: boolean
}

/**
 * Parsed profile from markdown file
 */
export interface ProfileMarkdown {
  frontmatter: ProfileFrontmatter
  guidelines: string
  systemPrompt?: string
  enabledServers: string[]
  enabledTools: string[]
  modelConfig?: {
    provider?: string
    model?: string
    sttProvider?: string
    ttsProvider?: string
  }
}

// ============================================================================
// Skills Types (Following Agent Skills Open Standard)
// ============================================================================

/**
 * Frontmatter for SKILL.md files
 */
export interface SkillFrontmatter {
  name: string
  version?: string
  description: string
  author?: string
  tags?: string[]
}

/**
 * Parsed skill from SKILL.md
 */
export interface Skill {
  id: string // Derived from folder name
  frontmatter: SkillFrontmatter
  content: string // Full markdown content
  instructions: string[] // Parsed instructions
  whenToUse?: string[]
  scripts?: string[] // Available scripts in skill folder
}

/**
 * Summary of available skills for system prompt
 */
export interface SkillSummary {
  id: string
  name: string
  description: string
}

// ============================================================================
// File Discovery Folder Structure
// ============================================================================

/**
 * Folder structure constants
 */
export const FILE_DISCOVERY_FOLDERS = {
  ROOT: ".speakmcp",
  MCP_TOOLS: "mcp-tools",
  PROFILES: "profiles",
  SKILLS: "skills",
  TERMINAL_SESSIONS: "terminal-sessions",
} as const

/**
 * File names
 */
export const FILE_DISCOVERY_FILES = {
  SERVER_METADATA: "_server.json",
  SKILL_FILE: "SKILL.md",
} as const

// ============================================================================
// System Prompt Discovery Hints
// ============================================================================

/**
 * Information for constructing discovery-aware system prompts
 */
export interface DiscoveryContext {
  mcpToolSummaries: MCPToolSummary[]
  skillSummaries: SkillSummary[]
  activeProfilePath?: string
  discoveryFolderPath: string
  skillsFolderPath: string
}

