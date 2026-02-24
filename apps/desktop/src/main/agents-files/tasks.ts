import fs from "fs"
import path from "path"
import type { LoopConfig } from "@shared/types"
import type { AgentsLayerPaths } from "./modular-config"
import { AGENTS_TASKS_DIR } from "./modular-config"
import { parseFrontmatterOrBody, stringifyFrontmatterDocument } from "./frontmatter"
import { readTextFileIfExistsSync, safeWriteFileSync } from "./safe-file"

export const TASK_CANONICAL_FILENAME = "task.md"

export type TaskOrigin = {
  filePath: string
}

export type LoadedTasksLayer = {
  tasks: LoopConfig[]
  originById: Map<string, TaskOrigin>
}

// ============================================================================
// Helpers
// ============================================================================

function sanitizeFileComponent(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function parseBoolean(raw: string | undefined, defaultValue: boolean): boolean {
  const trimmed = (raw ?? "").trim().toLowerCase()
  if (!trimmed) return defaultValue
  if (["1", "true", "yes", "y", "on"].includes(trimmed)) return true
  if (["0", "false", "no", "n", "off"].includes(trimmed)) return false
  return defaultValue
}

function parseNumber(raw: string | undefined, defaultValue: number): number {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return defaultValue
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : defaultValue
}

function tryGetFileMtimeMs(filePath: string | undefined): number | undefined {
  if (!filePath) return undefined
  try {
    const stat = fs.statSync(filePath)
    return Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : undefined
  } catch {
    return undefined
  }
}

// ============================================================================
// Path helpers
// ============================================================================

export function getTasksDir(layer: AgentsLayerPaths): string {
  return path.join(layer.agentsDir, AGENTS_TASKS_DIR)
}

export function getTasksBackupDir(layer: AgentsLayerPaths): string {
  return path.join(layer.backupsDir, AGENTS_TASKS_DIR)
}

export function taskIdToDirPath(layer: AgentsLayerPaths, id: string): string {
  return path.join(getTasksDir(layer), sanitizeFileComponent(id))
}

export function taskIdToFilePath(layer: AgentsLayerPaths, id: string): string {
  return path.join(taskIdToDirPath(layer, id), TASK_CANONICAL_FILENAME)
}

// ============================================================================
// Stringify task.md
// ============================================================================

export function stringifyTaskMarkdown(task: LoopConfig): string {
  const frontmatter: Record<string, string> = {
    kind: "task",
    id: task.id,
    name: task.name,
    intervalMinutes: String(task.intervalMinutes),
    enabled: String(task.enabled),
  }

  if (task.profileId) frontmatter.profileId = task.profileId
  if (task.runOnStartup) frontmatter.runOnStartup = "true"
  if (task.lastRunAt) frontmatter.lastRunAt = String(task.lastRunAt)

  return stringifyFrontmatterDocument({ frontmatter, body: task.prompt || "" })
}

// ============================================================================
// Parse task.md
// ============================================================================

export function parseTaskMarkdown(
  markdown: string,
  options: { fallbackId?: string; filePath?: string } = {},
): LoopConfig | null {
  const { frontmatter: fm, body } = parseFrontmatterOrBody(markdown)

  const fallbackId = options.fallbackId?.trim()
  const id = (fm.id ?? "").trim() || fallbackId || (fm.name ?? "").trim()
  if (!id) return null

  const name = (fm.name ?? "").trim() || id
  const intervalMinutes = parseNumber(fm.intervalMinutes, 60)

  return {
    id,
    name,
    prompt: body.trim(),
    intervalMinutes: Math.max(1, intervalMinutes),
    enabled: parseBoolean(fm.enabled, true),
    profileId: (fm.profileId ?? "").trim() || undefined,
    runOnStartup: parseBoolean(fm.runOnStartup, false) || undefined,
    lastRunAt: fm.lastRunAt ? parseNumber(fm.lastRunAt, 0) || undefined : undefined,
  }
}

// ============================================================================
// Load all tasks from a layer
// ============================================================================

export function loadTasksLayer(layer: AgentsLayerPaths): LoadedTasksLayer {
  const tasks: LoopConfig[] = []
  const originById = new Map<string, TaskOrigin>()

  const tasksDir = getTasksDir(layer)

  try {
    if (!fs.existsSync(tasksDir) || !fs.statSync(tasksDir).isDirectory()) {
      return { tasks, originById }
    }

    const entries = fs.readdirSync(tasksDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith(".")) continue

      const taskDir = path.join(tasksDir, entry.name)
      const taskMdPath = path.join(taskDir, TASK_CANONICAL_FILENAME)

      const raw = readTextFileIfExistsSync(taskMdPath, "utf8")
      if (raw === null) continue

      const task = parseTaskMarkdown(raw, {
        fallbackId: entry.name,
        filePath: taskMdPath,
      })
      if (!task) continue

      tasks.push(task)
      originById.set(task.id, { filePath: taskMdPath })
    }
  } catch {
    // best-effort
  }

  return { tasks, originById }
}

// ============================================================================
// Write a single task to task.md
// ============================================================================

export function writeTaskFile(
  layer: AgentsLayerPaths,
  task: LoopConfig,
  options: { maxBackups?: number } = {},
): void {
  const maxBackups = options.maxBackups ?? 10
  const backupDir = getTasksBackupDir(layer)

  const taskDir = taskIdToDirPath(layer, task.id)
  fs.mkdirSync(taskDir, { recursive: true })

  const mdContent = stringifyTaskMarkdown(task)
  const mdPath = path.join(taskDir, TASK_CANONICAL_FILENAME)
  safeWriteFileSync(mdPath, mdContent, { backupDir, maxBackups })
}

// ============================================================================
// Write all tasks for a layer
// ============================================================================

export function writeAllTaskFiles(
  layer: AgentsLayerPaths,
  tasks: LoopConfig[],
  options: { maxBackups?: number; onlyIfMissing?: boolean } = {},
): void {
  const tasksDir = getTasksDir(layer)
  fs.mkdirSync(tasksDir, { recursive: true })

  for (const task of tasks) {
    if (options.onlyIfMissing) {
      const mdPath = taskIdToFilePath(layer, task.id)
      if (fs.existsSync(mdPath)) continue
    }
    writeTaskFile(layer, task, options)
  }
}

// ============================================================================
// Delete a task's directory
// ============================================================================

export function deleteTaskFiles(layer: AgentsLayerPaths, taskId: string): void {
  const taskDir = taskIdToDirPath(layer, taskId)
  try {
    if (fs.existsSync(taskDir)) {
      fs.rmSync(taskDir, { recursive: true, force: true })
    }
  } catch {
    // best-effort
  }
}

