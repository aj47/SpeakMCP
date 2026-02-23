
import { app } from "electron"
import path from "path"
import fs from "fs"
import { AgentSkill, AgentSkillsData } from "@shared/types"
import { randomUUID } from "crypto"
import { logApp } from "./debug"
import { exec } from "child_process"
import { promisify } from "util"
import { getRendererHandlers } from "@egoist/tipc/main"
import type { RendererHandlers } from "./renderer-handlers"
import { WINDOWS } from "./window"
import { globalAgentsFolder, resolveWorkspaceAgentsFolder } from "./config"
import { getAgentsLayerPaths, type AgentsLayerPaths } from "./agents-files/modular-config"
import {
  getAgentsSkillsBackupDir,
  getAgentsSkillsDir,
  loadAgentsSkillsLayer,
  skillIdToFilePath,
  writeAgentsSkillFile,
} from "./agents-files/skills"
import { readTextFileIfExistsSync, safeWriteFileSync } from "./agents-files/safe-file"

type SkillOrigin = {
  layer: "global" | "workspace"
  filePath: string
}

const execAsync = promisify(exec)

/**
 * Common paths where SKILL.md files might be located in a GitHub repo
 */
const SKILL_MD_PATHS = [
  "SKILL.md",
  "skill.md",
  "skills/{name}/SKILL.md",
  ".claude/skills/{name}/SKILL.md",
  ".codex/skills/{name}/SKILL.md",
]

/**
 * Parse a GitHub repo identifier or URL into owner, repo, and optional path
 * Supports formats:
 * - owner/repo
 * - owner/repo/path/to/skill
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/main/path/to/skill
 */
/**
 * Validate a git ref (branch/tag name) to prevent command injection
 * Only allows safe characters: alphanumeric, dots, hyphens, underscores, and forward slashes
 * Must not start with a hyphen to prevent being interpreted as a flag in git commands
 */
function validateGitRef(ref: string): boolean {
  // Git ref names can contain alphanumeric, dots, hyphens, underscores, and slashes
  // But must not contain shell metacharacters like ; & | $ ` ' " ( ) < > etc.
  // Must not start with a hyphen to prevent flag injection (e.g., "-delete" in git checkout)
  if (ref.startsWith("-")) {
    return false
  }
  return /^[a-zA-Z0-9._\-/]+$/.test(ref)
}

/**
 * Validate a GitHub owner or repo name to prevent command injection
 * GitHub usernames/org names: alphanumeric and hyphens, cannot start/end with hyphen, max 39 chars
 * GitHub repo names: alphanumeric, hyphens, underscores, and dots
 * We use a slightly permissive pattern that still blocks shell metacharacters
 * Must not start with a hyphen to prevent flag injection when used in git commands
 */
function validateGitHubIdentifierPart(part: string, type: "owner" | "repo"): boolean {
  if (!part || part.length === 0 || part.length > 100) {
    return false
  }
  // Must not start with a hyphen to prevent flag injection in shell commands
  // (GitHub also doesn't allow usernames starting with hyphens)
  if (part.startsWith("-")) {
    return false
  }
  // Allow alphanumeric, hyphens, underscores, and dots
  // Block shell metacharacters like ; & | $ ` ' " ( ) < > space newline etc.
  return /^[a-zA-Z0-9._-]+$/.test(part)
}

/**
 * Validate a subPath to prevent path traversal attacks.
 * The subPath should not escape the intended directory via ".." or absolute paths.
 */
function validateSubPath(subPath: string): boolean {
  if (!subPath) {
    return true // Empty/null subPath is valid (means no subPath)
  }
  // Reject absolute paths
  if (path.isAbsolute(subPath)) {
    return false
  }
  // Reject paths containing .. (path traversal)
  const normalizedPath = path.normalize(subPath)
  if (normalizedPath.startsWith("..") || normalizedPath.includes(`${path.sep}..${path.sep}`) || normalizedPath.includes(`${path.sep}..`) || normalizedPath.endsWith("..")) {
    return false
  }
  // Also reject if the path after normalization would escape
  // Check each segment for ".."
  const segments = subPath.split(/[/\\]/)
  for (const segment of segments) {
    if (segment === "..") {
      return false
    }
  }
  return true
}

/**
 * Parse a GitHub identifier with support for branch names containing slashes.
 * For /tree/<ref>/... URLs, we store all remaining parts and let the caller
 * resolve the correct ref/path split using the GitHub API.
 */
function parseGitHubIdentifier(input: string): { owner: string; repo: string; path?: string; ref: string; refAndPath?: string[] } {
  // Remove trailing slashes
  input = input.trim().replace(/\/+$/, "")

  // Handle full GitHub URLs
  if (input.startsWith("https://github.com/") || input.startsWith("http://github.com/")) {
    const url = new URL(input)
    const parts = url.pathname.split("/").filter(Boolean)

    if (parts.length < 2) {
      throw new Error("Invalid GitHub URL: must include owner and repo")
    }

    const owner = parts[0]
    const repo = parts[1]
    let ref = "main"
    let subPath: string | undefined
    let refAndPath: string[] | undefined

    // Handle /tree/branch/path or /blob/branch/path URLs
    // Note: Branch names can contain slashes (e.g., "feature/foo"), so we can't simply
    // assume parts[3] is the full branch name. We store all remaining parts and let
    // the caller resolve the correct split using the GitHub API.
    if (parts.length > 2 && (parts[2] === "tree" || parts[2] === "blob")) {
      if (parts.length > 3) {
        // Store all parts after tree/blob for later resolution
        refAndPath = parts.slice(3)
        // Use first segment as initial ref guess (will be resolved later)
        ref = parts[3]
        if (parts.length > 4) {
          subPath = parts.slice(4).join("/")
        }
      }
    } else if (parts.length > 2) {
      // Simple path without /tree/ or /blob/
      subPath = parts.slice(2).join("/")
    }

    return { owner, repo, path: subPath, ref, refAndPath }
  }

  // Handle owner/repo format (with optional path)
  const parts = input.split("/").filter(Boolean)

  if (parts.length < 2) {
    throw new Error("Invalid GitHub identifier: expected 'owner/repo' or 'owner/repo/path'")
  }

  const owner = parts[0]
  const repo = parts[1]
  const subPath = parts.length > 2 ? parts.slice(2).join("/") : undefined

  return { owner, repo, path: subPath, ref: "main" }
}

/**
 * Fetch the default branch for a GitHub repository.
 * This handles repos that use 'master' or other branch names instead of 'main'.
 */
async function fetchGitHubDefaultBranch(owner: string, repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}`
  logApp(`Fetching GitHub default branch for ${owner}/${repo}`)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "SpeakMCP-SkillInstaller",
      },
    })
    if (!response.ok) {
      logApp(`Failed to fetch repo info, falling back to 'main': ${response.status}`)
      return "main"
    }
    const data = await response.json()
    const defaultBranch = data.default_branch || "main"
    logApp(`Detected default branch: ${defaultBranch}`)
    return defaultBranch
  } catch (error) {
    logApp(`Failed to fetch default branch, falling back to 'main':`, error)
    return "main"
  }
}

/**
 * Resolve a ref/path split from URL parts by checking against valid branches.
 * For URLs like /tree/feature/foo/path/to/skill, we need to determine where
 * the branch name ends and the path begins.
 * 
 * This function tries progressively longer ref candidates until it finds one
 * that exists as a valid branch/tag in the repository.
 * 
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param refAndPath - Array of path segments after /tree/ or /blob/
 * @returns Resolved ref and path, or null if resolution fails
 */
async function resolveRefAndPath(
  owner: string, 
  repo: string, 
  refAndPath: string[]
): Promise<{ ref: string; path?: string } | null> {
  if (refAndPath.length === 0) {
    return null
  }

  // Try progressively longer refs
  // For ["feature", "foo", "path", "to", "skill"], try:
  // 1. "feature" with path "foo/path/to/skill"
  // 2. "feature/foo" with path "path/to/skill"
  // 3. "feature/foo/path" with path "to/skill"
  // etc.
  for (let i = 1; i <= refAndPath.length; i++) {
    const candidateRef = refAndPath.slice(0, i).join("/")
    const remainingPath = i < refAndPath.length ? refAndPath.slice(i).join("/") : undefined
    
    // Check if this ref exists by trying to fetch the branch/tag info
    const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(candidateRef)}`
    
    try {
      const response = await fetch(refUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "SpeakMCP-SkillInstaller",
        },
      })
      
      if (response.ok) {
        logApp(`Resolved branch name with slashes: "${candidateRef}"`)
        return { ref: candidateRef, path: remainingPath }
      }
      
      // Also try as a tag
      const tagUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(candidateRef)}`
      const tagResponse = await fetch(tagUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "SpeakMCP-SkillInstaller",
        },
      })
      
      if (tagResponse.ok) {
        logApp(`Resolved tag name with slashes: "${candidateRef}"`)
        return { ref: candidateRef, path: remainingPath }
      }
    } catch {
      // Continue trying other candidates
    }
  }

  // If no valid ref found, return the first segment as ref (fallback behavior)
  logApp(`Could not resolve ref from URL parts, using first segment: "${refAndPath[0]}"`)
  return {
    ref: refAndPath[0],
    path: refAndPath.length > 1 ? refAndPath.slice(1).join("/") : undefined
  }
}

/**
 * Fetch content from a GitHub raw URL
 */
async function fetchGitHubRaw(owner: string, repo: string, ref: string, filePath: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`
  logApp(`Fetching GitHub raw: ${url}`)

  try {
    const response = await fetch(url)
    if (!response.ok) {
      if (response.status === 404) {
        return null // File not found, try another path
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return await response.text()
  } catch (error) {
    logApp(`Failed to fetch ${url}:`, error)
    return null
  }
}

/**
 * List files in a GitHub directory using the API
 */
async function listGitHubDirectory(owner: string, repo: string, ref: string, dirPath: string): Promise<string[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${ref}`
  logApp(`Listing GitHub directory: ${url}`)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "SpeakMCP-SkillInstaller",
      },
    })
    if (!response.ok) {
      return []
    }
    const data = await response.json()
    if (!Array.isArray(data)) {
      return []
    }
    return data.map((item: { name: string }) => item.name)
  } catch {
    return []
  }
}

// Skills are stored in a JSON file in the app data folder
export const skillsPath = path.join(
  app.getPath("appData"),
  process.env.APP_ID,
  "skills.json"
)

// Skills folder for SKILL.md files in App Data (user-writable location)
// This is the single canonical location for all skills across all platforms:
// - macOS: ~/Library/Application Support/app.speakmcp/skills/
// - Windows: %APPDATA%/app.speakmcp/skills/
// - Linux: ~/.config/app.speakmcp/skills/
export const skillsFolder = path.join(
  app.getPath("appData"),
  process.env.APP_ID,
  "skills"
)

/**
 * Get the path to bundled skills (shipped with the app)
 * In development: apps/desktop/resources/bundled-skills
 * In production: resources/bundled-skills (in extraResources)
 */
function getBundledSkillsPath(): string {
  if (process.env.NODE_ENV === "development" || process.env.ELECTRON_RENDERER_URL) {
    // Development: use paths relative to the app directory
    return path.join(app.getAppPath(), "resources", "bundled-skills")
  } else {
    // Production: use paths relative to app resources (bundled in extraResources)
    const resourcesDir = process.resourcesPath || app.getAppPath()
    return path.join(resourcesDir, "bundled-skills")
  }
}

/**
 * Recursively copy a directory
 * Cross-platform compatible using Node.js fs module
 */
function copyDirRecursive(src: string, dest: string): void {
  // Create destination directory if it doesn't exist
  fs.mkdirSync(dest, { recursive: true })

  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Initialize bundled skills by copying them to the App Data skills folder.
 * This is called on app startup to ensure bundled skills are available.
 * Skills are only copied if they don't already exist (preserves user modifications).
 */
export function initializeBundledSkills(): { copied: string[]; skipped: string[]; errors: string[] } {
  const bundledPath = getBundledSkillsPath()
  const result = { copied: [] as string[], skipped: [] as string[], errors: [] as string[] }

  // Canonical destination: global .agents/skills/
  const globalLayer = getAgentsLayerPaths(globalAgentsFolder)
  const destSkillsDir = getAgentsSkillsDir(globalLayer)

  logApp(`Initializing bundled skills from: ${bundledPath}`)
  logApp(`Canonical skills destination: ${destSkillsDir}`)

  // Check if bundled skills directory exists
  if (!fs.existsSync(bundledPath)) {
    logApp("No bundled skills directory found, skipping initialization")
    return result
  }

  // Ensure canonical skills folder exists
  fs.mkdirSync(destSkillsDir, { recursive: true })

  try {
    // Recursively find all skill directories (directories containing SKILL.md or skill.md)
    const processDirectory = (dirPath: string, relativePath: string = "") => {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const entryPath = path.join(dirPath, entry.name)
        const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name
        const skillMdPath = fs.existsSync(path.join(entryPath, "SKILL.md"))
          ? path.join(entryPath, "SKILL.md")
          : fs.existsSync(path.join(entryPath, "skill.md"))
            ? path.join(entryPath, "skill.md")
            : null

        if (skillMdPath) {
          // This is a skill directory - copy it if it doesn't exist in .agents/skills/
          const destPath = path.join(destSkillsDir, entryRelativePath)

          if (fs.existsSync(destPath)) {
            result.skipped.push(entryRelativePath)
            logApp(`Bundled skill already exists, skipping: ${entryRelativePath}`)
          } else {
            try {
              // Ensure parent directory exists
              fs.mkdirSync(path.dirname(destPath), { recursive: true })
              copyDirRecursive(entryPath, destPath)
              result.copied.push(entryRelativePath)
              logApp(`Copied bundled skill: ${entryRelativePath}`)
            } catch (error) {
              const errorMsg = `Failed to copy ${entryRelativePath}: ${error instanceof Error ? error.message : String(error)}`
              result.errors.push(errorMsg)
              logApp(errorMsg)
            }
          }
        } else {
          // Not a skill directory, recurse into it to find nested skills
          processDirectory(entryPath, entryRelativePath)
        }
      }
    }

    processDirectory(bundledPath)
  } catch (error) {
    logApp("Error initializing bundled skills:", error)
    result.errors.push(`Error scanning bundled skills: ${error instanceof Error ? error.message : String(error)}`)
  }

  logApp(`Bundled skills initialization complete: ${result.copied.length} copied, ${result.skipped.length} skipped, ${result.errors.length} errors`)
  return result
}

/**
 * Parse a SKILL.md file content into skill metadata and instructions
 * Format:
 * ---
 * name: skill-name
 * description: Description of what skill does
 * ---
 * 
 * # Instructions
 * [Markdown content]
 */
function parseSkillMarkdown(content: string): { name: string; description: string; instructions: string } | null {
  // Use \r?\n to handle both Unix (LF) and Windows (CRLF) line endings
  const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/)
  
  if (!frontmatterMatch) {
    // No valid frontmatter found - return null to indicate invalid format
    // Note: Skills without frontmatter are not supported; a valid SKILL.md must have
    // YAML frontmatter with at least a 'name' field
    return null
  }

  const frontmatter = frontmatterMatch[1]
  const instructions = frontmatterMatch[2].trim()

  // Parse YAML-like frontmatter (simple key: value pairs)
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m)

  if (!nameMatch) {
    return null
  }

  return {
    name: nameMatch[1].trim(),
    description: descriptionMatch ? descriptionMatch[1].trim() : "",
    instructions,
  }
}

/**
 * Generate SKILL.md content from a skill
 */
function generateSkillMarkdown(skill: AgentSkill): string {
  return `---
name: ${skill.name}
description: ${skill.description}
---

${skill.instructions}
`
}

class SkillsService {
  private skills: AgentSkill[] = []
  private originById: Map<string, SkillOrigin> = new Map()
  private initialized = false

  constructor() {
    // Synchronous initialization to preserve existing call sites.
    this.loadFromDisk({ migrateLegacy: true })
  }

  private ensureInitialized(): void {
    if (this.initialized) return
    this.loadFromDisk({ migrateLegacy: true })
  }

  private getLayers(): { globalLayer: AgentsLayerPaths; workspaceLayer: AgentsLayerPaths | null } {
    const globalLayer = getAgentsLayerPaths(globalAgentsFolder)
    const workspaceAgentsFolder = resolveWorkspaceAgentsFolder()
    const workspaceLayer = workspaceAgentsFolder ? getAgentsLayerPaths(workspaceAgentsFolder) : null
    return { globalLayer, workspaceLayer }
  }

  private sortSkillsStable(skillsArr: AgentSkill[]): AgentSkill[] {
    return skillsArr
      .slice()
      .sort((a, b) => {
        const createdDiff = (a.createdAt ?? 0) - (b.createdAt ?? 0)
        if (createdDiff !== 0) return createdDiff
        const nameDiff = (a.name ?? "").localeCompare(b.name ?? "")
        if (nameDiff !== 0) return nameDiff
        return (a.id ?? "").localeCompare(b.id ?? "")
      })
  }

  private normalizeLegacySkill(raw: Partial<AgentSkill> & { id?: unknown }): AgentSkill | null {
    const id = typeof raw.id === "string" ? raw.id.trim() : ""
    if (!id) return null

    const now = Date.now()
    const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : now
    const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt
    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true

    const sourceRaw = typeof raw.source === "string" ? raw.source : ""
    const source = sourceRaw === "local" || sourceRaw === "imported" ? sourceRaw : undefined

    const filePath = typeof raw.filePath === "string" && raw.filePath.trim() ? raw.filePath.trim() : undefined

    return {
      id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
      description: typeof raw.description === "string" ? raw.description.trim() : "",
      instructions: typeof raw.instructions === "string" ? raw.instructions.trim() : "",
      enabled,
      createdAt,
      updatedAt,
      source,
      filePath,
    }
  }

  private migrateLegacySkillsJsonToAgents(globalLayer: AgentsLayerPaths, existingSkillIds: Set<string>): number {
    if (!fs.existsSync(skillsPath)) return 0

    let data: AgentSkillsData | null = null
    try {
      data = JSON.parse(fs.readFileSync(skillsPath, "utf8")) as AgentSkillsData
    } catch (error) {
      logApp("[SkillsService] Failed to parse legacy skills.json:", error)
      return 0
    }

    if (!data || !Array.isArray(data.skills)) return 0

    let migrated = 0
    for (const candidate of data.skills) {
      const normalized = this.normalizeLegacySkill(candidate)
      if (!normalized) continue
      if (existingSkillIds.has(normalized.id)) continue

      try {
        const targetFilePath = skillIdToFilePath(globalLayer, normalized.id)
        writeAgentsSkillFile(globalLayer, normalized, { filePathOverride: targetFilePath })
        existingSkillIds.add(normalized.id)
        migrated++
      } catch (error) {
        logApp(`[SkillsService] Failed migrating legacy skill ${String((candidate as unknown as Record<string, unknown>)?.id ?? "")}:`, error)
      }
    }

    return migrated
  }

  private loadFromDisk(options: { migrateLegacy?: boolean } = {}): void {
    const { globalLayer, workspaceLayer } = this.getLayers()

    try {
      const globalBefore = loadAgentsSkillsLayer(globalLayer)
      const existingSkillIds = new Set(globalBefore.skills.map((s) => s.id))

      if (options.migrateLegacy !== false) {
        const migratedCount = this.migrateLegacySkillsJsonToAgents(globalLayer, existingSkillIds)
        if (migratedCount > 0) {
          logApp(`[SkillsService] Migrated ${migratedCount} legacy skills into .agents`)
        }
      }

      const globalAfter = loadAgentsSkillsLayer(globalLayer)
      const workspaceLoaded = workspaceLayer ? loadAgentsSkillsLayer(workspaceLayer) : null

      const mergedById = new Map<string, AgentSkill>()
      const mergedOriginById = new Map<string, SkillOrigin>()

      for (const skill of globalAfter.skills) {
        mergedById.set(skill.id, skill)
        const origin = globalAfter.originById.get(skill.id)
        if (origin) mergedOriginById.set(skill.id, { layer: "global", filePath: origin.filePath })
      }

      if (workspaceLoaded) {
        for (const skill of workspaceLoaded.skills) {
          mergedById.set(skill.id, skill)
          const origin = workspaceLoaded.originById.get(skill.id)
          if (origin) mergedOriginById.set(skill.id, { layer: "workspace", filePath: origin.filePath })
        }
      }

      this.skills = this.sortSkillsStable(Array.from(mergedById.values()))
      this.originById = mergedOriginById
      this.initialized = true
    } catch (error) {
      logApp("[SkillsService] Error loading skills from disk:", error)
      this.skills = []
      this.originById = new Map()
      this.initialized = true
    }
  }

  private backupThenDeleteFileSync(filePath: string, backupDir: string): void {
    const raw = readTextFileIfExistsSync(filePath, "utf8")
    if (raw !== null) {
      safeWriteFileSync(filePath, raw, {
        encoding: "utf8",
        backupDir,
        maxBackups: 10,
      })
    }
    try {
      fs.unlinkSync(filePath)
    } catch {
      // best-effort
    }
  }

  getSkills(): AgentSkill[] {
    this.ensureInitialized()
    return this.skills
  }

  getEnabledSkills(): AgentSkill[] {
    return this.getSkills().filter((skill) => skill.enabled)
  }

  getSkill(id: string): AgentSkill | undefined {
    return this.getSkills().find((s) => s.id === id)
  }

  getSkillByFilePath(filePath: string): AgentSkill | undefined {
    return this.getSkills().find((s) => s.filePath === filePath)
  }

  createSkill(
    name: string,
    description: string,
    instructions: string,
    options?: { source?: "local" | "imported"; filePath?: string }
  ): AgentSkill {
    this.ensureInitialized()

    const { globalLayer } = this.getLayers()
    const id = randomUUID()
    const originFilePath = skillIdToFilePath(globalLayer, id)
    const now = Date.now()

    const newSkill: AgentSkill = {
      id,
      name,
      description,
      instructions,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      source: options?.source ?? "local",
      // Runtime execution context for execute_command.
      filePath: options?.filePath ?? originFilePath,
    }

    writeAgentsSkillFile(globalLayer, newSkill, { filePathOverride: originFilePath })

    // Update in-memory view.
    this.skills = this.sortSkillsStable([...this.skills, newSkill])
    this.originById.set(id, { layer: "global", filePath: originFilePath })
    return newSkill
  }

  updateSkill(id: string, updates: Partial<Pick<AgentSkill, "name" | "description" | "instructions" | "enabled">>): AgentSkill {
    this.ensureInitialized()

    const index = this.skills.findIndex((s) => s.id === id)
    if (index < 0) {
      throw new Error(`Skill with id ${id} not found`)
    }

    const previousSkill = this.skills[index]
    const previousOrigin = this.originById.get(id)

    const now = Date.now()
    const updatedSkill: AgentSkill = {
      ...previousSkill,
      ...updates,
      updatedAt: now,
    }

    const { globalLayer, workspaceLayer } = this.getLayers()
    const targetLayerName = previousOrigin?.layer === "workspace" && workspaceLayer ? "workspace" : "global"
    const targetLayer = targetLayerName === "workspace" && workspaceLayer ? workspaceLayer : globalLayer
    const originFilePath = previousOrigin?.filePath ?? skillIdToFilePath(targetLayer, id)

    try {
      writeAgentsSkillFile(targetLayer, updatedSkill, { filePathOverride: originFilePath })

      this.skills[index] = updatedSkill
      this.skills = this.sortSkillsStable(this.skills)
      this.originById.set(id, { layer: targetLayerName, filePath: originFilePath })
      return updatedSkill
    } catch (error) {
      // Roll back in-memory state only.
      this.skills[index] = previousSkill
      if (previousOrigin) this.originById.set(id, previousOrigin)
      else this.originById.delete(id)
      throw error
    }
  }

  deleteSkill(id: string): boolean {
    this.ensureInitialized()

    const index = this.skills.findIndex((s) => s.id === id)
    if (index < 0) {
      return false
    }

    const deletedSkill = this.skills[index]
    const origin = this.originById.get(id)

    const { globalLayer, workspaceLayer } = this.getLayers()
    const layerName = origin?.layer === "workspace" && workspaceLayer ? "workspace" : "global"
    const layer = layerName === "workspace" && workspaceLayer ? workspaceLayer : globalLayer
    const wrapperFilePath = origin?.filePath ?? skillIdToFilePath(layer, id)
    const backupDir = getAgentsSkillsBackupDir(layer)

    try {
      this.backupThenDeleteFileSync(wrapperFilePath, backupDir)
      this.skills.splice(index, 1)
      this.originById.delete(id)
      return true
    } catch (error) {
      // Roll back in-memory state.
      this.skills.splice(index, 0, deletedSkill)
      if (origin) this.originById.set(id, origin)
      logApp("[SkillsService] Error deleting skill:", error)
      return false
    }
  }

  toggleSkill(id: string): AgentSkill {
    const skill = this.getSkill(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }
    return this.updateSkill(id, { enabled: !skill.enabled })
  }

  /**
   * Import a skill from SKILL.md content
   */
  importSkillFromMarkdown(content: string, filePath?: string): AgentSkill {
    const parsed = parseSkillMarkdown(content)
    if (!parsed) {
      throw new Error("Invalid SKILL.md format. Expected YAML frontmatter with 'name' field.")
    }
    return this.createSkill(parsed.name, parsed.description, parsed.instructions, {
      source: filePath ? "imported" : "local",
      filePath,
    })
  }

  /**
   * Import a skill from a SKILL.md file path
   * If a skill with the same file path already exists, it will be skipped (returns existing skill)
   */
  importSkillFromFile(filePath: string): AgentSkill {
    // Check if skill from this file path already exists (de-duplication)
    const existingSkill = this.getSkillByFilePath(filePath)
    if (existingSkill) {
      logApp(`Skill from file already exists, skipping: ${filePath}`)
      return existingSkill
    }

    try {
      const content = fs.readFileSync(filePath, "utf8")
      return this.importSkillFromMarkdown(content, filePath)
    } catch (error) {
      throw new Error(`Failed to import skill from file: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Import a skill from a folder containing SKILL.md
   * @param folderPath Path to the folder containing SKILL.md
   * @returns The imported skill, or existing skill if already imported
   */
  importSkillFromFolder(folderPath: string): AgentSkill {
    const skillFilePath = path.join(folderPath, "SKILL.md")

    if (!fs.existsSync(skillFilePath)) {
      throw new Error(`No SKILL.md found in folder: ${folderPath}`)
    }

    return this.importSkillFromFile(skillFilePath)
  }

  /**
   * Bulk import all skill folders from a parent directory
   * Looks for subdirectories containing SKILL.md files
   * @param parentFolderPath Path to the parent folder containing skill folders
   * @returns Object with imported skills and any errors encountered
   */
  importSkillsFromParentFolder(parentFolderPath: string): {
    imported: AgentSkill[]
    skipped: string[]
    errors: Array<{ folder: string; error: string }>
  } {
    const imported: AgentSkill[] = []
    const skipped: string[] = []
    const errors: Array<{ folder: string; error: string }> = []

    if (!fs.existsSync(parentFolderPath)) {
      throw new Error(`Folder does not exist: ${parentFolderPath}`)
    }

    const stat = fs.statSync(parentFolderPath)
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${parentFolderPath}`)
    }

    try {
      const entries = fs.readdirSync(parentFolderPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillFolderPath = path.join(parentFolderPath, entry.name)
        const skillFilePath = path.join(skillFolderPath, "SKILL.md")

        // Check if this folder contains a SKILL.md
        if (!fs.existsSync(skillFilePath)) {
          continue // Not a skill folder, skip silently
        }

        // Check if already imported
        const existingSkill = this.getSkillByFilePath(skillFilePath)
        if (existingSkill) {
          skipped.push(entry.name)
          logApp(`Skill already imported, skipping: ${entry.name}`)
          continue
        }

        try {
          const skill = this.importSkillFromFile(skillFilePath)
          imported.push(skill)
          logApp(`Imported skill from folder: ${entry.name}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          errors.push({ folder: entry.name, error: errorMessage })
          logApp(`Failed to import skill from ${entry.name}:`, error)
        }
      }
    } catch (error) {
      throw new Error(`Failed to read parent folder: ${error instanceof Error ? error.message : String(error)}`)
    }

    return { imported, skipped, errors }
  }

  /**
   * Export a skill to SKILL.md format
   */
  exportSkillToMarkdown(id: string): string {
    const skill = this.getSkill(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }
    return generateSkillMarkdown(skill)
  }

  /**
   * Get the combined instructions from all enabled skills
   * This is used to inject into the system prompt
   * Always includes the skills folder path so the agent can create new skills
   */
  getEnabledSkillsInstructions(): string {
    const enabledSkills = this.getEnabledSkills()

    const { globalLayer, workspaceLayer } = this.getLayers()
    const globalSkillsDir = path.join(globalLayer.agentsDir, "skills")
    const workspaceSkillsDir = workspaceLayer ? path.join(workspaceLayer.agentsDir, "skills") : null

    // Always include skills folder info so agent can create/manage skills via filesystem
    let result = `
# Agent Skills

Skills are custom instruction modules that can be enabled/disabled.

## Canonical Skills Folders
- Global: \`${globalSkillsDir}\`${workspaceSkillsDir ? `\n- Workspace: \`${workspaceSkillsDir}\` (overrides global)` : ""}

### Creating a New Skill
Create a new folder in one of the skills directories with a \`skill.md\` file.

\`\`\`bash
mkdir -p "${globalSkillsDir}/my-skill"
# Create skill.md in that folder
\`\`\`

skill.md format:
\`\`\`
---
id: my-skill-id
name: My Skill
description: What this skill does
---

Your instructions here in markdown...
\`\`\`

After creating a skill file, it will be available on the next agent session.
Use \`speakmcp-settings:execute_command\` with a skill's ID to run commands in the skill's directory.
`

    if (enabledSkills.length > 0) {
      const skillsContent = enabledSkills.map(skill => {
        // Include skill ID and source info for execute_command tool
        const skillIdInfo = `**Skill ID:** \`${skill.id}\``
        const sourceInfo = skill.filePath
          ? (skill.filePath.startsWith("github:")
              ? `**Source:** GitHub (${skill.filePath})`
              : `**Source:** Local`)
          : ""

        return `## Skill: ${skill.name}
${skillIdInfo}${sourceInfo ? `\n${sourceInfo}` : ""}
${skill.description ? `*${skill.description}*\n` : ""}
${skill.instructions}`
      }).join("\n\n---\n\n")

      result += `
## Active Skills

The following skills are currently enabled:

${skillsContent}
`
    }

    return result
  }

  /**
   * Get the combined instructions for skills enabled for a specific profile
   * @param enabledSkillIds Array of skill IDs that are enabled for the profile
   */
  getEnabledSkillsInstructionsForProfile(enabledSkillIds: string[]): string {
    if (enabledSkillIds.length === 0) {
      return ""
    }

    const allSkills = this.getSkills()
    // Filter by both: skill must be in the profile's enabled list AND globally enabled (skill.enabled)
    // The skill.enabled flag acts as a master kill-switch
    const enabledSkills = allSkills.filter(skill => 
      enabledSkillIds.includes(skill.id) && skill.enabled !== false
    )

    if (enabledSkills.length === 0) {
      return ""
    }

    // Progressive disclosure: Only show name + description initially
    // The LLM must call load_skill_instructions to get the full instructions
    const skillsContent = enabledSkills.map(skill => {
      return `- **${skill.name}** (ID: \`${skill.id}\`): ${skill.description || 'No description'}`
    }).join("\n")

    const { globalLayer, workspaceLayer } = this.getLayers()
    const globalSkillsDir = path.join(globalLayer.agentsDir, "skills")
    const workspaceSkillsDir = workspaceLayer ? path.join(workspaceLayer.agentsDir, "skills") : null


    return `
# Available Agent Skills

To use a skill:
1) Call \`speakmcp-settings:load_skill_instructions\` with its ID
2) Follow the loaded instructions exactly (do not guess from name/description)

${skillsContent}

## Skills Folders
- Active layer: \`${workspaceSkillsDir ?? globalSkillsDir}\`${workspaceSkillsDir ? `\n- Global fallback: \`${globalSkillsDir}\`` : ""}

Tip: Use \`speakmcp-settings:execute_command\` with \`skillId\` to run commands in that skill's directory.
`
  }

  /**
   * Import a skill from a GitHub repository by cloning it locally
   * @param repoIdentifier GitHub repo identifier (e.g., "owner/repo" or full URL)
   * @returns Object with imported skills and any errors encountered
   */
  async importSkillFromGitHub(repoIdentifier: string): Promise<{
    imported: AgentSkill[]
    errors: string[]
  }> {
    const imported: AgentSkill[] = []
    const errors: string[] = []

    // Parse the GitHub identifier
    let parsed: { owner: string; repo: string; path?: string; ref: string; refAndPath?: string[] }
    try {
      parsed = parseGitHubIdentifier(repoIdentifier)
    } catch (error) {
      return {
        imported: [],
        errors: [error instanceof Error ? error.message : String(error)],
      }
    }

    let { owner, repo, path: subPath, ref, refAndPath } = parsed

    // Validate owner and repo early before any API calls
    if (!validateGitHubIdentifierPart(owner, "owner")) {
      return {
        imported: [],
        errors: [`Invalid GitHub owner: "${owner}". Owner names can only contain alphanumeric characters, hyphens, underscores, and dots.`],
      }
    }

    if (!validateGitHubIdentifierPart(repo, "repo")) {
      return {
        imported: [],
        errors: [`Invalid GitHub repo: "${repo}". Repository names can only contain alphanumeric characters, hyphens, underscores, and dots.`],
      }
    }

    // If we have refAndPath (from a /tree/ or /blob/ URL), resolve the branch name
    // This handles branch names with slashes like "feature/foo"
    if (refAndPath && refAndPath.length > 0) {
      const resolved = await resolveRefAndPath(owner, repo, refAndPath)
      if (resolved) {
        ref = resolved.ref
        subPath = resolved.path
      }
    }

    // Validate subPath to prevent path traversal attacks
    // Values like "../.." could escape the clone directory and access arbitrary local paths
    if (subPath && !validateSubPath(subPath)) {
      return {
        imported: [],
        errors: [`Invalid path: "${subPath}". Path cannot contain ".." or be absolute.`],
      }
    }

    // If ref is "main" (default), try to detect the actual default branch
    // This handles repos that use 'master' or other branch names
    if (ref === "main") {
      const detectedRef = await fetchGitHubDefaultBranch(owner, repo)
      if (detectedRef !== "main") {
        logApp(`Using detected default branch '${detectedRef}' instead of 'main'`)
        ref = detectedRef
      }
    }

    logApp(`Importing skill from GitHub: ${owner}/${repo}${subPath ? `/${subPath}` : ""} (ref: ${ref})`)

    // Validate the ref to prevent command injection
    // Note: owner and repo are already validated above before the API call
    if (!validateGitRef(ref)) {
      return {
        imported: [],
        errors: [`Invalid git ref: "${ref}". Ref names can only contain alphanumeric characters, dots, hyphens, underscores, and slashes.`],
      }
    }

    // Determine the local clone directory
    // Use format: skillsFolder/owner--repo (e.g., skills/SawyerHood--dev-browser)
    const cloneDir = path.join(skillsFolder, `${owner}--${repo}`)
    const repoUrl = `https://github.com/${owner}/${repo}.git`

    // Clone or update the repository
    try {
      if (fs.existsSync(cloneDir)) {
        // Repository already exists, pull latest changes
        logApp(`Updating existing clone at ${cloneDir}`)
        try {
          await execAsync(`git fetch origin && git checkout ${ref} && git pull origin ${ref}`, { cwd: cloneDir })
        } catch (pullError) {
          // If pull fails (e.g., detached HEAD), try harder reset
          logApp(`Pull failed, attempting reset: ${pullError}`)
          await execAsync(`git fetch origin && git checkout ${ref} && git reset --hard origin/${ref}`, { cwd: cloneDir })
        }
      } else {
        // Clone the repository
        logApp(`Cloning ${repoUrl} to ${cloneDir}`)
        fs.mkdirSync(skillsFolder, { recursive: true })
        await execAsync(`git clone --branch ${ref} --single-branch "${repoUrl}" "${cloneDir}"`)
      }
    } catch (gitError) {
      const errorMsg = gitError instanceof Error ? gitError.message : String(gitError)
      errors.push(`Failed to clone repository: ${errorMsg}`)
      return { imported, errors }
    }

    // Now find SKILL.md files in the cloned repo
    const searchBase = subPath ? path.join(cloneDir, subPath) : cloneDir

    // Helper to import a skill from a local file
    const importLocalSkill = (skillMdPath: string): boolean => {
      try {
        // Check if already imported by this path
        if (this.getSkillByFilePath(skillMdPath)) {
          logApp(`Skill already imported, skipping: ${skillMdPath}`)
          return false
        }

        const content = fs.readFileSync(skillMdPath, "utf-8")
        const skill = this.importSkillFromMarkdown(content, skillMdPath)
        imported.push(skill)
        logApp(`Imported skill from local clone: ${skillMdPath}`)
        return true
      } catch (error) {
        errors.push(`Failed to parse ${skillMdPath}: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    }

    // If a specific subPath was given, look for SKILL.md there first
    if (subPath && fs.existsSync(searchBase)) {
      const directPaths = [
        path.join(searchBase, "SKILL.md"),
        path.join(searchBase, "skill.md"),
      ]
      for (const p of directPaths) {
        if (fs.existsSync(p)) {
          importLocalSkill(p)
          if (imported.length > 0) return { imported, errors }
        }
      }
    }

    // Try common SKILL.md locations in the clone
    for (const pathTemplate of SKILL_MD_PATHS) {
      const checkPath = path.join(searchBase, pathTemplate.replace("{name}", repo))
      if (fs.existsSync(checkPath)) {
        importLocalSkill(checkPath)
        if (imported.length > 0) return { imported, errors }
      }
    }

    // Look in skills subdirectories
    const skillsDirs = ["skills", ".claude/skills", ".codex/skills"]
    for (const skillsDir of skillsDirs) {
      const skillsDirPath = path.join(searchBase, skillsDir)
      if (fs.existsSync(skillsDirPath) && fs.statSync(skillsDirPath).isDirectory()) {
        const entries = fs.readdirSync(skillsDirPath)
        for (const entry of entries) {
          const entryPath = path.join(skillsDirPath, entry)
          if (fs.statSync(entryPath).isDirectory()) {
            const skillMdPath = path.join(entryPath, "SKILL.md")
            if (fs.existsSync(skillMdPath)) {
              importLocalSkill(skillMdPath)
            }
          }
        }
        if (imported.length > 0) return { imported, errors }
      }
    }

    // Last resort: search for any SKILL.md in the clone
    const findSkillMdFiles = (dir: string, depth = 0): string[] => {
      if (depth > 3) return [] // Limit search depth
      const results: string[] = []
      try {
        const entries = fs.readdirSync(dir)
        for (const entry of entries) {
          if (entry.startsWith(".") || entry === "node_modules") continue
          const fullPath = path.join(dir, entry)
          const stat = fs.statSync(fullPath)
          if (stat.isFile() && (entry === "SKILL.md" || entry === "skill.md")) {
            results.push(fullPath)
          } else if (stat.isDirectory()) {
            results.push(...findSkillMdFiles(fullPath, depth + 1))
          }
        }
      } catch {
        // Ignore permission errors
      }
      return results
    }

    const allSkillFiles = findSkillMdFiles(searchBase)
    for (const skillFile of allSkillFiles) {
      importLocalSkill(skillFile)
    }

    if (imported.length === 0 && errors.length === 0) {
      errors.push(`No SKILL.md found in repository ${owner}/${repo}`)
    }

    return { imported, errors }
  }

  /**
   * Upgrade a GitHub-hosted skill to a local clone.
   * This clones the repository and updates the skill's filePath to point to the local SKILL.md.
   * @param skillId The ID of the skill to upgrade
   * @returns The upgraded skill, or throws if upgrade fails
   */
  async upgradeGitHubSkillToLocal(skillId: string): Promise<AgentSkill> {
    const skill = this.getSkill(skillId)
    if (!skill) {
      throw new Error(`Skill with id ${skillId} not found`)
    }

    if (!skill.filePath?.startsWith("github:")) {
      throw new Error(`Skill ${skill.name} is not a GitHub-hosted skill`)
    }

    // Parse the github: path format: github:owner/repo/path/to/SKILL.md
    const githubPath = skill.filePath.replace("github:", "")
    const parts = githubPath.split("/")
    if (parts.length < 2) {
      throw new Error(`Invalid GitHub path format: ${skill.filePath}`)
    }

    const owner = parts[0]
    const repo = parts[1]
    const subPath = parts.slice(2, -1).join("/") // Everything except owner, repo, and SKILL.md filename

    // Validate owner and repo to prevent command injection
    // These values are interpolated into shell commands via execAsync
    if (!validateGitHubIdentifierPart(owner, "owner")) {
      throw new Error(`Invalid GitHub owner: "${owner}". Owner names can only contain alphanumeric characters, hyphens, underscores, and dots.`)
    }

    if (!validateGitHubIdentifierPart(repo, "repo")) {
      throw new Error(`Invalid GitHub repo: "${repo}". Repository names can only contain alphanumeric characters, hyphens, underscores, and dots.`)
    }

    // Validate subPath to prevent path traversal attacks
    if (subPath && !validateSubPath(subPath)) {
      throw new Error(`Invalid path: "${subPath}". Path cannot contain ".." or be absolute.`)
    }

    // Clone the repository
    const cloneDir = path.join(skillsFolder, `${owner}--${repo}`)
    const repoUrl = `https://github.com/${owner}/${repo}.git`

    try {
      if (fs.existsSync(cloneDir)) {
        // Repository already exists, pull latest
        logApp(`Updating existing clone at ${cloneDir}`)
        await execAsync(`git pull`, { cwd: cloneDir })
      } else {
        // Clone the repository
        logApp(`Cloning ${repoUrl} to ${cloneDir}`)
        fs.mkdirSync(skillsFolder, { recursive: true })
        await execAsync(`git clone "${repoUrl}" "${cloneDir}"`)
      }
    } catch (gitError) {
      throw new Error(`Failed to clone repository: ${gitError instanceof Error ? gitError.message : String(gitError)}`)
    }

    // Find the SKILL.md in the local clone
    const localSkillPath = path.join(cloneDir, subPath, "SKILL.md")
    if (!fs.existsSync(localSkillPath)) {
      throw new Error(`SKILL.md not found at expected path: ${localSkillPath}`)
    }

    // Update the skill's filePath to the local path
    const updatedSkill = this.updateSkillFilePath(skillId, localSkillPath)
    logApp(`Upgraded skill ${skill.name} to local clone: ${localSkillPath}`)

    return updatedSkill
  }

  /**
   * Update a skill's file path (internal method for upgrading GitHub skills)
   */
  private updateSkillFilePath(id: string, newFilePath: string): AgentSkill {
    this.ensureInitialized()

    const index = this.skills.findIndex((s) => s.id === id)
    if (index < 0) {
      throw new Error(`Skill with id ${id} not found`)
    }

    const previousSkill = this.skills[index]
    const previousOrigin = this.originById.get(id)

    const updatedSkill: AgentSkill = {
      ...previousSkill,
      filePath: newFilePath,
      updatedAt: Date.now(),
    }

    const { globalLayer, workspaceLayer } = this.getLayers()
    const targetLayerName = previousOrigin?.layer === "workspace" && workspaceLayer ? "workspace" : "global"
    const targetLayer = targetLayerName === "workspace" && workspaceLayer ? workspaceLayer : globalLayer
    const originFilePath = previousOrigin?.filePath ?? skillIdToFilePath(targetLayer, id)

    writeAgentsSkillFile(targetLayer, updatedSkill, { filePathOverride: originFilePath })

    this.skills[index] = updatedSkill
    this.skills = this.sortSkillsStable(this.skills)
    this.originById.set(id, { layer: targetLayerName, filePath: originFilePath })
    return updatedSkill
  }

  /**
   * Scan the skills folder for SKILL.md files and import any new ones.
   * Uses file path de-duplication to prevent re-importing the same files on repeated scans.
   * Recursively scans nested directories to find skills at any depth.
   */
  scanSkillsFolder(): AgentSkill[] {
    this.ensureInitialized()

    // Reload from .agents first to pick up any manual edits.
    this.loadFromDisk({ migrateLegacy: false })

    const importedSkills: AgentSkill[] = []

    try {
      if (!fs.existsSync(skillsFolder)) {
        fs.mkdirSync(skillsFolder, { recursive: true })
        return importedSkills
      }

      // Recursively scan legacy skills folder for SKILL.md files and import any new ones.
      const scanDirectory = (dirPath: string) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true })

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const entryPath = path.join(dirPath, entry.name)
            const skillPath = path.join(entryPath, "SKILL.md")

            if (fs.existsSync(skillPath)) {
              if (this.getSkillByFilePath(skillPath)) {
                continue
              }
              try {
                const skill = this.importSkillFromFile(skillPath)
                importedSkills.push(skill)
              } catch (error) {
                logApp(`Failed to import skill from ${skillPath}:`, error)
              }
            } else {
              scanDirectory(entryPath)
            }
          } else if (entry.name.endsWith(".md") && dirPath === skillsFolder) {
            const skillPath = path.join(dirPath, entry.name)
            if (this.getSkillByFilePath(skillPath)) {
              continue
            }
            try {
              const skill = this.importSkillFromFile(skillPath)
              importedSkills.push(skill)
            } catch (error) {
              logApp(`Failed to import skill from ${skillPath}:`, error)
            }
          }
        }
      }

      scanDirectory(skillsFolder)
    } catch (error) {
      logApp("Error scanning skills folder:", error)
    }

    // Reload again to ensure merged state reflects any newly written .agents skill files.
    if (importedSkills.length > 0) {
      this.loadFromDisk({ migrateLegacy: false })
    }

    return importedSkills
  }
}

export const skillsService = new SkillsService()

/**
 * Notify all renderer windows that the skills folder has changed.
 * This allows the UI to refresh skills without requiring an app restart.
 */
function notifySkillsFolderChanged(): void {
  const windows = [WINDOWS.get("main"), WINDOWS.get("panel")]
  for (const win of windows) {
    if (win) {
      try {
        const handlers = getRendererHandlers<RendererHandlers>(win.webContents)
        handlers.skillsFolderChanged?.send()
      } catch (e) {
        // Window may not be ready yet, ignore
      }
    }
  }
}

// File watcher state
// On Linux, we need multiple watchers since recursive watching is not supported
let skillsWatchers: fs.FSWatcher[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 500 // Wait 500ms after last change before notifying

/**
 * Handle a file system change event from any watcher.
 */
function handleWatcherEvent(eventType: string, filename: string | null): void {
  // On some platforms, fs.watch can emit events where filename is null.
  // Treat this as an "unknown change" and still trigger the refresh.
  const isUnknownChange = !filename
  const isSkillFile = filename?.endsWith("SKILL.md") || filename?.endsWith("skill.md") || filename?.endsWith(".md")
  const isDirectory = filename ? !filename.includes(".") : false

  if (isUnknownChange || isSkillFile || isDirectory) {
    logApp(`Skills folder changed: ${eventType} ${filename ?? "(unknown)"}`)

    // Debounce to avoid multiple rapid notifications
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null
      // On Linux, refresh subdirectory watchers when structure changes
      if (process.platform === "linux" && (isDirectory || isUnknownChange)) {
        refreshLinuxSubdirectoryWatchers()
      }
      notifySkillsFolderChanged()
    }, DEBOUNCE_MS)
  }
}

/**
 * Set up a watcher for a directory and add it to the watchers array.
 */
function setupWatcher(dirPath: string): fs.FSWatcher | null {
  try {
    const watcher = fs.watch(dirPath, (eventType, filename) => {
      handleWatcherEvent(eventType, filename)
    })

    watcher.on("error", (error) => {
      logApp(`Skills folder watcher error for ${dirPath}:`, error)
      // Don't stop all watchers on a single error, just log it
    })

    return watcher
  } catch (error) {
    logApp(`Failed to set up watcher for ${dirPath}:`, error)
    return null
  }
}

/**
 * Returns the canonical .agents/skills directories to watch (global + workspace if present).
 */
function getCanonicalSkillsDirs(): string[] {
  const globalLayer = getAgentsLayerPaths(globalAgentsFolder)
  const globalSkillsDir = getAgentsSkillsDir(globalLayer)
  const dirs = [globalSkillsDir]

  const workspaceAgentsFolder = resolveWorkspaceAgentsFolder()
  if (workspaceAgentsFolder) {
    const workspaceLayer = getAgentsLayerPaths(workspaceAgentsFolder)
    const workspaceSkillsDir = getAgentsSkillsDir(workspaceLayer)
    dirs.push(workspaceSkillsDir)
  }

  return dirs
}

/**
 * Refresh subdirectory watchers on Linux.
 * Called when directory structure changes to pick up new skill folders.
 */
function refreshLinuxSubdirectoryWatchers(): void {
  if (process.platform !== "linux") return

  // Stop all existing watchers and rebuild from scratch.
  stopSkillsFolderWatcher()

  const dirs = getCanonicalSkillsDirs()
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    const rootWatcher = setupWatcher(dir)
    if (rootWatcher) skillsWatchers.push(rootWatcher)

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDirPath = path.join(dir, entry.name)
          const watcher = setupWatcher(subDirPath)
          if (watcher) skillsWatchers.push(watcher)
        }
      }
    } catch {
      // best-effort
    }
  }
  logApp(`Linux: Refreshed watchers, now watching ${skillsWatchers.length} directories`)
}

/**
 * Start watching the canonical .agents/skills directories for changes.
 * Watches both global and workspace skill dirs (if workspace is set).
 * Automatically notifies the renderer when new skills are added or modified.
 *
 * Note: On Linux, fs.watch({ recursive: true }) is not supported, so we set up
 * individual watchers for each root folder and its subdirectories.
 */
export function startSkillsFolderWatcher(): void {
  // Don't start duplicate watchers
  if (skillsWatchers.length > 0) {
    logApp("Skills folder watcher already running")
    return
  }

  const dirs = getCanonicalSkillsDirs()

  for (const dir of dirs) {
    // Ensure folder exists
    fs.mkdirSync(dir, { recursive: true })

    try {
      const isLinux = process.platform === "linux"

      if (isLinux) {
        const rootWatcher = setupWatcher(dir)
        if (rootWatcher) skillsWatchers.push(rootWatcher)

        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subDirPath = path.join(dir, entry.name)
            const watcher = setupWatcher(subDirPath)
            if (watcher) skillsWatchers.push(watcher)
          }
        }
      } else {
        // macOS and Windows: Use recursive watching
        const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          handleWatcherEvent(eventType, filename)
        })

        watcher.on("error", (error) => {
          logApp(`Skills folder watcher error for ${dir}:`, error)
        })

        skillsWatchers.push(watcher)
      }

      logApp(`Started watching skills folder: ${dir}`)
    } catch (error) {
      logApp(`Failed to start skills folder watcher for ${dir}:`, error)
    }
  }
}

/**
 * Stop watching the skills folder.
 */
export function stopSkillsFolderWatcher(): void {
  for (const watcher of skillsWatchers) {
    try {
      watcher.close()
    } catch {
      // Ignore close errors
    }
  }
  if (skillsWatchers.length > 0) {
    logApp(`Stopped ${skillsWatchers.length} skills folder watcher(s)`)
    skillsWatchers = []
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}
