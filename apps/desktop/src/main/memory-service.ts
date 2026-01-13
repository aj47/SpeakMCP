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

class MemoryService {
  private memories: AgentMemory[] = []
  private initialized = false

  private async loadFromDisk(): Promise<void> {
    const filePath = getMemoriesFilePath()
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8")
        this.memories = JSON.parse(data)
      }
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error loading memories:", error)
      }
      this.memories = []
    }
  }

  private async saveToDisk(): Promise<void> {
    const filePath = getMemoriesFilePath()
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.memories, null, 2), "utf-8")
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error saving memories:", error)
      }
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
    if (existingIndex >= 0) {
      this.memories[existingIndex] = memory
    } else {
      this.memories.push(memory)
    }
    await this.saveToDisk()
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

  async getMemory(id: string): Promise<AgentMemory | null> {
    await this.initialize()
    return this.memories.find(m => m.id === id) || null
  }

  async getAllMemories(): Promise<AgentMemory[]> {
    await this.initialize()
    return [...this.memories].sort((a, b) => b.createdAt - a.createdAt)
  }

  async getMemoriesByImportance(
    importance: "low" | "medium" | "high" | "critical"
  ): Promise<AgentMemory[]> {
    const all = await this.getAllMemories()
    return all.filter(m => m.importance === importance)
  }

  async getMemoriesBySession(sessionId: string): Promise<AgentMemory[]> {
    const all = await this.getAllMemories()
    return all.filter(m => m.sessionId === sessionId)
  }

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
    this.memories.splice(index, 1)
    await this.saveToDisk()
    if (isDebugLLM()) {
      logLLM("[MemoryService] Deleted memory:", id)
    }
    return true
  }
}

export const memoryService = new MemoryService()

