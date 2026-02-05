/**
 * Skills Service for agent skills management
 * Simplified port from desktop's skills-service.ts with core CRUD operations.
 * Omits GitHub import complexity (not needed for CLI parity).
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getDataDir, ensureDir } from '../config/index'
import type { AgentSkill, AgentSkillsData } from '../types/index'

function getSkillsFilePath(): string {
  return path.join(getDataDir(), 'skills.json')
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
      // Fall through to initialize
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

  getSkills(): AgentSkill[] {
    this.ensureInitialized()
    return this.skillsData?.skills || []
  }

  getEnabledSkills(): AgentSkill[] {
    return this.getSkills().filter(skill => skill.enabled)
  }

  getSkill(id: string): AgentSkill | undefined {
    return this.getSkills().find(s => s.id === id)
  }

  createSkill(
    name: string,
    description: string,
    instructions: string,
    options?: { source?: 'local' | 'imported'; filePath?: string }
  ): AgentSkill {
    this.ensureInitialized()

    const newSkill: AgentSkill = {
      id: randomUUID(),
      name,
      description,
      instructions,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: options?.source ?? 'local',
      filePath: options?.filePath,
    }

    this.skillsData!.skills.push(newSkill)
    this.saveSkills()
    return newSkill
  }

  updateSkill(id: string, updates: Partial<Pick<AgentSkill, 'name' | 'description' | 'instructions' | 'enabled'>>): AgentSkill {
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

    const index = this.skillsData!.skills.findIndex(s => s.id === id)
    this.skillsData!.skills[index] = updatedSkill
    this.saveSkills()
    return updatedSkill
  }

  deleteSkill(id: string): boolean {
    this.ensureInitialized()

    const skill = this.getSkill(id)
    if (!skill) return false

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
}

export const skillsService = new SkillsService()

