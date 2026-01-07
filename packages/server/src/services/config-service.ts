import { getDb } from '../db/index.js'
import crypto from 'crypto'

export interface ServerConfig {
  // Server settings
  serverApiKey?: string
  serverPort?: number
  serverBindAddress?: string
  
  // API Keys & Endpoints (stored encrypted/redacted in responses)
  openaiApiKey?: string
  openaiBaseUrl?: string
  groqApiKey?: string
  groqBaseUrl?: string
  geminiApiKey?: string
  geminiBaseUrl?: string
  
  // MCP Configuration
  mcpConfig?: {
    mcpServers: Record<string, MCPServerConfig>
  }
  mcpRuntimeDisabledServers?: string[]
  mcpDisabledTools?: string[]
  mcpMaxIterations?: number
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpMessageQueueEnabled?: boolean
  
  // STT Settings
  sttProviderId?: 'openai' | 'groq'
  sttLanguage?: string
  
  // TTS Settings
  ttsEnabled?: boolean
  ttsProviderId?: 'openai' | 'groq' | 'gemini'
  
  // Agent Settings
  mcpToolsProviderId?: 'openai' | 'groq' | 'gemini'
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpToolsSystemPrompt?: string
  mcpCustomSystemPrompt?: string
  
  // Model Presets
  modelPresets?: ModelPreset[]
  currentModelPresetId?: string
  
  // Current profile
  currentProfileId?: string
}

export interface MCPServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  transport?: 'stdio' | 'websocket' | 'streamableHttp'
  timeout?: number
  disabled?: boolean
  headers?: Record<string, string>
}

export interface ModelPreset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  isBuiltIn?: boolean
  createdAt?: number
  updatedAt?: number
  mcpToolsModel?: string
  transcriptProcessingModel?: string
}

const SENSITIVE_KEYS = ['openaiApiKey', 'groqApiKey', 'geminiApiKey', 'serverApiKey']

function redactValue(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.length <= 8) return '***'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

class ConfigService {
  private defaultConfig: ServerConfig = {
    serverPort: 3847,
    serverBindAddress: '0.0.0.0',
    mcpMaxIterations: 10,
    mcpRequireApprovalBeforeToolCall: false,
    mcpMessageQueueEnabled: true,
    ttsEnabled: true,
    sttProviderId: 'openai',
    ttsProviderId: 'openai',
    mcpToolsProviderId: 'openai',
  }

  async get(): Promise<ServerConfig> {
    try {
      const db = getDb()
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get('main') as { value: string } | undefined
      const stored = row ? JSON.parse(row.value) : {}
      return { ...this.defaultConfig, ...stored }
    } catch {
      return this.defaultConfig
    }
  }

  async getRedacted(): Promise<ServerConfig> {
    const config = await this.get()
    const redacted = { ...config }
    
    for (const key of SENSITIVE_KEYS) {
      if (key in redacted) {
        (redacted as any)[key] = redactValue((redacted as any)[key])
      }
    }
    
    // Also redact API keys in model presets
    if (redacted.modelPresets) {
      redacted.modelPresets = redacted.modelPresets.map(preset => ({
        ...preset,
        apiKey: redactValue(preset.apiKey) || '',
      }))
    }
    
    return redacted
  }

  async update(patch: Partial<ServerConfig>): Promise<ServerConfig> {
    const current = await this.get()
    const updated = { ...current, ...patch }
    
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO config (key, value, updated_at) 
      VALUES (?, ?, ?)
    `).run('main', JSON.stringify(updated), Date.now())
    
    return updated
  }

  async generateApiKey(): Promise<string> {
    const apiKey = crypto.randomBytes(32).toString('hex')
    await this.update({ serverApiKey: apiKey })
    return apiKey
  }

  async ensureApiKey(): Promise<string> {
    const config = await this.get()
    if (config.serverApiKey) {
      return config.serverApiKey
    }
    return this.generateApiKey()
  }
}

export const configService = new ConfigService()
