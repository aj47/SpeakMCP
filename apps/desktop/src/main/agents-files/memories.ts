import fs from "fs"
import path from "path"
import type { AgentMemory } from "@shared/types"
import type { AgentsLayerPaths } from "./modular-config"
import { parseFrontmatterOrBody, stringifyFrontmatterDocument } from "./frontmatter"
import { readTextFileIfExistsSync, safeWriteFileSync } from "./safe-file"

export const AGENTS_MEMORIES_DIR = "memories"

export type AgentsMemoryOrigin = {
  filePath: string
}

export type LoadedAgentsMemoriesLayer = {
  memories: AgentMemory[]
  originById: Map<string, AgentsMemoryOrigin>
}

const VALID_IMPORTANCE_VALUES = new Set(["low", "medium", "high", "critical"])

function normalizeSingleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
}

function parseListValue(raw: string | undefined): string[] {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return []

  // Allow JSON array values in addition to CSV for robustness.
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
      }
    } catch {
      // fall through to CSV
    }
  }

  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatListValue(values: string[] | undefined): string {
  const list = Array.isArray(values) ? values : []
  return list.map(normalizeSingleLine).filter(Boolean).join(", ")
}

function sanitizeFileComponent(name: string): string {
  // Keep filenames stable and portable across platforms.
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export function getAgentsMemoriesDir(layer: AgentsLayerPaths): string {
  return path.join(layer.agentsDir, AGENTS_MEMORIES_DIR)
}

export function getAgentsMemoriesBackupDir(layer: AgentsLayerPaths): string {
  return path.join(layer.backupsDir, AGENTS_MEMORIES_DIR)
}

export function memoryIdToFilePath(layer: AgentsLayerPaths, id: string): string {
  return path.join(getAgentsMemoriesDir(layer), `${sanitizeFileComponent(id)}.md`)
}

export function stringifyMemoryMarkdown(memory: AgentMemory): string {
  const tags = formatListValue(memory.tags)
  const keyFindings = formatListValue(memory.keyFindings)

  const frontmatter: Record<string, string> = {
    kind: "memory",
    id: memory.id,
    createdAt: String(memory.createdAt),
    updatedAt: String(memory.updatedAt),
    title: normalizeSingleLine(memory.title),
    content: normalizeSingleLine(memory.content),
    importance: memory.importance,
  }

  if (memory.profileId) frontmatter.profileId = memory.profileId
  if (memory.sessionId) frontmatter.sessionId = memory.sessionId
  if (memory.conversationId) frontmatter.conversationId = memory.conversationId
  if (memory.conversationTitle) frontmatter.conversationTitle = normalizeSingleLine(memory.conversationTitle)

  if (tags) frontmatter.tags = tags
  if (keyFindings) frontmatter.keyFindings = keyFindings

  return stringifyFrontmatterDocument({
    frontmatter,
    body: (memory.userNotes ?? "").trim(),
  })
}

export function parseMemoryMarkdown(markdown: string, options: { fallbackId?: string } = {}): AgentMemory | null {
  const doc = parseFrontmatterOrBody(markdown)
  const fm = doc.frontmatter

  const id = (fm.id ?? options.fallbackId ?? "").trim()
  const content = normalizeSingleLine(fm.content ?? "")
  const title = normalizeSingleLine(fm.title ?? content)

  if (!id || !content) return null

  const createdAtRaw = Number(fm.createdAt)
  const updatedAtRaw = Number(fm.updatedAt)
  const now = Date.now()

  const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : now
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : createdAt

  const importanceRaw = (fm.importance ?? "medium").trim()
  const importance = (VALID_IMPORTANCE_VALUES.has(importanceRaw)
    ? importanceRaw
    : "medium") as AgentMemory["importance"]

  const tags = parseListValue(fm.tags)
  const keyFindings = parseListValue(fm.keyFindings)

  const memory: AgentMemory = {
    id,
    createdAt,
    updatedAt,
    profileId: (fm.profileId ?? "").trim() || undefined,
    sessionId: (fm.sessionId ?? "").trim() || undefined,
    conversationId: (fm.conversationId ?? "").trim() || undefined,
    conversationTitle: (fm.conversationTitle ?? "").trim() || undefined,
    title: title || content.slice(0, 80),
    content,
    tags,
    importance,
    // Keep UI stable: always provide arrays.
    keyFindings,
    userNotes: doc.body.trim() || undefined,
  }

  return memory
}

export function loadAgentsMemoriesLayer(layer: AgentsLayerPaths): LoadedAgentsMemoriesLayer {
  const memories: AgentMemory[] = []
  const originById = new Map<string, AgentsMemoryOrigin>()

  const memoriesDir = getAgentsMemoriesDir(layer)

  try {
    if (!fs.existsSync(memoriesDir) || !fs.statSync(memoriesDir).isDirectory()) {
      return { memories, originById }
    }

    const entries = fs.readdirSync(memoriesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith(".md")) continue

      const filePath = path.join(memoriesDir, entry.name)
      const raw = readTextFileIfExistsSync(filePath, "utf8")
      if (raw === null) continue

      const fallbackId = entry.name.replace(/\.md$/i, "")
      const parsed = parseMemoryMarkdown(raw, { fallbackId })
      if (!parsed) continue

      // If duplicates exist, keep the newest updatedAt.
      const existing = originById.get(parsed.id)
      if (existing) {
        const existingMemory = memories.find((m) => m.id === parsed.id)
        if (existingMemory && existingMemory.updatedAt > parsed.updatedAt) continue
        // Replace existing in-place
        const idx = memories.findIndex((m) => m.id === parsed.id)
        if (idx >= 0) memories[idx] = parsed
      } else {
        memories.push(parsed)
      }

      originById.set(parsed.id, { filePath })
    }
  } catch {
    // best-effort
  }

  return { memories, originById }
}

export function writeAgentsMemoryFile(
  layer: AgentsLayerPaths,
  memory: AgentMemory,
  options: { filePathOverride?: string; maxBackups?: number } = {},
): { filePath: string } {
  const filePath = options.filePathOverride ?? memoryIdToFilePath(layer, memory.id)
  const backupDir = getAgentsMemoriesBackupDir(layer)
  const maxBackups = options.maxBackups ?? 10
  const markdown = stringifyMemoryMarkdown(memory)

  safeWriteFileSync(filePath, markdown, {
    encoding: "utf8",
    backupDir,
    maxBackups,
  })

  return { filePath }
}
