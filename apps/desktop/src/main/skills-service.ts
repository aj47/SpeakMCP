import { app } from "electron"
import path from "path"
import fs from "fs"
import { AgentSkill, AgentSkillsData } from "@shared/types"
import { randomUUID } from "crypto"
import { logApp } from "./debug"
import { exec } from "child_process"
import { promisify } from "util"

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

function parseGitHubIdentifier(input: string): { owner: string; repo: string; path?: string; ref: string } {
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

    // Handle /tree/branch/path or /blob/branch/path URLs
    if (parts.length > 2 && (parts[2] === "tree" || parts[2] === "blob")) {
      if (parts.length > 3) {
        ref = parts[3]
        if (parts.length > 4) {
          subPath = parts.slice(4).join("/")
        }
      }
    } else if (parts.length > 2) {
      // Simple path without /tree/ or /blob/
      subPath = parts.slice(2).join("/")
    }

    return { owner, repo, path: subPath, ref }
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

// Skills folder for SKILL.md files (optional - for users who want to manage skills as files)
export const skillsFolder = path.join(
  app.getPath("appData"),
  process.env.APP_ID,
  "skills"
)

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
  private skillsData: AgentSkillsData | undefined

  constructor() {
    this.loadSkills()
  }

  private loadSkills(): AgentSkillsData {
    try {
      if (fs.existsSync(skillsPath)) {
        const data = JSON.parse(fs.readFileSync(skillsPath, "utf8")) as AgentSkillsData
        this.skillsData = data
        return data
      }
    } catch (error) {
      logApp("Error loading skills:", error)
    }

    // Initialize with empty skills array
    this.skillsData = { skills: [] }
    this.saveSkills()
    return this.skillsData
  }

  private saveSkills(): void {
    if (!this.skillsData) return

    try {
      const dataFolder = path.dirname(skillsPath)
      fs.mkdirSync(dataFolder, { recursive: true })
      fs.writeFileSync(skillsPath, JSON.stringify(this.skillsData, null, 2))
    } catch (error) {
      logApp("Error saving skills:", error)
      throw new Error(`Failed to save skills: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getSkills(): AgentSkill[] {
    if (!this.skillsData) {
      this.loadSkills()
    }
    return this.skillsData?.skills || []
  }

  getEnabledSkills(): AgentSkill[] {
    return this.getSkills().filter(skill => skill.enabled)
  }

  getSkill(id: string): AgentSkill | undefined {
    return this.getSkills().find(s => s.id === id)
  }

  getSkillByFilePath(filePath: string): AgentSkill | undefined {
    return this.getSkills().find(s => s.filePath === filePath)
  }

  createSkill(
    name: string,
    description: string,
    instructions: string,
    options?: { source?: "local" | "imported"; filePath?: string }
  ): AgentSkill {
    if (!this.skillsData) {
      this.loadSkills()
    }

    const newSkill: AgentSkill = {
      id: randomUUID(),
      name,
      description,
      instructions,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: options?.source ?? "local",
      filePath: options?.filePath,
    }

    this.skillsData!.skills.push(newSkill)
    this.saveSkills()
    return newSkill
  }

  updateSkill(id: string, updates: Partial<Pick<AgentSkill, "name" | "description" | "instructions" | "enabled">>): AgentSkill {
    if (!this.skillsData) {
      this.loadSkills()
    }

    const skill = this.getSkill(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }

    const updatedSkill = {
      ...skill,
      ...updates,
      updatedAt: Date.now(),
    }

    const index = this.skillsData!.skills.findIndex(s => s.id === id)
    this.skillsData!.skills[index] = updatedSkill
    this.saveSkills()
    return updatedSkill
  }

  deleteSkill(id: string): boolean {
    if (!this.skillsData) {
      this.loadSkills()
    }

    const skill = this.getSkill(id)
    if (!skill) {
      return false
    }

    this.skillsData!.skills = this.skillsData!.skills.filter(s => s.id !== id)
    this.saveSkills()
    return true
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

    // Always include skills folder info so agent can create/manage skills via filesystem
    let result = `
# Agent Skills

**Skills Folder**: ${skillsFolder}

You can create new skills by writing .md files to the skills folder. Use this format:
\`\`\`
---
name: skill-name
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

    return `
# Active Agent Skills

The following skills provide specialized instructions for specific tasks.
Use \`speakmcp-settings:execute_command\` with the skill's ID to run commands in the skill's directory.

${skillsContent}
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
    let parsed: { owner: string; repo: string; path?: string; ref: string }
    try {
      parsed = parseGitHubIdentifier(repoIdentifier)
    } catch (error) {
      return {
        imported: [],
        errors: [error instanceof Error ? error.message : String(error)],
      }
    }

    let { owner, repo, path: subPath, ref } = parsed

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
    if (!this.skillsData) {
      this.loadSkills()
    }

    const skill = this.getSkill(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }

    const updatedSkill = {
      ...skill,
      filePath: newFilePath,
      updatedAt: Date.now(),
    }

    const index = this.skillsData!.skills.findIndex(s => s.id === id)
    this.skillsData!.skills[index] = updatedSkill
    this.saveSkills()
    return updatedSkill
  }

  /**
   * Scan the skills folder for SKILL.md files and import any new ones.
   * Uses file path de-duplication to prevent re-importing the same files on repeated scans.
   */
  scanSkillsFolder(): AgentSkill[] {
    const importedSkills: AgentSkill[] = []

    try {
      if (!fs.existsSync(skillsFolder)) {
        fs.mkdirSync(skillsFolder, { recursive: true })
        return importedSkills
      }

      const entries = fs.readdirSync(skillsFolder, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Look for SKILL.md in subdirectory
          const skillPath = path.join(skillsFolder, entry.name, "SKILL.md")
          if (fs.existsSync(skillPath)) {
            // Check if already imported (de-duplication by file path)
            if (this.getSkillByFilePath(skillPath)) {
              logApp(`Skill already imported, skipping: ${entry.name}`)
              continue
            }
            try {
              const skill = this.importSkillFromFile(skillPath)
              importedSkills.push(skill)
              logApp(`Imported skill from folder: ${entry.name}`)
            } catch (error) {
              logApp(`Failed to import skill from ${skillPath}:`, error)
            }
          }
        } else if (entry.name.endsWith(".md")) {
          // Import standalone .md files
          const skillPath = path.join(skillsFolder, entry.name)
          // Check if already imported (de-duplication by file path)
          if (this.getSkillByFilePath(skillPath)) {
            logApp(`Skill already imported, skipping: ${entry.name}`)
            continue
          }
          try {
            const skill = this.importSkillFromFile(skillPath)
            importedSkills.push(skill)
            logApp(`Imported skill from file: ${entry.name}`)
          } catch (error) {
            logApp(`Failed to import skill from ${skillPath}:`, error)
          }
        }
      }
    } catch (error) {
      logApp("Error scanning skills folder:", error)
    }

    return importedSkills
  }
}

export const skillsService = new SkillsService()

