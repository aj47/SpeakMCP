/**
 * Memory Service for Dual-Model Agent Mode
 *
 * Stores agent memories in a single JSON file for persistence.
 */

import { app } from "electron"
import * as fs from "fs"
import * as path from "path"
import { logLLM, isDebugLLM } from "./debug"
import type { AgentMemory, AgentStepSummary } from "../shared/types"

function getMemoriesFilePath(): string {
  return path.join(app.getPath("userData"), "memories.json")
}

const VALID_IMPORTANCE_VALUES = ["low", "medium", "high", "critical"] as const

function isStringArray(arr: unknown[]): arr is string[] {
  return arr.every(item => typeof item === "string")
}

function isValidAgentMemory(item: unknown): item is AgentMemory {
  if (typeof item !== "object" || item === null) {
    return false
  }
  const obj = item as Record<string, unknown>
  return (
    typeof obj.id === "string" &&
    typeof obj.createdAt === "number" &&
    typeof obj.updatedAt === "number" &&
    typeof obj.title === "string" &&
    typeof obj.content === "string" &&
    Array.isArray(obj.keyFindings) &&
    isStringArray(obj.keyFindings) &&
    Array.isArray(obj.tags) &&
    isStringArray(obj.tags) &&
    typeof obj.importance === "string" &&
    VALID_IMPORTANCE_VALUES.includes(obj.importance as typeof VALID_IMPORTANCE_VALUES[number])
  )
}

class MemoryService {
  private memories: AgentMemory[] = []
  private initialized = false

  private async loadFromDisk(): Promise<void> {
    const filePath = getMemoriesFilePath()
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8")
        const parsed: unknown = JSON.parse(data)

        if (!Array.isArray(parsed)) {
          if (isDebugLLM()) {
            logLLM("[MemoryService] Warning: memories file is not an array, resetting to empty")
          }
          this.memories = []
          return
        }

        const validMemories = parsed.filter(isValidAgentMemory)
        const invalidCount = parsed.length - validMemories.length

        if (invalidCount > 0 && isDebugLLM()) {
          logLLM(`[MemoryService] Warning: filtered out ${invalidCount} invalid memory entries`)
        }

        this.memories = validMemories
      }
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error loading memories:", error)
      }
      this.memories = []
    }
  }

  private async saveToDisk(): Promise<boolean> {
    const filePath = getMemoriesFilePath()
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.memories, null, 2), "utf-8")
      return true
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error saving memories:", error)
      }
      return false
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.loadFromDisk()
    this.initialized = true
    if (isDebugLLM()) {
      logLLM("[MemoryService] Initialized with", this.memories.length, "memories")
    }
  }

  async saveMemory(memory: AgentMemory): Promise<boolean> {
    await this.initialize()
    const existingIndex = this.memories.findIndex(m => m.id === memory.id)
    const previousMemory = existingIndex >= 0 ? this.memories[existingIndex] : null

    if (existingIndex >= 0) {
      this.memories[existingIndex] = memory
    } else {
      this.memories.push(memory)
    }

    const success = await this.saveToDisk()
    if (!success) {
      // Roll back the in-memory change
      if (previousMemory) {
        this.memories[existingIndex] = previousMemory
      } else {
        this.memories.pop()
      }
      return false
    }

    if (isDebugLLM()) {
      logLLM("[MemoryService] Saved memory:", memory.id)
    }
    return true
  }

  createMemoryFromSummary(
    summary: AgentStepSummary,
    title?: string,
    userNotes?: string,
    tags?: string[],
    conversationTitle?: string,
    conversationId?: string,
    profileId?: string,
  ): AgentMemory {
    const now = Date.now()
    return {
      id: `memory_${now}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      profileId,
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

  async getMemory(id: string): Promise<AgentMemory | null> {
    await this.initialize()
    return this.memories.find(m => m.id === id) || null
  }

  async getAllMemories(): Promise<AgentMemory[]> {
    await this.initialize()
    return [...this.memories].sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Get memories filtered by profile ID.
   * If profileId is provided, returns only memories for that profile.
   * Memories without a profileId (legacy) are NOT included when filtering by profile.
   */
  async getMemoriesByProfile(profileId: string): Promise<AgentMemory[]> {
    await this.initialize()
    return [...this.memories]
      .filter(m => m.profileId === profileId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async getMemoriesByImportance(
    importance: "low" | "medium" | "high" | "critical",
    profileId?: string
  ): Promise<AgentMemory[]> {
    const all = profileId
      ? await this.getMemoriesByProfile(profileId)
      : await this.getAllMemories()
    return all.filter(m => m.importance === importance)
  }

  async getMemoriesBySession(sessionId: string): Promise<AgentMemory[]> {
    const all = await this.getAllMemories()
    return all.filter(m => m.sessionId === sessionId)
  }

  async searchMemories(query: string, profileId?: string): Promise<AgentMemory[]> {
    const all = profileId
      ? await this.getMemoriesByProfile(profileId)
      : await this.getAllMemories()
    const lowerQuery = query.toLowerCase()
    return all.filter(m =>
      m.title.toLowerCase().includes(lowerQuery) ||
      m.content.toLowerCase().includes(lowerQuery) ||
      (m.keyFindings ?? []).some(f => f.toLowerCase().includes(lowerQuery)) ||
      m.tags.some(t => t.toLowerCase().includes(lowerQuery))
    )
  }

  async updateMemory(
    id: string,
    updates: Partial<Omit<AgentMemory, "id" | "createdAt">>
  ): Promise<boolean> {
    await this.initialize()
    const existing = this.memories.find(m => m.id === id)
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

  async deleteMemory(id: string): Promise<boolean> {
    await this.initialize()
    const index = this.memories.findIndex(m => m.id === id)
    if (index < 0) {
      return false
    }
    const deletedMemory = this.memories[index]
    this.memories.splice(index, 1)

    const success = await this.saveToDisk()
    if (!success) {
      // Roll back: restore the deleted memory at its original position
      this.memories.splice(index, 0, deletedMemory)
      return false
    }

    if (isDebugLLM()) {
      logLLM("[MemoryService] Deleted memory:", id)
    }
    return true
  }

  /**
   * Delete multiple memories by IDs.
   * @param ids Array of memory IDs to delete
   * @param profileId If provided, only delete memories belonging to this profile
   * @returns Number of deleted memories
   */
  async deleteMultipleMemories(ids: string[], profileId?: string): Promise<number> {
    await this.initialize()

    const originalMemories = [...this.memories]
    let deletedCount = 0

    for (const id of ids) {
      const index = this.memories.findIndex(m => m.id === id)
      if (index < 0) continue

      const memory = this.memories[index]
      // Skip if profile filter is set and memory doesn't match
      if (profileId !== undefined && memory.profileId !== profileId) continue

      this.memories.splice(index, 1)
      deletedCount++
    }

    if (deletedCount > 0) {
      const success = await this.saveToDisk()
      if (!success) {
        this.memories = originalMemories
        return 0
      }

      if (isDebugLLM()) {
        logLLM("[MemoryService] Deleted multiple memories:", deletedCount)
      }
    }

    return deletedCount
  }

  /**
   * Delete all memories, optionally filtered by profile ID.
   * @param profileId If provided, only delete memories for this profile
   * @returns Number of deleted memories
   */
  async deleteAllMemories(profileId?: string): Promise<number> {
    await this.initialize()

    const originalMemories = [...this.memories]
    let deletedCount: number

    if (profileId) {
      const toDelete = this.memories.filter(m => m.profileId === profileId)
      deletedCount = toDelete.length
      this.memories = this.memories.filter(m => m.profileId !== profileId)
    } else {
      deletedCount = this.memories.length
      this.memories = []
    }

    if (deletedCount > 0) {
      const success = await this.saveToDisk()
      if (!success) {
        this.memories = originalMemories
        return 0
      }

      if (isDebugLLM()) {
        logLLM("[MemoryService] Deleted all memories:", deletedCount)
      }
    }

    return deletedCount
  }
}

export const memoryService = new MemoryService()

