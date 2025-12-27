import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'

export interface ProfileMcpServerConfig {
  disabledServers?: string[]
  disabledTools?: string[]
  allServersDisabledByDefault?: boolean
  enabledServers?: string[]
}

export interface ProfileModelConfig {
  mcpToolsProviderId?: 'openai' | 'groq' | 'gemini'
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  currentModelPresetId?: string
  sttProviderId?: 'openai' | 'groq'
  transcriptPostProcessingProviderId?: 'openai' | 'groq' | 'gemini'
  transcriptPostProcessingOpenaiModel?: string
  transcriptPostProcessingGroqModel?: string
  transcriptPostProcessingGeminiModel?: string
  ttsProviderId?: 'openai' | 'groq' | 'gemini'
}

export interface Profile {
  id: string
  name: string
  guidelines: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
  isDefault?: boolean
  createdAt: number
  updatedAt: number
}

export interface SessionProfileSnapshot {
  profileId: string
  profileName: string
  guidelines?: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
}

class ProfileService {
  private ensureDefaultProfile(): void {
    const db = getDb()
    const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get('default')
    
    if (!existing) {
      const now = Date.now()
      db.prepare(`
        INSERT INTO profiles (id, name, guidelines, is_default, created_at, updated_at, mcp_server_config)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'default',
        'Default',
        '',
        1,
        now,
        now,
        JSON.stringify({ allServersDisabledByDefault: true, disabledServers: [], disabledTools: [] })
      )
    }
  }

  private rowToProfile(row: any): Profile {
    return {
      id: row.id,
      name: row.name,
      guidelines: row.guidelines,
      systemPrompt: row.system_prompt || undefined,
      mcpServerConfig: row.mcp_server_config ? JSON.parse(row.mcp_server_config) : undefined,
      modelConfig: row.model_config ? JSON.parse(row.model_config) : undefined,
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  getProfiles(): Profile[] {
    this.ensureDefaultProfile()
    const db = getDb()
    const rows = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all()
    return rows.map((row: any) => this.rowToProfile(row))
  }

  getProfile(id: string): Profile | undefined {
    this.ensureDefaultProfile()
    const db = getDb()
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as any
    return row ? this.rowToProfile(row) : undefined
  }

  getCurrentProfile(): Profile | undefined {
    const db = getDb()
    const configRow = db.prepare('SELECT value FROM config WHERE key = ?').get('main') as { value: string } | undefined
    const config = configRow ? JSON.parse(configRow.value) : {}
    const currentId = config.currentProfileId || 'default'
    return this.getProfile(currentId)
  }

  createProfile(name: string, guidelines: string, systemPrompt?: string): Profile {
    const db = getDb()
    const id = uuidv4()
    const now = Date.now()
    
    // New profiles have all MCPs disabled by default
    const mcpServerConfig: ProfileMcpServerConfig = {
      allServersDisabledByDefault: true,
      disabledServers: [],
      disabledTools: [],
    }

    db.prepare(`
      INSERT INTO profiles (id, name, guidelines, system_prompt, mcp_server_config, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, guidelines, systemPrompt || null, JSON.stringify(mcpServerConfig), 0, now, now)

    return this.getProfile(id)!
  }

  updateProfile(
    id: string,
    updates: Partial<Pick<Profile, 'name' | 'guidelines' | 'systemPrompt'>>
  ): Profile {
    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    if (profile.isDefault) {
      throw new Error('Cannot update default profile name or guidelines')
    }

    const db = getDb()
    const now = Date.now()

    const updateFields: string[] = ['updated_at = ?']
    const values: any[] = [now]

    if (updates.name !== undefined) {
      updateFields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.guidelines !== undefined) {
      updateFields.push('guidelines = ?')
      values.push(updates.guidelines)
    }
    if (updates.systemPrompt !== undefined) {
      updateFields.push('system_prompt = ?')
      values.push(updates.systemPrompt)
    }

    values.push(id)
    db.prepare(`UPDATE profiles SET ${updateFields.join(', ')} WHERE id = ?`).run(...values)

    return this.getProfile(id)!
  }

  deleteProfile(id: string): boolean {
    const profile = this.getProfile(id)
    if (!profile) {
      return false
    }

    if (profile.isDefault) {
      throw new Error('Cannot delete default profile')
    }

    // If this was the current profile, switch to default
    const current = this.getCurrentProfile()
    if (current?.id === id) {
      this.setCurrentProfile('default')
    }

    const db = getDb()
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
    return true
  }

  setCurrentProfile(id: string): Profile {
    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    const db = getDb()
    const configRow = db.prepare('SELECT value FROM config WHERE key = ?').get('main') as { value: string } | undefined
    const config = configRow ? JSON.parse(configRow.value) : {}
    config.currentProfileId = id

    db.prepare(`
      INSERT OR REPLACE INTO config (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run('main', JSON.stringify(config), Date.now())

    return profile
  }

  updateProfileMcpConfig(id: string, mcpServerConfig: Partial<ProfileMcpServerConfig>): Profile {
    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    const merged: ProfileMcpServerConfig = {
      ...(profile.mcpServerConfig || {}),
      ...(mcpServerConfig.disabledServers !== undefined && { disabledServers: mcpServerConfig.disabledServers }),
      ...(mcpServerConfig.disabledTools !== undefined && { disabledTools: mcpServerConfig.disabledTools }),
      ...(mcpServerConfig.allServersDisabledByDefault !== undefined && { allServersDisabledByDefault: mcpServerConfig.allServersDisabledByDefault }),
      ...(mcpServerConfig.enabledServers !== undefined && { enabledServers: mcpServerConfig.enabledServers }),
    }

    const db = getDb()
    db.prepare(`
      UPDATE profiles SET mcp_server_config = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(merged), Date.now(), id)

    return this.getProfile(id)!
  }

  updateProfileModelConfig(id: string, modelConfig: Partial<ProfileModelConfig>): Profile {
    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    const merged: ProfileModelConfig = {
      ...(profile.modelConfig || {}),
      ...modelConfig,
    }

    const db = getDb()
    db.prepare(`
      UPDATE profiles SET model_config = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(merged), Date.now(), id)

    return this.getProfile(id)!
  }

  exportProfile(id: string): string {
    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    const exportData: any = {
      version: 1,
      name: profile.name,
      guidelines: profile.guidelines,
    }

    if (profile.systemPrompt) {
      exportData.systemPrompt = profile.systemPrompt
    }
    if (profile.mcpServerConfig) {
      exportData.mcpServerConfig = profile.mcpServerConfig
    }
    if (profile.modelConfig) {
      exportData.modelConfig = profile.modelConfig
    }

    return JSON.stringify(exportData, null, 2)
  }

  importProfile(profileJson: string): Profile {
    const importData = JSON.parse(profileJson)

    if (!importData.name || typeof importData.name !== 'string') {
      throw new Error('Invalid profile data: missing or invalid name')
    }

    const newProfile = this.createProfile(
      importData.name,
      importData.guidelines || '',
      importData.systemPrompt
    )

    if (importData.mcpServerConfig) {
      this.updateProfileMcpConfig(newProfile.id, importData.mcpServerConfig)
    }

    if (importData.modelConfig) {
      this.updateProfileModelConfig(newProfile.id, importData.modelConfig)
    }

    return this.getProfile(newProfile.id)!
  }
}

export const profileService = new ProfileService()
