/**
 * Memory Service for Dual-Model Agent Mode
 * 
 * Stores agent memories (saved from step summaries) as .md files
 * in the app's data directory for persistence and easy access.
 */

import { app } from "electron"
import * as fs from "fs"
import * as path from "path"
import { logLLM, isDebugLLM } from "./debug"
import type { AgentMemory, AgentStepSummary } from "../shared/types"

/**
 * Get the memories directory path
 */
function getMemoriesDir(): string {
  const userDataPath = app.getPath("userData")
  return path.join(userDataPath, "memories")
}

/**
 * Ensure the memories directory exists
 */
function ensureMemoriesDir(): void {
  const dir = getMemoriesDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Generate a safe filename from a title
 */
function generateFilename(title: string, id: string): string {
  // Remove special characters and truncate
  const safeTitle = title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 50)
  
  // Add timestamp and ID for uniqueness
  const timestamp = new Date().toISOString().slice(0, 10)
  return `${timestamp}-${safeTitle}-${id.slice(-8)}.md`
}

/**
 * Convert a memory to markdown content
 */
function memoryToMarkdown(memory: AgentMemory): string {
  const lines: string[] = []
  
  // YAML frontmatter
  lines.push("---")
  lines.push(`id: ${memory.id}`)
  lines.push(`title: "${memory.title.replace(/"/g, '\\"')}"`)
  lines.push(`createdAt: ${new Date(memory.createdAt).toISOString()}`)
  lines.push(`updatedAt: ${new Date(memory.updatedAt).toISOString()}`)
  lines.push(`importance: ${memory.importance}`)
  if (memory.sessionId) {
    lines.push(`sessionId: ${memory.sessionId}`)
  }
  if (memory.conversationId) {
    lines.push(`conversationId: ${memory.conversationId}`)
  }
  if (memory.conversationTitle) {
    lines.push(`conversationTitle: "${memory.conversationTitle.replace(/"/g, '\\"')}"`)
  }
  if (memory.tags.length > 0) {
    lines.push(`tags:`)
    for (const tag of memory.tags) {
      lines.push(`  - ${tag}`)
    }
  }
  lines.push("---")
  lines.push("")
  
  // Title
  lines.push(`# ${memory.title}`)
  lines.push("")
  
  // Content
  lines.push(memory.content)
  lines.push("")
  
  // Key Findings
  if (memory.keyFindings.length > 0) {
    lines.push("## Key Findings")
    lines.push("")
    for (const finding of memory.keyFindings) {
      lines.push(`- ${finding}`)
    }
    lines.push("")
  }
  
  // User Notes
  if (memory.userNotes) {
    lines.push("## Notes")
    lines.push("")
    lines.push(memory.userNotes)
    lines.push("")
  }
  
  return lines.join("\n")
}

/**
 * Parse markdown file back to AgentMemory
 */
function parseMarkdownToMemory(content: string, filename: string): AgentMemory | null {
  try {
    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (!frontmatterMatch) {
      return null
    }
    
    const frontmatter = frontmatterMatch[1]
    const body = content.slice(frontmatterMatch[0].length).trim()
    
    // Parse frontmatter fields
    const getId = (s: string) => s.match(/^id:\s*(.+)$/m)?.[1]?.trim() || ""
    const getTitle = (s: string) => s.match(/^title:\s*"?([^"\n]+)"?$/m)?.[1]?.trim() || ""
    const getDate = (s: string, field: string) => {
      const match = s.match(new RegExp(`^${field}:\\s*(.+)$`, "m"))
      return match ? new Date(match[1].trim()).getTime() : Date.now()
    }
    const getImportance = (s: string) => {
      const match = s.match(/^importance:\s*(.+)$/m)?.[1]?.trim()
      return ["low", "medium", "high", "critical"].includes(match || "") 
        ? match as "low" | "medium" | "high" | "critical"
        : "medium"
    }
    const getOptional = (s: string, field: string) => 
      s.match(new RegExp(`^${field}:\\s*"?([^"\n]+)"?$`, "m"))?.[1]?.trim()
    
    // Parse tags array
    const tagsMatch = frontmatter.match(/^tags:\n((?:\s+-\s*.+\n?)+)/m)
    const tags: string[] = []
    if (tagsMatch) {
      const tagLines = tagsMatch[1].match(/^\s+-\s*(.+)$/gm) || []
      for (const line of tagLines) {
        const tag = line.match(/^\s+-\s*(.+)$/)?.[1]?.trim()
        if (tag) tags.push(tag)
      }
    }
    
    // Extract key findings from body
    const keyFindings: string[] = []
    const findingsMatch = body.match(/## Key Findings\n\n((?:-\s*.+\n?)+)/)
    if (findingsMatch) {
      const findingLines = findingsMatch[1].match(/^-\s*(.+)$/gm) || []
      for (const line of findingLines) {
        const finding = line.match(/^-\s*(.+)$/)?.[1]?.trim()
        if (finding) keyFindings.push(finding)
      }
    }

    // Extract user notes
    const notesMatch = body.match(/## Notes\n\n([\s\S]+?)(?=\n##|$)/)
    const userNotes = notesMatch?.[1]?.trim()

    // Extract main content (everything after title, before sections)
    const contentMatch = body.match(/^# .+\n\n([\s\S]*?)(?=\n## |$)/)
    const mainContent = contentMatch?.[1]?.trim() || ""

    return {
      id: getId(frontmatter),
      title: getTitle(frontmatter),
      createdAt: getDate(frontmatter, "createdAt"),
      updatedAt: getDate(frontmatter, "updatedAt"),
      importance: getImportance(frontmatter),
      sessionId: getOptional(frontmatter, "sessionId"),
      conversationId: getOptional(frontmatter, "conversationId"),
      conversationTitle: getOptional(frontmatter, "conversationTitle"),
      tags,
      keyFindings,
      content: mainContent,
      userNotes,
    }
  } catch (error) {
    if (isDebugLLM()) {
      logLLM("[MemoryService] Failed to parse markdown file:", filename, error)
    }
    return null
  }
}

/**
 * Memory Service class
 */
class MemoryService {
  private memoryCache: Map<string, AgentMemory> = new Map()
  private initialized = false

  /**
   * Initialize the service and load existing memories
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    ensureMemoriesDir()
    await this.loadAllMemories()
    this.initialized = true

    if (isDebugLLM()) {
      logLLM("[MemoryService] Initialized with", this.memoryCache.size, "memories")
    }
  }

  /**
   * Load all memories from disk
   */
  private async loadAllMemories(): Promise<void> {
    const dir = getMemoriesDir()

    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"))

      for (const file of files) {
        const filepath = path.join(dir, file)
        const content = fs.readFileSync(filepath, "utf-8")
        const memory = parseMarkdownToMemory(content, file)

        if (memory) {
          this.memoryCache.set(memory.id, memory)
        }
      }
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error loading memories:", error)
      }
    }
  }

  /**
   * Save a memory to disk
   */
  async saveMemory(memory: AgentMemory): Promise<boolean> {
    await this.initialize()

    try {
      ensureMemoriesDir()

      const filename = generateFilename(memory.title, memory.id)
      const filepath = path.join(getMemoriesDir(), filename)
      const content = memoryToMarkdown(memory)

      fs.writeFileSync(filepath, content, "utf-8")
      this.memoryCache.set(memory.id, memory)

      if (isDebugLLM()) {
        logLLM("[MemoryService] Saved memory:", memory.id, "to", filename)
      }

      return true
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error saving memory:", error)
      }
      return false
    }
  }

  /**
   * Create a memory from a step summary
   */
  createMemoryFromSummary(
    summary: AgentStepSummary,
    title?: string,
    userNotes?: string,
    tags?: string[],
    conversationTitle?: string,
    conversationId?: string,
  ): AgentMemory {
    const now = Date.now()

    return {
      id: `memory_${now}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      sessionId: summary.sessionId,
      conversationId,
      conversationTitle,
      title: title || summary.actionSummary.slice(0, 100),
      content: summary.actionSummary,
      keyFindings: summary.keyFindings,
      tags: tags || summary.tags || [],
      importance: summary.importance,
      userNotes,
    }
  }

  /**
   * Get a memory by ID
   */
  async getMemory(id: string): Promise<AgentMemory | null> {
    await this.initialize()
    return this.memoryCache.get(id) || null
  }

  /**
   * Get all memories
   */
  async getAllMemories(): Promise<AgentMemory[]> {
    await this.initialize()
    return Array.from(this.memoryCache.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    )
  }

  /**
   * Get memories by importance
   */
  async getMemoriesByImportance(
    importance: "low" | "medium" | "high" | "critical"
  ): Promise<AgentMemory[]> {
    const all = await this.getAllMemories()
    return all.filter(m => m.importance === importance)
  }

  /**
   * Get memories by session
   */
  async getMemoriesBySession(sessionId: string): Promise<AgentMemory[]> {
    const all = await this.getAllMemories()
    return all.filter(m => m.sessionId === sessionId)
  }

  /**
   * Search memories by text
   */
  async searchMemories(query: string): Promise<AgentMemory[]> {
    const all = await this.getAllMemories()
    const lowerQuery = query.toLowerCase()

    return all.filter(m =>
      m.title.toLowerCase().includes(lowerQuery) ||
      m.content.toLowerCase().includes(lowerQuery) ||
      m.keyFindings.some(f => f.toLowerCase().includes(lowerQuery)) ||
      m.tags.some(t => t.toLowerCase().includes(lowerQuery))
    )
  }

  /**
   * Update a memory
   */
  async updateMemory(id: string, updates: Partial<Omit<AgentMemory, "id" | "createdAt">>): Promise<boolean> {
    await this.initialize()

    const existing = this.memoryCache.get(id)
    if (!existing) {
      return false
    }

    const updated: AgentMemory = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }

    return this.saveMemory(updated)
  }

  /**
   * Delete a memory
   */
  async deleteMemory(id: string): Promise<boolean> {
    await this.initialize()

    const memory = this.memoryCache.get(id)
    if (!memory) {
      return false
    }

    try {
      const dir = getMemoriesDir()
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"))

      for (const file of files) {
        const filepath = path.join(dir, file)
        const content = fs.readFileSync(filepath, "utf-8")

        if (content.includes(`id: ${id}`)) {
          fs.unlinkSync(filepath)
          this.memoryCache.delete(id)

          if (isDebugLLM()) {
            logLLM("[MemoryService] Deleted memory:", id)
          }

          return true
        }
      }
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error deleting memory:", error)
      }
    }

    return false
  }
}

export const memoryService = new MemoryService()

