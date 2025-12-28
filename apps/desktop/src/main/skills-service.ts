import { app } from "electron"
import path from "path"
import fs from "fs"
import { AgentSkill, AgentSkillsData } from "@shared/types"
import { randomUUID } from "crypto"
import { logApp } from "./debug"

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
   */
  getEnabledSkillsInstructions(): string {
    const enabledSkills = this.getEnabledSkills()
    if (enabledSkills.length === 0) {
      return ""
    }

    const skillsContent = enabledSkills.map(skill => {
      return `## Skill: ${skill.name}
${skill.description ? `*${skill.description}*\n` : ""}
${skill.instructions}`
    }).join("\n\n---\n\n")

    return `
# Active Agent Skills

The following skills provide specialized instructions for specific tasks:

${skillsContent}
`
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
    const enabledSkills = allSkills.filter(skill => enabledSkillIds.includes(skill.id))

    if (enabledSkills.length === 0) {
      return ""
    }

    const skillsContent = enabledSkills.map(skill => {
      return `## Skill: ${skill.name}
${skill.description ? `*${skill.description}*\n` : ""}
${skill.instructions}`
    }).join("\n\n---\n\n")

    return `
# Active Agent Skills

The following skills provide specialized instructions for specific tasks:

${skillsContent}
`
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

