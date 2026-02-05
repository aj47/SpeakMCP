/**
 * Memory Service for agent memories
 * Ported from desktop's memory-service.ts with simplified file-based JSON storage.
 */

import fs from 'fs'
import path from 'path'
import { getMemoriesFolder, ensureDir } from '../config/index'
import type { AgentMemory } from '../types/index'

const VALID_IMPORTANCE_VALUES = ['low', 'medium', 'high', 'critical'] as const

function isStringArray(arr: unknown[]): arr is string[] {
  return arr.every(item => typeof item === 'string')
}

function isValidAgentMemory(item: unknown): item is AgentMemory {
  if (typeof item !== 'object' || item === null) return false
  const obj = item as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.createdAt === 'number' &&
    typeof obj.updatedAt === 'number' &&
    typeof obj.title === 'string' &&
    typeof obj.content === 'string' &&
    Array.isArray(obj.tags) &&
    isStringArray(obj.tags) &&
    typeof obj.importance === 'string' &&
    VALID_IMPORTANCE_VALUES.includes(obj.importance as typeof VALID_IMPORTANCE_VALUES[number])
  )
}

function getMemoriesFilePath(): string {
  return path.join(getMemoriesFolder(), 'memories.json')
}

class MemoryService {
  private memories: AgentMemory[] = []
  private initialized = false

  private loadFromDisk(): void {
    const filePath = getMemoriesFilePath()
    try {
      ensureDir(getMemoriesFolder())
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8')
        const parsed: unknown = JSON.parse(data)
        if (!Array.isArray(parsed)) {
          this.memories = []
          return
        }
        this.memories = parsed.filter(isValidAgentMemory)
      }
    } catch {
      this.memories = []
    }
  }

  private saveToDisk(): boolean {
    const filePath = getMemoriesFilePath()
    try {
      ensureDir(getMemoriesFolder())
      fs.writeFileSync(filePath, JSON.stringify(this.memories, null, 2), 'utf-8')
      return true
    } catch {
      return false
    }
  }

  private initialize(): void {
    if (this.initialized) return
    this.loadFromDisk()
    this.initialized = true
  }

  getAllMemories(): AgentMemory[] {
    this.initialize()
    return [...this.memories].sort((a, b) => b.createdAt - a.createdAt)
  }

  getMemory(id: string): AgentMemory | null {
    this.initialize()
    return this.memories.find(m => m.id === id) || null
  }

  saveMemory(memory: AgentMemory): boolean {
    this.initialize()
    const existingIndex = this.memories.findIndex(m => m.id === memory.id)
    const previousMemory = existingIndex >= 0 ? this.memories[existingIndex] : null

    if (existingIndex >= 0) {
      this.memories[existingIndex] = memory
    } else {
      this.memories.push(memory)
    }

    const success = this.saveToDisk()
    if (!success) {
      // Rollback
      if (previousMemory) {
        this.memories[existingIndex] = previousMemory
      } else {
        this.memories.pop()
      }
      return false
    }
    return true
  }

  updateMemory(id: string, updates: Partial<Omit<AgentMemory, 'id' | 'createdAt'>>): AgentMemory | null {
    this.initialize()
    const existing = this.memories.find(m => m.id === id)
    if (!existing) return null

    const updated: AgentMemory = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }

    const success = this.saveMemory(updated)
    return success ? updated : null
  }

  deleteMemory(id: string): boolean {
    this.initialize()
    const index = this.memories.findIndex(m => m.id === id)
    if (index < 0) return false

    const deleted = this.memories[index]
    this.memories.splice(index, 1)

    const success = this.saveToDisk()
    if (!success) {
      this.memories.splice(index, 0, deleted)
      return false
    }
    return true
  }

  searchMemories(query: string): AgentMemory[] {
    const all = this.getAllMemories()
    const lowerQuery = query.toLowerCase()
    return all.filter(m =>
      m.title.toLowerCase().includes(lowerQuery) ||
      m.content.toLowerCase().includes(lowerQuery) ||
      (m.keyFindings ?? []).some(f => f.toLowerCase().includes(lowerQuery)) ||
      m.tags.some(t => t.toLowerCase().includes(lowerQuery))
    )
  }

  generateId(): string {
    return `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

export const memoryService = new MemoryService()

