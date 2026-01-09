import fs from "fs"
import path from "path"
import {
  Skill,
  SkillFrontmatter,
  SkillSummary,
  FILE_DISCOVERY_FOLDERS,
  FILE_DISCOVERY_FILES,
} from "@shared/file-discovery-types"
import { dataFolder } from "./config"
import { logApp } from "./debug"

/**
 * Service for managing Agent Skills following the open standard (like Cursor's Agent Skills).
 * Skills are stored as folders: {skillsFolder}/{skill-id}/SKILL.md
 */
class SkillsService {
  private discoveryFolder: string
  private skillsFolder: string
  private loadedSkills: Map<string, Skill>

  constructor() {
    this.discoveryFolder = path.join(dataFolder, FILE_DISCOVERY_FOLDERS.ROOT)
    // Skills are stored directly in {dataFolder}/skills/ (not under .speakmcp)
    // This matches the convention used by existing skills and other tools
    this.skillsFolder = path.join(dataFolder, FILE_DISCOVERY_FOLDERS.SKILLS)
    this.loadedSkills = new Map()
  }

  ensureFolders(): void {
    try {
      if (!fs.existsSync(this.discoveryFolder)) {
        fs.mkdirSync(this.discoveryFolder, { recursive: true })
        logApp("[SkillsService] Created discovery folder:", this.discoveryFolder)
      }
      if (!fs.existsSync(this.skillsFolder)) {
        fs.mkdirSync(this.skillsFolder, { recursive: true })
        logApp("[SkillsService] Created skills folder:", this.skillsFolder)
      }
    } catch (error) {
      logApp("[SkillsService] Error creating folders:", error)
    }
  }

  loadAllSkills(): Skill[] {
    this.ensureFolders()
    this.loadedSkills.clear()

    try {
      const entries = fs.readdirSync(this.skillsFolder, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skill = this.loadSkillFromFolder(entry.name)
          if (skill) {
            this.loadedSkills.set(skill.id, skill)
          }
        }
      }
      logApp(`[SkillsService] Loaded ${this.loadedSkills.size} skills`)
    } catch (error) {
      logApp("[SkillsService] Error loading skills:", error)
    }

    return Array.from(this.loadedSkills.values())
  }

  private loadSkillFromFolder(skillId: string): Skill | null {
    const skillPath = path.join(this.skillsFolder, skillId, FILE_DISCOVERY_FILES.SKILL_FILE)
    return this.parseSkillFile(skillPath, skillId)
  }

  getSkill(skillId: string): Skill | null {
    if (this.loadedSkills.has(skillId)) {
      return this.loadedSkills.get(skillId) || null
    }
    const skill = this.loadSkillFromFolder(skillId)
    if (skill) {
      this.loadedSkills.set(skillId, skill)
    }
    return skill
  }

  getSkillSummaries(): SkillSummary[] {
    if (this.loadedSkills.size === 0) {
      this.loadAllSkills()
    }
    return Array.from(this.loadedSkills.values()).map((skill) => ({
      id: skill.id,
      name: skill.frontmatter.name,
      description: skill.frontmatter.description,
    }))
  }

  parseSkillFile(skillPath: string, skillId?: string): Skill | null {
    try {
      if (!fs.existsSync(skillPath)) {
        return null
      }

      const content = fs.readFileSync(skillPath, "utf-8")
      const id = skillId || path.basename(path.dirname(skillPath))

      // Parse frontmatter
      const frontmatter = this.parseFrontmatter(content)
      if (!frontmatter) {
        logApp(`[SkillsService] Invalid frontmatter in ${skillPath}`)
        return null
      }

      // Extract sections
      const whenToUse = this.extractSection(content, "When to Use")
      const instructions = this.extractSection(content, "Instructions")

      // Find scripts in skill folder
      const skillFolder = path.dirname(skillPath)
      const scripts = this.findScripts(skillFolder)

      return {
        id,
        frontmatter,
        content,
        instructions,
        whenToUse,
        scripts,
      }
    } catch (error) {
      logApp(`[SkillsService] Error parsing skill file ${skillPath}:`, error)
      return null
    }
  }

  private parseFrontmatter(content: string): SkillFrontmatter | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return null

    const frontmatterText = match[1]
    const result: Partial<SkillFrontmatter> = {}
    const lines = frontmatterText.split(/\r?\n/)
    let currentKey: string | null = null
    let inArray = false
    let arrayValues: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Check if this is an array item
      if (inArray && trimmed.startsWith("- ")) {
        arrayValues.push(trimmed.slice(2).trim())
        continue
      }

      // Save previous array if we were in one
      if (inArray && currentKey) {
        (result as Record<string, unknown>)[currentKey] = arrayValues
        inArray = false
        arrayValues = []
      }

      // Parse key: value
      const colonIndex = line.indexOf(":")
      if (colonIndex === -1) continue

      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()

      if (!value) {
        // Could be start of array
        currentKey = key
        inArray = true
        arrayValues = []
      } else {
        (result as Record<string, unknown>)[key] = value
        currentKey = key
      }
    }

    // Save final array if we were in one
    if (inArray && currentKey) {
      (result as Record<string, unknown>)[currentKey] = arrayValues
    }

    if (!result.name || !result.description) {
      return null
    }

    return result as SkillFrontmatter
  }

  private extractSection(content: string, sectionName: string): string[] {
    const regex = new RegExp(`##\\s*${sectionName}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##|$)`, "i")
    const match = content.match(regex)
    if (!match) return []

    const sectionContent = match[1]
    const items: string[] = []
    const lines = sectionContent.split(/\r?\n/)

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("- ")) {
        items.push(trimmed.slice(2).trim())
      }
    }

    return items
  }

  private findScripts(folderPath: string): string[] {
    try {
      const entries = fs.readdirSync(folderPath)
      const scriptExtensions = [".sh", ".py", ".js", ".ts", ".bash", ".zsh"]
      return entries.filter((entry) => {
        const ext = path.extname(entry).toLowerCase()
        return scriptExtensions.includes(ext)
      })
    } catch {
      return []
    }
  }

  createSkillTemplate(skillId: string, name: string, description: string): boolean {
    try {
      this.ensureFolders()

      const skillFolder = path.join(this.skillsFolder, skillId)
      if (fs.existsSync(skillFolder)) {
        logApp(`[SkillsService] Skill folder already exists: ${skillId}`)
        return false
      }

      fs.mkdirSync(skillFolder, { recursive: true })

      const template = `---
name: ${name}
version: 1.0.0
description: ${description}
author:
tags:
  - custom
---

# ${name}

${description}

## When to Use
- Condition 1
- Condition 2

## Instructions
- Step 1
- Step 2
- Step 3

## Scripts
Scripts in this folder that can be executed.
`

      const skillPath = path.join(skillFolder, FILE_DISCOVERY_FILES.SKILL_FILE)
      fs.writeFileSync(skillPath, template, "utf-8")
      logApp(`[SkillsService] Created skill template: ${skillId}`)

      return true
    } catch (error) {
      logApp("[SkillsService] Error creating skill template:", error)
      return false
    }
  }

  hasSkills(): boolean {
    this.ensureFolders()
    try {
      const entries = fs.readdirSync(this.skillsFolder, { withFileTypes: true })
      return entries.some((entry) => entry.isDirectory())
    } catch {
      return false
    }
  }

  getSkillsFolderPath(): string {
    return this.skillsFolder
  }

  reloadSkills(): void {
    logApp("[SkillsService] Reloading skills...")
    this.loadAllSkills()
  }
}

export const skillsService = new SkillsService()
