/**
 * Skills Service for agent skills management.
 * Provides CRUD and import/export helpers used by parity APIs.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getDataDir, ensureDir } from '../config/index'
import type { AgentSkill, AgentSkillsData } from '../types/index'

function getSkillsFilePath(): string {
  return path.join(getDataDir(), 'skills.json')
}

function getManagedSkillsFolder(): string {
  return path.join(getDataDir(), 'skills')
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

function parseSkillMarkdown(content: string): { name: string; description: string; instructions: string } {
  const normalized = normalizeLineEndings(content).trim()
  const lines = normalized.split('\n')

  let name = 'Imported Skill'
  let description = 'Imported from markdown'

  // Name: first markdown H1 if present.
  const h1 = lines.find((line) => line.trim().startsWith('# '))
  if (h1) {
    name = h1.trim().slice(2).trim() || name
  }

  // Description: first non-heading paragraph.
  const paragraph = lines.find((line) => {
    const trimmed = line.trim()
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('>') &&
      !trimmed.startsWith('```')
    )
  })
  if (paragraph) {
    description = paragraph.trim().slice(0, 200)
  }

  return {
    name,
    description,
    instructions: normalized,
  }
}

function sanitizeNameForPath(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64) || 'skill'
}

function normalizeGitHubRepoIdentifier(input: string): {
  owner: string
  repo: string
  pathParts: string[]
} {
  const trimmed = input.trim()
  const withoutProtocol = trimmed
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\/+$/, '')

  const parts = withoutProtocol.split('/').filter(Boolean)
  if (parts.length < 2) {
    throw new Error('Expected owner/repo or GitHub URL')
  }

  return {
    owner: parts[0],
    repo: parts[1],
    pathParts: parts.slice(2),
  }
}

class SkillsService {
  private skillsData: AgentSkillsData | undefined
  private initialized = false

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.loadSkills()
      this.initialized = true
    }
  }

  private loadSkills(): AgentSkillsData {
    try {
      const filePath = getSkillsFilePath()
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AgentSkillsData
        this.skillsData = data
        return data
      }
    } catch {
      // Fall through to initialize.
    }

    this.skillsData = { skills: [] }
    this.saveSkills()
    return this.skillsData
  }

  private saveSkills(): void {
    if (!this.skillsData) return

    try {
      const filePath = getSkillsFilePath()
      ensureDir(path.dirname(filePath))
      fs.writeFileSync(filePath, JSON.stringify(this.skillsData, null, 2))
    } catch (error) {
      throw new Error(`Failed to save skills: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getSkillsFolderPath(): string {
    const folder = getManagedSkillsFolder()
    ensureDir(folder)
    return folder
  }

  getSkills(): AgentSkill[] {
    this.ensureInitialized()
    return this.skillsData?.skills || []
  }

  getEnabledSkills(): AgentSkill[] {
    return this.getSkills().filter((skill) => skill.enabled)
  }

  getSkill(id: string): AgentSkill | undefined {
    return this.getSkills().find((s) => s.id === id)
  }

  createSkill(
    name: string,
    description: string,
    instructions: string,
    options?: { source?: 'local' | 'imported'; filePath?: string },
  ): AgentSkill {
    this.ensureInitialized()

    const now = Date.now()
    const newSkill: AgentSkill = {
      id: randomUUID(),
      name,
      description,
      instructions,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      source: options?.source ?? 'local',
      filePath: options?.filePath,
    }

    this.skillsData!.skills.push(newSkill)
    this.saveSkills()
    return newSkill
  }

  updateSkill(
    id: string,
    updates: Partial<Pick<AgentSkill, 'name' | 'description' | 'instructions' | 'enabled'>>,
  ): AgentSkill {
    this.ensureInitialized()

    const skill = this.getSkill(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }

    const updatedSkill = {
      ...skill,
      ...updates,
      updatedAt: Date.now(),
    }

    const index = this.skillsData!.skills.findIndex((s) => s.id === id)
    this.skillsData!.skills[index] = updatedSkill
    this.saveSkills()
    return updatedSkill
  }

  deleteSkill(id: string): boolean {
    this.ensureInitialized()

    const skill = this.getSkill(id)
    if (!skill) return false

    this.skillsData!.skills = this.skillsData!.skills.filter((s) => s.id !== id)
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

  importSkillFromMarkdown(content: string): AgentSkill {
    if (!content || !content.trim()) {
      throw new Error('Empty markdown content')
    }
    const parsed = parseSkillMarkdown(content)
    return this.createSkill(parsed.name, parsed.description, parsed.instructions, {
      source: 'imported',
    })
  }

  exportSkillToMarkdown(id: string): string {
    const skill = this.getSkill(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }
    return skill.instructions
  }

  importSkillFromFile(filePath: string): AgentSkill {
    if (!filePath) {
      throw new Error('Missing file path')
    }
    const absPath = path.resolve(filePath)
    if (!fs.existsSync(absPath)) {
      throw new Error(`File does not exist: ${absPath}`)
    }
    const content = fs.readFileSync(absPath, 'utf8')
    const parsed = parseSkillMarkdown(content)
    return this.createSkill(parsed.name, parsed.description, parsed.instructions, {
      source: 'imported',
      filePath: absPath,
    })
  }

  importSkillFromFolder(folderPath: string): AgentSkill {
    if (!folderPath) {
      throw new Error('Missing folder path')
    }
    const absFolder = path.resolve(folderPath)
    if (!fs.existsSync(absFolder) || !fs.statSync(absFolder).isDirectory()) {
      throw new Error(`Folder does not exist: ${absFolder}`)
    }
    const skillFile = path.join(absFolder, 'SKILL.md')
    if (!fs.existsSync(skillFile)) {
      throw new Error(`SKILL.md not found in ${absFolder}`)
    }
    return this.importSkillFromFile(skillFile)
  }

  importSkillsFromParentFolder(parentPath: string): {
    imported: AgentSkill[]
    skipped: string[]
    errors: Array<{ folder: string; error: string }>
  } {
    if (!parentPath) {
      throw new Error('Missing parent folder path')
    }
    const absParent = path.resolve(parentPath)
    if (!fs.existsSync(absParent) || !fs.statSync(absParent).isDirectory()) {
      throw new Error(`Folder does not exist: ${absParent}`)
    }

    const imported: AgentSkill[] = []
    const skipped: string[] = []
    const errors: Array<{ folder: string; error: string }> = []
    const entries = fs.readdirSync(absParent, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folder = path.join(absParent, entry.name)
      const skillPath = path.join(folder, 'SKILL.md')
      if (!fs.existsSync(skillPath)) {
        skipped.push(entry.name)
        continue
      }
      try {
        imported.push(this.importSkillFromFile(skillPath))
      } catch (error) {
        errors.push({
          folder: entry.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return { imported, skipped, errors }
  }

  scanSkillsFolder(folderPath?: string): AgentSkill[] {
    const scanRoot = folderPath ? path.resolve(folderPath) : this.getSkillsFolderPath()
    if (!fs.existsSync(scanRoot)) {
      return []
    }

    const imported: AgentSkill[] = []
    const entries = fs.readdirSync(scanRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = path.join(scanRoot, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillPath)) continue
      imported.push(this.importSkillFromFile(skillPath))
    }
    return imported
  }

  saveSkillToFile(id: string, outputPath?: string): string {
    const skill = this.getSkill(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }

    const folder = this.getSkillsFolderPath()
    const skillDir = outputPath
      ? path.resolve(outputPath)
      : path.join(folder, sanitizeNameForPath(skill.name))
    ensureDir(skillDir)
    const skillFile = path.join(skillDir, 'SKILL.md')
    fs.writeFileSync(skillFile, normalizeLineEndings(skill.instructions), 'utf8')
    return skillFile
  }

  async importSkillFromGitHub(repoIdentifier: string): Promise<{
    imported: AgentSkill[]
    errors: string[]
  }> {
    const { owner, repo, pathParts } = normalizeGitHubRepoIdentifier(repoIdentifier)

    const candidatePaths: string[] = []
    if (pathParts.length === 0) {
      candidatePaths.push('SKILL.md', 'skills/SKILL.md')
    } else {
      const userPath = pathParts.join('/')
      if (userPath.toLowerCase().endsWith('skill.md')) {
        candidatePaths.push(userPath)
      } else {
        candidatePaths.push(`${userPath}/SKILL.md`)
      }
    }

    const branchCandidates = ['main', 'master']
    const errors: string[] = []

    for (const branch of branchCandidates) {
      for (const candidatePath of candidatePaths) {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${candidatePath}`
        try {
          const response = await fetch(url)
          if (!response.ok) {
            errors.push(`${url} -> HTTP ${response.status}`)
            continue
          }
          const markdown = await response.text()
          const imported = this.importSkillFromMarkdown(markdown)
          imported.filePath = url
          imported.source = 'imported'
          this.updateSkill(imported.id, {
            description: imported.description,
            instructions: imported.instructions,
          })
          return { imported: [imported], errors: [] }
        } catch (error) {
          errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    return {
      imported: [],
      errors: errors.length > 0 ? errors : ['No SKILL.md found in repository'],
    }
  }
}

export const skillsService = new SkillsService()
