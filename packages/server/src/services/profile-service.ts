import { getDb } from '../db/index.js'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { configService } from './config-service.js'

export const ProfileMcpConfigSchema = z.object({
  disabledServers: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
})

export const ProfileModelConfigSchema = z.object({
  providerId: z.enum(['openai', 'groq', 'gemini']).optional(),
  modelId: z.string().optional(),
  customPresetId: z.string().optional(),
})

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  guidelines: z.string(),
  systemPrompt: z.string().optional(),
  mcpServerConfig: ProfileMcpConfigSchema.optional(),
  modelConfig: ProfileModelConfigSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type Profile = z.infer<typeof ProfileSchema>
export type ProfileMcpConfig = z.infer<typeof ProfileMcpConfigSchema>
export type ProfileModelConfig = z.infer<typeof ProfileModelConfigSchema>

interface DbProfile {
  id: string
  name: string
  guidelines: string
  system_prompt: string | null
  mcp_server_config: string | null
  model_config: string | null
  created_at: number
  updated_at: number
}

function dbRowToProfile(row: DbProfile): Profile {
  return {
    id: row.id,
    name: row.name,
    guidelines: row.guidelines,
    systemPrompt: row.system_prompt ?? undefined,
    mcpServerConfig: row.mcp_server_config ? JSON.parse(row.mcp_server_config) : undefined,
    modelConfig: row.model_config ? JSON.parse(row.model_config) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const profileService = {
  list(): Profile[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all() as DbProfile[]
    return rows.map(dbRowToProfile)
  },

  get(id: string): Profile | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as DbProfile | undefined
    if (!row) return null
    return dbRowToProfile(row)
  },

  getCurrent(): Profile | null {
    const currentId = configService.getCurrentProfileId()
    if (!currentId) return null
    return this.get(currentId)
  },

  create(
    name: string, 
    guidelines: string = '', 
    systemPrompt?: string,
    mcpServerConfig?: ProfileMcpConfig,
    modelConfig?: ProfileModelConfig
  ): Profile {
    const db = getDb()
    const now = Date.now()
    const id = `profile_${nanoid()}`

    db.prepare(`
      INSERT INTO profiles (id, name, guidelines, system_prompt, mcp_server_config, model_config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      guidelines,
      systemPrompt ?? null,
      mcpServerConfig ? JSON.stringify(mcpServerConfig) : null,
      modelConfig ? JSON.stringify(modelConfig) : null,
      now,
      now
    )

    return this.get(id)!
  },

  update(id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>): Profile | null {
    const db = getDb()
    const existing = this.get(id)
    if (!existing) return null

    const now = Date.now()

    db.prepare(`
      UPDATE profiles SET
        name = ?,
        guidelines = ?,
        system_prompt = ?,
        mcp_server_config = ?,
        model_config = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updates.name ?? existing.name,
      updates.guidelines ?? existing.guidelines,
      updates.systemPrompt !== undefined ? updates.systemPrompt : existing.systemPrompt ?? null,
      updates.mcpServerConfig !== undefined 
        ? (updates.mcpServerConfig ? JSON.stringify(updates.mcpServerConfig) : null)
        : (existing.mcpServerConfig ? JSON.stringify(existing.mcpServerConfig) : null),
      updates.modelConfig !== undefined
        ? (updates.modelConfig ? JSON.stringify(updates.modelConfig) : null)
        : (existing.modelConfig ? JSON.stringify(existing.modelConfig) : null),
      now,
      id
    )

    return this.get(id)
  },

  delete(id: string): boolean {
    const db = getDb()

    // Clear current profile if deleting it
    const currentId = configService.getCurrentProfileId()
    if (currentId === id) {
      configService.setCurrentProfileId(null)
    }

    const result = db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
    return result.changes > 0
  },

  setCurrentProfile(id: string): Profile | null {
    const profile = this.get(id)
    if (!profile) return null
    configService.setCurrentProfileId(id)
    return profile
  },

  clearCurrentProfile(): void {
    configService.setCurrentProfileId(null)
  },

  // Create a snapshot for session isolation
  createSnapshot(profileId: string): Profile | null {
    const profile = this.get(profileId)
    if (!profile) return null
    // Return a deep copy
    return JSON.parse(JSON.stringify(profile))
  },

  // Export profile (without id, timestamps)
  export(id: string): Omit<Profile, 'id' | 'createdAt' | 'updatedAt'> | null {
    const profile = this.get(id)
    if (!profile) return null

    const { id: _id, createdAt: _ca, updatedAt: _ua, ...exportData } = profile
    return exportData
  },

  // Import profile
  import(data: {
    name: string
    guidelines?: string
    systemPrompt?: string
    mcpServerConfig?: ProfileMcpConfig
    modelConfig?: ProfileModelConfig
  }): Profile {
    return this.create(
      data.name,
      data.guidelines ?? '',
      data.systemPrompt,
      data.mcpServerConfig,
      data.modelConfig
    )
  },

  // Check if profile exists
  exists(id: string): boolean {
    const db = getDb()
    const row = db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(id)
    return !!row
  },
}

