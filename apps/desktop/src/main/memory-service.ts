/**
 * Letta-style Memory Service for SpeakMCP
 *
 * Implements the MemGPT paper concepts (arXiv:2310.08560):
 * - Core Memory: In-context memory blocks (persona, human info, task context)
 * - Archival Memory: Long-term searchable storage
 * - Self-editing: Agent can modify its own memory through tool calls
 *
 * Key features:
 * - Persistent storage to disk
 * - Memory block management with character limits
 * - Simple keyword-based archival search (can be enhanced with embeddings)
 * - Memory operations tracking
 */

import fs from "fs"
import path from "path"
import { dataFolder } from "./config"
import { logApp } from "./debug"
import {
  AgentMemory,
  MemoryBlock,
  ArchivalMemoryEntry,
  ArchivalSearchResult,
  MemoryConfig,
  MemoryStats,
  MemoryOperation,
  DEFAULT_MEMORY_BLOCKS,
  DEFAULT_MEMORY_CONFIG,
} from "./memory-types"

// Memory storage folder
const memoryFolder = path.join(dataFolder, "memory")

// Current memory version for migrations
const MEMORY_VERSION = 1

/**
 * Memory Service - Singleton for managing agent memory
 *
 * Follows the Letta/MemGPT architecture:
 * - Core memory is always loaded and in-context
 * - Archival memory is searched on-demand
 * - Agent can edit its own memory through provided tools
 */
export class MemoryService {
  private static instance: MemoryService | null = null

  private memory: AgentMemory | null = null
  private operationHistory: MemoryOperation[] = []
  private isDirty: boolean = false

  static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService()
    }
    return MemoryService.instance
  }

  private constructor() {
    this.ensureMemoryFolder()
    this.loadMemory()
  }

  private ensureMemoryFolder(): void {
    if (!fs.existsSync(memoryFolder)) {
      fs.mkdirSync(memoryFolder, { recursive: true })
    }
  }

  private getMemoryPath(): string {
    return path.join(memoryFolder, "agent-memory.json")
  }

  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Initialize memory with default blocks
   */
  private initializeMemory(): AgentMemory {
    const now = Date.now()
    const coreMemory: MemoryBlock[] = DEFAULT_MEMORY_BLOCKS.map((block) => ({
      ...block,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    }))

    return {
      id: this.generateId(),
      coreMemory,
      archivalMemory: [],
      config: { ...DEFAULT_MEMORY_CONFIG },
      version: MEMORY_VERSION,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Load memory from disk or initialize if not exists
   */
  private loadMemory(): void {
    try {
      const memoryPath = this.getMemoryPath()

      if (fs.existsSync(memoryPath)) {
        const data = fs.readFileSync(memoryPath, "utf8")
        this.memory = JSON.parse(data)
        logApp("[MemoryService] Memory loaded from disk")

        // Migrate if needed
        if (this.memory && this.memory.version < MEMORY_VERSION) {
          this.migrateMemory()
        }
      } else {
        this.memory = this.initializeMemory()
        this.saveMemory()
        logApp("[MemoryService] Memory initialized with defaults")
      }
    } catch (error) {
      logApp("[MemoryService] Error loading memory, initializing new:", error)
      this.memory = this.initializeMemory()
      this.saveMemory()
    }
  }

  /**
   * Save memory to disk
   */
  private saveMemory(): void {
    try {
      if (!this.memory) return

      this.ensureMemoryFolder()
      this.memory.updatedAt = Date.now()

      const memoryPath = this.getMemoryPath()
      fs.writeFileSync(memoryPath, JSON.stringify(this.memory, null, 2))
      this.isDirty = false
      logApp("[MemoryService] Memory saved to disk")
    } catch (error) {
      logApp("[MemoryService] Error saving memory:", error)
    }
  }

  /**
   * Migrate memory to latest version
   */
  private migrateMemory(): void {
    if (!this.memory) return
    // Add migration logic here as versions change
    this.memory.version = MEMORY_VERSION
    this.saveMemory()
    logApp("[MemoryService] Memory migrated to version", MEMORY_VERSION)
  }

  // ============================================
  // CORE MEMORY OPERATIONS
  // These are the functions the agent uses to edit its own memory
  // ============================================

  /**
   * Get all core memory blocks
   */
  getCoreMemory(): MemoryBlock[] {
    return this.memory?.coreMemory ?? []
  }

  /**
   * Get a specific memory block by label
   */
  getMemoryBlock(label: string): MemoryBlock | undefined {
    return this.memory?.coreMemory.find((b) => b.label === label)
  }

  /**
   * Replace content in a memory block (core_memory_replace)
   * This is the primary way the agent edits its memory.
   *
   * @param label - The memory block label (e.g., "human", "persona")
   * @param oldContent - The exact text to replace (must match exactly)
   * @param newContent - The replacement text
   * @returns Success status and message
   */
  coreMemoryReplace(
    label: string,
    oldContent: string,
    newContent: string
  ): { success: boolean; message: string } {
    if (!this.memory) {
      return { success: false, message: "Memory not initialized" }
    }

    const block = this.memory.coreMemory.find((b) => b.label === label)
    if (!block) {
      return {
        success: false,
        message: `Memory block '${label}' not found. Available blocks: ${this.memory.coreMemory.map((b) => b.label).join(", ")}`,
      }
    }

    if (block.readOnly) {
      return {
        success: false,
        message: `Memory block '${label}' is read-only`,
      }
    }

    if (!block.value.includes(oldContent)) {
      return {
        success: false,
        message: `Old content not found in '${label}' block. Current content: "${block.value.substring(0, 200)}${block.value.length > 200 ? "..." : ""}"`,
      }
    }

    const newValue = block.value.replace(oldContent, newContent)

    if (newValue.length > block.limit) {
      return {
        success: false,
        message: `New content exceeds limit (${newValue.length}/${block.limit} chars)`,
      }
    }

    // Record operation
    this.operationHistory.push({
      type: "core_memory_replace",
      timestamp: Date.now(),
      blockLabel: label,
      oldValue: block.value,
      newValue,
    })

    block.value = newValue
    block.updatedAt = Date.now()
    this.isDirty = true
    this.saveMemory()

    return {
      success: true,
      message: `Updated '${label}' block (${newValue.length}/${block.limit} chars)`,
    }
  }

  /**
   * Append content to a memory block (core_memory_append)
   *
   * @param label - The memory block label
   * @param content - Content to append
   * @returns Success status and message
   */
  coreMemoryAppend(
    label: string,
    content: string
  ): { success: boolean; message: string } {
    if (!this.memory) {
      return { success: false, message: "Memory not initialized" }
    }

    const block = this.memory.coreMemory.find((b) => b.label === label)
    if (!block) {
      return {
        success: false,
        message: `Memory block '${label}' not found. Available blocks: ${this.memory.coreMemory.map((b) => b.label).join(", ")}`,
      }
    }

    if (block.readOnly) {
      return {
        success: false,
        message: `Memory block '${label}' is read-only`,
      }
    }

    const separator = block.value.length > 0 ? "\n" : ""
    const newValue = block.value + separator + content

    if (newValue.length > block.limit) {
      return {
        success: false,
        message: `Appending would exceed limit (${newValue.length}/${block.limit} chars). Current: ${block.value.length} chars.`,
      }
    }

    // Record operation
    this.operationHistory.push({
      type: "core_memory_append",
      timestamp: Date.now(),
      blockLabel: label,
      oldValue: block.value,
      newValue,
    })

    block.value = newValue
    block.updatedAt = Date.now()
    this.isDirty = true
    this.saveMemory()

    return {
      success: true,
      message: `Appended to '${label}' block (${newValue.length}/${block.limit} chars)`,
    }
  }

  /**
   * Clear a memory block (sets to empty string)
   */
  coreMemoryClear(label: string): { success: boolean; message: string } {
    if (!this.memory) {
      return { success: false, message: "Memory not initialized" }
    }

    const block = this.memory.coreMemory.find((b) => b.label === label)
    if (!block) {
      return { success: false, message: `Memory block '${label}' not found` }
    }

    if (block.readOnly) {
      return { success: false, message: `Memory block '${label}' is read-only` }
    }

    this.operationHistory.push({
      type: "core_memory_replace",
      timestamp: Date.now(),
      blockLabel: label,
      oldValue: block.value,
      newValue: "",
    })

    block.value = ""
    block.updatedAt = Date.now()
    this.isDirty = true
    this.saveMemory()

    return { success: true, message: `Cleared '${label}' block` }
  }

  // ============================================
  // ARCHIVAL MEMORY OPERATIONS
  // Long-term storage for facts, experiences, etc.
  // ============================================

  /**
   * Insert a new entry into archival memory
   *
   * @param content - The content to store
   * @param tags - Optional tags for categorization
   * @param source - Source of the memory (e.g., conversation ID)
   * @param importance - Importance score (0-1)
   * @returns Success status and entry ID
   */
  archivalMemoryInsert(
    content: string,
    tags: string[] = [],
    source: string = "agent",
    importance: number = 0.5
  ): { success: boolean; message: string; entryId?: string } {
    if (!this.memory) {
      return { success: false, message: "Memory not initialized" }
    }

    // Check limit
    if (
      this.memory.archivalMemory.length >= this.memory.config.maxArchivalMemories
    ) {
      // Remove oldest low-importance entries if at limit
      const sortedByImportance = [...this.memory.archivalMemory].sort(
        (a, b) => a.importance - b.importance
      )
      const toRemove = sortedByImportance[0]
      if (toRemove && toRemove.importance < importance) {
        this.memory.archivalMemory = this.memory.archivalMemory.filter(
          (e) => e.id !== toRemove.id
        )
      } else {
        return {
          success: false,
          message: `Archival memory full (${this.memory.config.maxArchivalMemories} entries). New entry must have higher importance than existing lowest.`,
        }
      }
    }

    const entry: ArchivalMemoryEntry = {
      id: this.generateId(),
      content,
      tags,
      source,
      importance: Math.max(0, Math.min(1, importance)),
      createdAt: Date.now(),
    }

    this.memory.archivalMemory.push(entry)

    this.operationHistory.push({
      type: "archival_memory_insert",
      timestamp: Date.now(),
      entryId: entry.id,
      newValue: content,
    })

    this.isDirty = true
    this.saveMemory()

    return {
      success: true,
      message: `Stored in archival memory (ID: ${entry.id})`,
      entryId: entry.id,
    }
  }

  /**
   * Search archival memory using keyword matching
   * (Can be enhanced with embeddings/vector search later)
   *
   * @param query - Search query
   * @param limit - Maximum results to return
   * @returns Array of matching entries with scores
   */
  archivalMemorySearch(query: string, limit: number = 5): ArchivalSearchResult[] {
    if (!this.memory) return []

    const queryLower = query.toLowerCase()
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2)

    const results: ArchivalSearchResult[] = []

    for (const entry of this.memory.archivalMemory) {
      const contentLower = entry.content.toLowerCase()
      const tagsLower = entry.tags.map((t) => t.toLowerCase())

      // Calculate relevance score
      let score = 0

      // Exact query match in content
      if (contentLower.includes(queryLower)) {
        score += 0.5
      }

      // Term matches
      for (const term of queryTerms) {
        if (contentLower.includes(term)) {
          score += 0.2
        }
        if (tagsLower.some((t) => t.includes(term))) {
          score += 0.15
        }
      }

      // Boost by importance
      score *= 0.5 + entry.importance * 0.5

      // Normalize score to 0-1
      score = Math.min(1, score)

      if (score > 0.1) {
        results.push({ entry, score })
      }
    }

    // Sort by score descending and limit
    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /**
   * Delete an archival memory entry by ID
   */
  archivalMemoryDelete(
    entryId: string
  ): { success: boolean; message: string } {
    if (!this.memory) {
      return { success: false, message: "Memory not initialized" }
    }

    const index = this.memory.archivalMemory.findIndex((e) => e.id === entryId)
    if (index === -1) {
      return { success: false, message: `Entry '${entryId}' not found` }
    }

    const removed = this.memory.archivalMemory.splice(index, 1)[0]

    this.operationHistory.push({
      type: "archival_memory_delete",
      timestamp: Date.now(),
      entryId,
      oldValue: removed.content,
    })

    this.isDirty = true
    this.saveMemory()

    return { success: true, message: `Deleted archival entry '${entryId}'` }
  }

  /**
   * Get all archival memory entries
   */
  getArchivalMemory(): ArchivalMemoryEntry[] {
    return this.memory?.archivalMemory ?? []
  }

  // ============================================
  // MEMORY FORMATTING FOR CONTEXT
  // ============================================

  /**
   * Format core memory for inclusion in system prompt
   * This creates the XML-like format that Letta uses
   */
  formatCoreMemoryForPrompt(): string {
    if (!this.memory || !this.memory.config.includeInSystemPrompt) {
      return ""
    }

    const blocks = this.memory.coreMemory
      .filter((b) => b.value.trim().length > 0)
      .map((b) => `<${b.label}>\n${b.value}\n</${b.label}>`)
      .join("\n\n")

    if (!blocks) return ""

    return `
<core_memory>
${blocks}
</core_memory>

MEMORY INSTRUCTIONS:
- The <core_memory> above contains persistent information you've stored.
- You can update your core memory using the memory tools (core_memory_replace, core_memory_append, archival_memory_insert, archival_memory_search).
- Store important facts about the user in the "human" block.
- Update your "persona" block as you learn about your working style.
- Use "task_context" for current task state.
- For long-term facts that don't fit in core memory, use archival_memory_insert.
- Search archival memory when you need to recall stored information.
`
  }

  /**
   * Get a summary of all memory blocks (for display)
   */
  getMemorySummary(): string {
    if (!this.memory) return "Memory not initialized"

    const coreBlocks = this.memory.coreMemory.map(
      (b) =>
        `- ${b.label}: ${b.value.length}/${b.limit} chars${b.readOnly ? " (read-only)" : ""}`
    )

    return `Core Memory Blocks:\n${coreBlocks.join("\n")}\n\nArchival Memory: ${this.memory.archivalMemory.length} entries`
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    const coreMemory = this.getCoreMemory()
    const totalChars = coreMemory.reduce((sum, b) => sum + b.value.length, 0)
    const totalLimit = coreMemory.reduce((sum, b) => sum + b.limit, 0)

    return {
      coreMemoryBlocks: coreMemory.length,
      coreMemoryTotalChars: totalChars,
      coreMemoryUsedPercent: totalLimit > 0 ? (totalChars / totalLimit) * 100 : 0,
      archivalMemoryEntries: this.memory?.archivalMemory.length ?? 0,
      lastUpdated: this.memory?.updatedAt ?? 0,
    }
  }

  /**
   * Get the full memory state
   */
  getMemory(): AgentMemory | null {
    return this.memory
  }

  /**
   * Update memory configuration
   */
  updateConfig(config: Partial<MemoryConfig>): void {
    if (!this.memory) return

    this.memory.config = { ...this.memory.config, ...config }
    this.saveMemory()
  }

  /**
   * Reset memory to defaults (destructive!)
   */
  resetMemory(): void {
    this.memory = this.initializeMemory()
    this.operationHistory = []
    this.saveMemory()
    logApp("[MemoryService] Memory reset to defaults")
  }

  /**
   * Get operation history
   */
  getOperationHistory(): MemoryOperation[] {
    return [...this.operationHistory]
  }

  /**
   * Add a custom memory block
   */
  addMemoryBlock(
    label: string,
    description: string,
    limit: number = 1000,
    readOnly: boolean = false
  ): { success: boolean; message: string } {
    if (!this.memory) {
      return { success: false, message: "Memory not initialized" }
    }

    if (this.memory.coreMemory.some((b) => b.label === label)) {
      return { success: false, message: `Block '${label}' already exists` }
    }

    const now = Date.now()
    this.memory.coreMemory.push({
      id: this.generateId(),
      label,
      description,
      value: "",
      limit,
      readOnly,
      createdAt: now,
      updatedAt: now,
    })

    this.saveMemory()
    return { success: true, message: `Added memory block '${label}'` }
  }

  /**
   * Remove a custom memory block
   */
  removeMemoryBlock(label: string): { success: boolean; message: string } {
    if (!this.memory) {
      return { success: false, message: "Memory not initialized" }
    }

    const defaultLabels = DEFAULT_MEMORY_BLOCKS.map((b) => b.label)
    if (defaultLabels.includes(label)) {
      return {
        success: false,
        message: `Cannot remove default block '${label}'`,
      }
    }

    const index = this.memory.coreMemory.findIndex((b) => b.label === label)
    if (index === -1) {
      return { success: false, message: `Block '${label}' not found` }
    }

    this.memory.coreMemory.splice(index, 1)
    this.saveMemory()
    return { success: true, message: `Removed memory block '${label}'` }
  }

  /**
   * Check if memory is enabled
   */
  isEnabled(): boolean {
    return this.memory?.config.enabled ?? false
  }

  /**
   * Enable or disable memory system
   */
  setEnabled(enabled: boolean): void {
    if (this.memory) {
      this.memory.config.enabled = enabled
      this.saveMemory()
    }
  }
}

// Export singleton instance
export const memoryService = MemoryService.getInstance()
