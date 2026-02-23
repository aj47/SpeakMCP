import fs from "fs"
import path from "path"
import type { AgentSkill } from "@shared/types"
import type { AgentsLayerPaths } from "./modular-config"
import { parseFrontmatterOrBody, stringifyFrontmatterDocument } from "./frontmatter"
import { readTextFileIfExistsSync, safeWriteFileSync } from "./safe-file"

export const AGENTS_SKILLS_DIR = "skills"
export const AGENTS_SKILL_CANONICAL_FILENAME = "skill.md"

export type AgentsSkillOrigin = {
  filePath: string
}

export type LoadedAgentsSkillsLayer = {
  skills: AgentSkill[]
  originById: Map<string, AgentsSkillOrigin>
}

function normalizeSingleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
}

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

function normalizeRelativeId(relDir: string): string {
  const normalized = relDir.split(path.sep).join("/")
  return normalized.replace(/^\.\/?/, "").replace(/\/$/, "")
}

function tryGetFileMtimeMs(filePath: string | undefined): number | undefined {
  if (!filePath) return undefined
  try {
    const stat = fs.statSync(filePath)
    const mtime = stat.mtimeMs
    if (!Number.isFinite(mtime)) return undefined
    return Math.floor(mtime)
  } catch {
    return undefined
  }
}

function resolveSkillExecutionFilePath(
  rawFrontmatterFilePath: string | undefined,
  originFilePath: string | undefined,
): string | undefined {
  const raw = (rawFrontmatterFilePath ?? "").trim()
  if (!raw) return undefined
  if (raw.startsWith("github:")) return raw
  if (path.isAbsolute(raw)) return raw

  // Resolve relative paths against the skill file's directory so the config is portable.
  if (!originFilePath) return raw
  return path.resolve(path.dirname(originFilePath), raw)
}

function toPortableSkillExecutionFilePathFrontmatterValue(
  executionFilePath: string,
  originFilePath: string | undefined,
): string | undefined {
  const raw = (executionFilePath ?? "").trim()
  if (!raw) return undefined
  if (raw.startsWith("github:")) return raw
  if (!originFilePath) return raw

  // If execution path is the skill file itself, omit (default behaviour).
  try {
    const originNormalized = path.normalize(originFilePath)
    const execNormalized = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.resolve(path.dirname(originFilePath), raw))
    if (originNormalized === execNormalized) return undefined

    // Prefer a relative path for portability when on the same volume/root.
    if (path.isAbsolute(execNormalized)) {
      const originRoot = path.parse(path.dirname(originNormalized)).root
      const execRoot = path.parse(execNormalized).root
      if (originRoot && execRoot && originRoot !== execRoot) return execNormalized

      const rel = path.relative(path.dirname(originNormalized), execNormalized)
      return rel.split(path.sep).join("/")
    }

    return execNormalized.split(path.sep).join("/")
  } catch {
    return raw
  }
}

export function getAgentsSkillsDir(layer: AgentsLayerPaths): string {
  return path.join(layer.agentsDir, AGENTS_SKILLS_DIR)
}

export function getAgentsSkillsBackupDir(layer: AgentsLayerPaths): string {
  return path.join(layer.backupsDir, AGENTS_SKILLS_DIR)
}

export function skillIdToDirPath(layer: AgentsLayerPaths, id: string): string {
  return path.join(getAgentsSkillsDir(layer), sanitizeFileComponent(id))
}

export function skillIdToFilePath(layer: AgentsLayerPaths, id: string): string {
  return path.join(skillIdToDirPath(layer, id), AGENTS_SKILL_CANONICAL_FILENAME)
}

export function stringifySkillMarkdown(skill: AgentSkill, options: { originFilePath?: string } = {}): string {
  const frontmatter: Record<string, string> = {
    kind: "skill",
    id: skill.id,
    name: normalizeSingleLine(skill.name),
    description: normalizeSingleLine(skill.description),
    enabled: String(skill.enabled),
    createdAt: String(skill.createdAt),
    updatedAt: String(skill.updatedAt),
  }

  if (skill.source) frontmatter.source = skill.source

  const executionFilePathValue = skill.filePath
    ? toPortableSkillExecutionFilePathFrontmatterValue(skill.filePath, options.originFilePath)
    : undefined
  if (executionFilePathValue) frontmatter.filePath = executionFilePathValue

  return stringifyFrontmatterDocument({ frontmatter, body: skill.instructions })
}

export function parseSkillMarkdown(
  markdown: string,
  options: { fallbackId?: string; filePath?: string } = {},
): AgentSkill | null {
  const { frontmatter, body } = parseFrontmatterOrBody(markdown)

  const fallbackId = options.fallbackId?.trim()
  const id = (frontmatter.id ?? "").trim() || fallbackId || (frontmatter.name ?? "").trim()
  if (!id) return null

  const name = (frontmatter.name ?? "").trim() || id
  const description = (frontmatter.description ?? "").trim()
  const enabled = parseBoolean(frontmatter.enabled, true)

  const stableNow = tryGetFileMtimeMs(options.filePath) ?? Date.now()
  const createdAt = parseNumber(frontmatter.createdAt, stableNow)
  const updatedAt = parseNumber(frontmatter.updatedAt, createdAt)

  const sourceRaw = (frontmatter.source ?? "").trim()
  const source = sourceRaw === "local" || sourceRaw === "imported" ? sourceRaw : undefined

  const executionFilePath = resolveSkillExecutionFilePath(frontmatter.filePath, options.filePath)

  return {
    id,
    name,
    description,
    instructions: body.trim(),
    enabled,
    createdAt,
    updatedAt,
    source,
    filePath: executionFilePath ?? options.filePath,
  }
}

function isSkillMarkdownFileName(name: string): boolean {
  return name === "skill.md" || name === "SKILL.md"
}

export function loadAgentsSkillsLayer(layer: AgentsLayerPaths): LoadedAgentsSkillsLayer {
  const skills: AgentSkill[] = []
  const originById = new Map<string, AgentsSkillOrigin>()

  const skillsDir = getAgentsSkillsDir(layer)

  try {
    if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
      return { skills, originById }
    }

    const scanDirectory = (dirPath: string, depth: number): void => {
      if (depth > 8) return
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        const entryPath = path.join(dirPath, entry.name)

        if (entry.isDirectory()) {
          scanDirectory(entryPath, depth + 1)
          continue
        }

        if (!entry.isFile()) continue
        if (!isSkillMarkdownFileName(entry.name)) continue

        const filePath = entryPath
        const raw = readTextFileIfExistsSync(filePath, "utf8")
        if (raw === null) continue

        const relDir = path.relative(skillsDir, path.dirname(filePath))
        const normalizedRelDir = normalizeRelativeId(relDir)
        const fallbackId = normalizedRelDir || undefined

        const parsed = parseSkillMarkdown(raw, { fallbackId, filePath })
        if (!parsed) continue

        const existingOrigin = originById.get(parsed.id)
        if (existingOrigin) {
          const existingSkill = skills.find((s) => s.id === parsed.id)
          if (existingSkill && existingSkill.updatedAt > parsed.updatedAt) continue
          const idx = skills.findIndex((s) => s.id === parsed.id)
          if (idx >= 0) skills[idx] = parsed
        } else {
          skills.push(parsed)
        }

        originById.set(parsed.id, { filePath })
      }
    }

    scanDirectory(skillsDir, 0)
  } catch {
    // best-effort
  }

  return { skills, originById }
}

export function writeAgentsSkillFile(
  layer: AgentsLayerPaths,
  skill: AgentSkill,
  options: { filePathOverride?: string; maxBackups?: number } = {},
): { filePath: string } {
  const filePath = options.filePathOverride ?? skillIdToFilePath(layer, skill.id)
  const backupDir = getAgentsSkillsBackupDir(layer)
  const maxBackups = options.maxBackups ?? 10
  const markdown = stringifySkillMarkdown(skill, { originFilePath: filePath })

  safeWriteFileSync(filePath, markdown, {
    encoding: "utf8",
    backupDir,
    maxBackups,
  })

  return { filePath }
}
