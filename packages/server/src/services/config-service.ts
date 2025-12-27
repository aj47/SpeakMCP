import { getDb } from '../db/index.js'
import { z } from 'zod'

// Schema matching the desktop app's config
export const AppConfigSchema = z.object({
  // API Keys
  openaiApiKey: z.string().optional(),
  openaiBaseUrl: z.string().optional(),
  groqApiKey: z.string().optional(),
  groqBaseUrl: z.string().optional(),
  geminiApiKey: z.string().optional(),
  geminiBaseUrl: z.string().optional(),

  // STT
  sttProviderId: z.enum(['openai', 'groq']).default('openai'),
  sttLanguage: z.string().optional(),
  sttGroqPrompt: z.string().optional(),

  // TTS
  ttsEnabled: z.boolean().default(false),
  ttsProviderId: z.enum(['openai', 'groq', 'gemini']).default('openai'),
  ttsVoice: z.string().optional(),
  ttsModel: z.string().optional(),
  ttsPreprocessingEnabled: z.boolean().default(false),
  ttsPreprocessingMode: z.enum(['llm', 'regex']).default('regex'),

  // Agent
  mcpToolsProviderId: z.enum(['openai', 'groq', 'gemini']).default('openai'),
  mcpToolsModelId: z.string().optional(),
  mcpToolsSystemPrompt: z.string().optional(),
  mcpCustomSystemPrompt: z.string().optional(),
  mcpMaxIterations: z.number().default(25),
  mcpRequireApprovalBeforeToolCall: z.boolean().default(false),
  mcpMessageQueueEnabled: z.boolean().default(true),

  // Post-processing
  postProcessingEnabled: z.boolean().default(false),
  postProcessingProviderId: z.enum(['openai', 'groq', 'gemini']).default('openai'),

  // Model presets
  modelPresets: z.array(z.object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string(),
    apiKey: z.string().optional(),
    models: z.array(z.string()).optional(),
  })).optional(),
  currentModelPresetId: z.string().optional(),
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export const configService = {
  get(): AppConfig {
    const db = getDb()
    const rows = db.prepare('SELECT key, value FROM config').all() as { key: string; value: string }[]

    const configObj: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        configObj[row.key] = JSON.parse(row.value)
      } catch {
        configObj[row.key] = row.value
      }
    }

    // Parse with defaults
    return AppConfigSchema.parse(configObj)
  },

  getKey<K extends keyof AppConfig>(key: K): AppConfig[K] {
    const db = getDb()
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined
    
    if (!row) {
      const defaults = AppConfigSchema.parse({})
      return defaults[key]
    }

    try {
      return JSON.parse(row.value)
    } catch {
      return row.value as AppConfig[K]
    }
  },

  update(patch: Partial<AppConfig>): AppConfig {
    const db = getDb()
    const now = Date.now()

    const stmt = db.prepare(`
      INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)

    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        stmt.run(key, JSON.stringify(value), now)
      }
    }

    return this.get()
  },

  setKey<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    const db = getDb()
    const now = Date.now()

    db.prepare(`
      INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), now)
  },

  deleteKey(key: keyof AppConfig): void {
    const db = getDb()
    db.prepare('DELETE FROM config WHERE key = ?').run(key)
  },

  // App state helpers
  getCurrentProfileId(): string | null {
    const db = getDb()
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get('currentProfileId') as { value: string } | undefined
    return row?.value ?? null
  },

  setCurrentProfileId(profileId: string | null): void {
    const db = getDb()
    if (profileId === null) {
      db.prepare('DELETE FROM app_state WHERE key = ?').run('currentProfileId')
    } else {
      db.prepare(`
        INSERT INTO app_state (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run('currentProfileId', profileId)
    }
  },

  getAppState(key: string): string | null {
    const db = getDb()
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  },

  setAppState(key: string, value: string | null): void {
    const db = getDb()
    if (value === null) {
      db.prepare('DELETE FROM app_state WHERE key = ?').run(key)
    } else {
      db.prepare(`
        INSERT INTO app_state (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key, value)
    }
  },
}

