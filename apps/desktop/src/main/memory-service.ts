/**
 * Memory Service for Dual-Model Agent Mode
 *
 * Canonical persistence: `.agents/memories/*.md` (simple `key: value` frontmatter).
 * Also supports one-time migration/import from legacy `userData/memories.json`.
 */

import { app } from "electron"
import * as fs from "fs"
import * as path from "path"
import type { AgentMemory, AgentStepSummary } from "@shared/types"
import { logLLM, isDebugLLM } from "./debug"
import { globalAgentsFolder, resolveWorkspaceAgentsFolder } from "./config"
import { getAgentsLayerPaths, type AgentsLayerPaths } from "./agents-files/modular-config"
import {
  getAgentsMemoriesBackupDir,
  loadAgentsMemoriesLayer,
  memoryIdToFilePath,
  writeAgentsMemoryFile,
} from "./agents-files/memories"
import { readTextFileIfExistsSync, safeWriteFileSync } from "./agents-files/safe-file"

function normalizeSingleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
}

const MEMORY_CANDIDATE_TYPES = new Set([
  "preference",
  "constraint",
  "decision",
  "fact",
  "insight",
])

function getLegacyMemoriesFilePath(): string {
  return path.join(app.getPath("userData"), "memories.json")
}

const VALID_IMPORTANCE_VALUES = ["low", "medium", "high", "critical"] as const

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
}

function normalizeMemoryForRuntime(memory: AgentMemory): AgentMemory {
  const now = Date.now()
  const id = String(memory.id ?? "").trim()
  const createdAt = Number.isFinite(memory.createdAt) ? memory.createdAt : now
  const updatedAt = Number.isFinite(memory.updatedAt) ? memory.updatedAt : createdAt

  const importanceRaw = String((memory as any).importance ?? "medium")
  const importance = (VALID_IMPORTANCE_VALUES.includes(importanceRaw as any)
    ? importanceRaw
    : "medium") as AgentMemory["importance"]

  return {
    ...memory,
    id,
    createdAt,
    updatedAt,
    title: normalizeSingleLine(memory.title ?? memory.content ?? "").slice(0, 100) || id,
    content: normalizeSingleLine(memory.content ?? "").slice(0, 240),
    tags: Array.isArray(memory.tags) ? asStringArray(memory.tags) : [],
    importance,
    keyFindings: Array.isArray(memory.keyFindings) ? asStringArray(memory.keyFindings) : [],
    userNotes: typeof memory.userNotes === "string" && memory.userNotes.trim() ? memory.userNotes : undefined,
  }
}

type MemoryOrigin = {
  layer: "global" | "workspace"
  filePath: string
}

class MemoryService {
  private memories: AgentMemory[] = []
  private originById: Map<string, MemoryOrigin> = new Map()
  private initialized = false

  private getLayers(): { globalLayer: AgentsLayerPaths; workspaceLayer: AgentsLayerPaths | null } {
    const globalLayer = getAgentsLayerPaths(globalAgentsFolder)
    const workspaceAgentsFolder = resolveWorkspaceAgentsFolder()
    const workspaceLayer = workspaceAgentsFolder ? getAgentsLayerPaths(workspaceAgentsFolder) : null
    return { globalLayer, workspaceLayer }
  }

  private coerceLegacyMemory(item: unknown): AgentMemory | null {
    if (typeof item !== "object" || item === null) return null
    const obj = item as Record<string, unknown>

    const id = asString(obj.id)
    const content = asString(obj.content)
    if (!id || !content) return null

    const createdAt = asNumber(obj.createdAt) ?? Date.now()
    const updatedAt = asNumber(obj.updatedAt) ?? createdAt
    const importance = (VALID_IMPORTANCE_VALUES.includes(String(obj.importance) as any)
      ? (String(obj.importance) as any)
      : "medium") as AgentMemory["importance"]

    const memory: AgentMemory = {
      id,
      createdAt,
      updatedAt,
      profileId: asString(obj.profileId),
      sessionId: asString(obj.sessionId),
      conversationId: asString(obj.conversationId),
      conversationTitle: asString(obj.conversationTitle),
      title: normalizeSingleLine(asString(obj.title) ?? content).slice(0, 100),
      content: normalizeSingleLine(content),
      tags: asStringArray(obj.tags),
      importance,
      keyFindings: asStringArray(obj.keyFindings),
      userNotes: asString(obj.userNotes),
    }

    return normalizeMemoryForRuntime(memory)
  }

  private migrateLegacyMemoriesJson(globalLayer: AgentsLayerPaths, existingIds: Set<string>): void {
    const legacyPath = getLegacyMemoriesFilePath()
    try {
      if (!fs.existsSync(legacyPath)) return
    } catch {
      return
    }

    let parsed: unknown
    try {
      const raw = fs.readFileSync(legacyPath, "utf-8")
      parsed = JSON.parse(raw)
    } catch {
      return
    }

    if (!Array.isArray(parsed)) return

    let imported = 0
    for (const item of parsed) {
      const coerced = this.coerceLegacyMemory(item)
      if (!coerced) continue
      if (existingIds.has(coerced.id)) continue

      try {
        writeAgentsMemoryFile(globalLayer, coerced, { maxBackups: 10 })
        existingIds.add(coerced.id)
        imported++
      } catch {
        // best-effort
      }
    }

    if (imported > 0 && isDebugLLM()) {
      logLLM(`[MemoryService] Migrated ${imported} legacy memories into .agents/memories`) 
    }
  }

  private backupThenDeleteFileSync(filePath: string, backupDir: string): void {
    const raw = readTextFileIfExistsSync(filePath, "utf8")
    if (raw !== null) {
      // Create a snapshot backup using the same naming/rotation rules as safe writes.
      safeWriteFileSync(filePath, raw, {
        encoding: "utf8",
        backupDir,
        maxBackups: 10,
      })
    }
    fs.rmSync(filePath, { force: true })
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const { globalLayer, workspaceLayer } = this.getLayers()

      // Load global first so we can avoid duplicating IDs during legacy migration.
      const globalLoaded = loadAgentsMemoriesLayer(globalLayer)
      const existingIds = new Set(globalLoaded.memories.map((m) => m.id))

      // Best-effort migration from legacy JSON (only imports missing IDs).
      this.migrateLegacyMemoriesJson(globalLayer, existingIds)

      const globalAfter = loadAgentsMemoriesLayer(globalLayer)
      const workspaceLoaded = workspaceLayer ? loadAgentsMemoriesLayer(workspaceLayer) : null

      const mergedById = new Map<string, AgentMemory>()
      const originById = new Map<string, MemoryOrigin>()

      for (const mem of globalAfter.memories) {
        const origin = globalAfter.originById.get(mem.id)
        mergedById.set(mem.id, normalizeMemoryForRuntime(mem))
        if (origin) originById.set(mem.id, { layer: "global", filePath: origin.filePath })
      }

      if (workspaceLoaded) {
        for (const mem of workspaceLoaded.memories) {
          const origin = workspaceLoaded.originById.get(mem.id)
          mergedById.set(mem.id, normalizeMemoryForRuntime(mem))
          if (origin) originById.set(mem.id, { layer: "workspace", filePath: origin.filePath })
        }
      }

      this.memories = Array.from(mergedById.values())
      this.originById = originById
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error loading memories:", error)
      }
      this.memories = []
      this.originById = new Map()
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

    const normalized = normalizeMemoryForRuntime(memory)
    const existingIndex = this.memories.findIndex((m) => m.id === normalized.id)
    const previousMemory = existingIndex >= 0 ? this.memories[existingIndex] : null
    const previousOrigin = this.originById.get(normalized.id)

    const { globalLayer, workspaceLayer } = this.getLayers()

    const targetLayerName = previousOrigin?.layer ?? "global"
    const targetLayer = targetLayerName === "workspace" && workspaceLayer ? workspaceLayer : globalLayer

    try {
      const { filePath } = writeAgentsMemoryFile(targetLayer, normalized, {
        filePathOverride: previousOrigin?.filePath,
        maxBackups: 10,
      })

      if (existingIndex >= 0) {
        this.memories[existingIndex] = normalized
      } else {
        this.memories.push(normalized)
      }

      this.originById.set(normalized.id, { layer: targetLayerName, filePath })

      if (isDebugLLM()) {
        logLLM("[MemoryService] Saved memory:", normalized.id)
      }
      return true
    } catch (error) {
      // Roll back the in-memory change
      if (previousMemory && existingIndex >= 0) {
        this.memories[existingIndex] = previousMemory
      } else if (existingIndex < 0) {
        this.memories = this.memories.filter((m) => m.id !== normalized.id)
      }

      if (previousOrigin) {
        this.originById.set(normalized.id, previousOrigin)
      } else {
        this.originById.delete(normalized.id)
      }

      if (isDebugLLM()) {
        logLLM("[MemoryService] Error saving memory:", error)
      }
      return false
    }
  }

  createMemoryFromSummary(
    summary: AgentStepSummary,
    title?: string,
    userNotes?: string,
    tags?: string[],
    conversationTitle?: string,
    conversationId?: string,
    profileId?: string,
  ): AgentMemory | null {
    const now = Date.now()

    // Prefer durable memory candidates (preferences/constraints/decisions/facts/insights)
    // over step telemetry (actionSummary).
    const memoryCandidates = (Array.isArray(summary.memoryCandidates) ? summary.memoryCandidates : [])
      .filter((c): c is string => typeof c === "string")
      .map(normalizeSingleLine)
      .filter(Boolean)
      .filter(c => {
        const colonIdx = c.indexOf(":")
        if (colonIdx < 0) return false
        const prefix = c.slice(0, colonIdx).toLowerCase().trim()
        const payload = c.slice(colonIdx + 1).trim()
        return !!prefix && MEMORY_CANDIDATE_TYPES.has(prefix) && payload.length > 0
      })

    const selectedCandidates = memoryCandidates.slice(0, 3)
    const derivedTags = selectedCandidates
      .map(c => c.split(":")[0]?.toLowerCase().trim())
      .filter((t): t is string => !!t && MEMORY_CANDIDATE_TYPES.has(t))

    const decisionsMade = Array.isArray(summary.decisionsMade)
      ? summary.decisionsMade.filter((d): d is string => typeof d === "string")
      : []
    const keyFindings = Array.isArray(summary.keyFindings)
      ? summary.keyFindings.filter((f): f is string => typeof f === "string")
      : []

    const MAX_ITEM_LENGTH = 240
    const contentFromCandidates =
      selectedCandidates.length > 0 ? selectedCandidates.map(s => s.slice(0, MAX_ITEM_LENGTH)).join(" | ") : undefined
    const contentFromDecisions =
      decisionsMade.length > 0
        ? decisionsMade.map(normalizeSingleLine).filter(Boolean).map(s => s.slice(0, MAX_ITEM_LENGTH)).slice(0, 3).join(" | ")
        : undefined
    const contentFromFindings =
      keyFindings.length > 0
        ? keyFindings.map(normalizeSingleLine).filter(Boolean).map(s => s.slice(0, MAX_ITEM_LENGTH)).slice(0, 3).join(" | ")
        : undefined

    // If there are no durable items, don't create a memory.
    const chosenContent = normalizeSingleLine(
      contentFromCandidates || contentFromDecisions || contentFromFindings || "",
    )
    if (!chosenContent) {
      return null
    }

    const safeSummaryTags = Array.isArray(summary.tags) ? summary.tags.filter((t): t is string => typeof t === "string") : []
    const safeInputTags = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : []
    const baseTags = [...safeSummaryTags, ...safeInputTags]
    const mergedTags = Array.from(new Set([...baseTags, ...derivedTags])).filter(Boolean)
    const resolvedTitle = normalizeSingleLine(title || chosenContent).slice(0, 100)

    return {
      id: `memory_${now}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      profileId,
      sessionId: summary.sessionId,
      conversationId,
      conversationTitle,
      title: resolvedTitle,
      content: chosenContent,
      keyFindings,
      tags: mergedTags,
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

    const updated: AgentMemory = normalizeMemoryForRuntime({
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    })

    return this.saveMemory(updated)
  }

  async deleteMemory(id: string): Promise<boolean> {
    await this.initialize()
    const index = this.memories.findIndex(m => m.id === id)
    if (index < 0) {
      return false
    }

    const deletedMemory = this.memories[index]
    const origin = this.originById.get(id)

    const { globalLayer, workspaceLayer } = this.getLayers()
    const layer = origin?.layer === "workspace" && workspaceLayer ? workspaceLayer : globalLayer
    const filePath = origin?.filePath ?? memoryIdToFilePath(layer, id)
    const backupDir = getAgentsMemoriesBackupDir(layer)

    try {
      this.backupThenDeleteFileSync(filePath, backupDir)
      this.memories.splice(index, 1)
      this.originById.delete(id)

      if (isDebugLLM()) {
        logLLM("[MemoryService] Deleted memory:", id)
      }
      return true
    } catch (error) {
      // Roll back in-memory state only (disk may be partially changed).
      this.memories.splice(index, 0, deletedMemory)
      if (origin) this.originById.set(id, origin)
      if (isDebugLLM()) {
        logLLM("[MemoryService] Error deleting memory:", error)
      }
      return false
    }
  }

  /**
   * Delete multiple memories by IDs.
   * @param ids Array of memory IDs to delete
   * @param profileId If provided, only delete memories belonging to this profile
   * @returns Object with deletedCount and optional error message on persistence failure
   */
  async deleteMultipleMemories(ids: string[], profileId?: string): Promise<{ deletedCount: number; error?: string }> {
    await this.initialize()

    let deletedCount = 0
    for (const id of ids) {
      const memory = this.memories.find((m) => m.id === id)
      if (!memory) continue
      if (profileId !== undefined && memory.profileId !== profileId) continue

      const success = await this.deleteMemory(id)
      if (!success) {
        return { deletedCount, error: `Failed to delete memory ${id}` }
      }
      deletedCount++
    }

    if (deletedCount > 0 && isDebugLLM()) {
      logLLM("[MemoryService] Deleted multiple memories:", deletedCount)
    }

    return { deletedCount }
  }

  /**
   * Delete all memories, optionally filtered by profile ID.
   * @param profileId If provided, only delete memories for this profile
   * @returns Object with deletedCount and optional error message on persistence failure
   */
  async deleteAllMemories(profileId?: string): Promise<{ deletedCount: number; error?: string }> {
    await this.initialize()

    const idsToDelete = (profileId !== undefined
      ? this.memories.filter((m) => m.profileId === profileId)
      : this.memories
    ).map((m) => m.id)

    let deletedCount = 0
    for (const id of idsToDelete) {
      const success = await this.deleteMemory(id)
      if (!success) {
        return { deletedCount, error: `Failed to delete memory ${id}` }
      }
      deletedCount++
    }

    if (deletedCount > 0 && isDebugLLM()) {
      logLLM("[MemoryService] Deleted all memories:", deletedCount)
    }

    return { deletedCount }
  }
}

export const memoryService = new MemoryService()

