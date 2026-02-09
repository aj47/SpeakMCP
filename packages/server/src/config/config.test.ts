import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  getDataDir,
  getConversationsFolder,
  getProfilesFolder,
  ensureDir,
} from './paths'

import {
  getDefaultConfig,
  migrateGroqTtsConfig,
  ORPHEUS_ENGLISH_VOICES,
  ORPHEUS_ARABIC_VOICES,
} from './defaults'

import { getEnvConfig } from './env'

describe('paths.ts', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakmcp-test-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('getDataDir', () => {
    it('should return SPEAKMCP_DATA_DIR when set', () => {
      const customPath = path.join(tempDir, 'custom-data')
      vi.stubEnv('SPEAKMCP_DATA_DIR', customPath)

      expect(getDataDir()).toBe(customPath)
    })

    it('should return platform-specific path when SPEAKMCP_DATA_DIR is not set', () => {
      vi.stubEnv('SPEAKMCP_DATA_DIR', '')
      const result = getDataDir()

      expect(result).toContain('speakmcp')
      expect(path.isAbsolute(result)).toBe(true)
    })
  })

  describe('getConversationsFolder', () => {
    it('should return conversations subdirectory of data dir', () => {
      const customPath = path.join(tempDir, 'data')
      vi.stubEnv('SPEAKMCP_DATA_DIR', customPath)

      expect(getConversationsFolder()).toBe(path.join(customPath, 'conversations'))
    })
  })

  describe('getProfilesFolder', () => {
    it('should return profiles subdirectory of data dir', () => {
      const customPath = path.join(tempDir, 'data')
      vi.stubEnv('SPEAKMCP_DATA_DIR', customPath)

      expect(getProfilesFolder()).toBe(path.join(customPath, 'profiles'))
    })
  })

  describe('ensureDir', () => {
    it('should create directory if it does not exist', () => {
      const newDir = path.join(tempDir, 'new-folder')
      expect(fs.existsSync(newDir)).toBe(false)

      ensureDir(newDir)

      expect(fs.existsSync(newDir)).toBe(true)
      expect(fs.statSync(newDir).isDirectory()).toBe(true)
    })

    it('should not throw if directory already exists', () => {
      const existingDir = path.join(tempDir, 'existing')
      fs.mkdirSync(existingDir)

      expect(() => ensureDir(existingDir)).not.toThrow()
      expect(fs.existsSync(existingDir)).toBe(true)
    })

    it('should create nested directories recursively', () => {
      const nestedDir = path.join(tempDir, 'a', 'b', 'c')

      ensureDir(nestedDir)

      expect(fs.existsSync(nestedDir)).toBe(true)
    })
  })
})

describe('defaults.ts', () => {
  describe('getDefaultConfig', () => {
    it('should return an object with expected default keys', () => {
      const config = getDefaultConfig()

      expect(config).toHaveProperty('onboardingCompleted', false)
      expect(config).toHaveProperty('ttsEnabled', true)
      expect(config).toHaveProperty('ttsProviderId', 'openai')
      expect(config).toHaveProperty('remoteServerPort', 3210)
      expect(config).toHaveProperty('mcpMaxIterations', 10)
    })

    it('should include TTS settings with defaults', () => {
      const config = getDefaultConfig()

      expect(config).toHaveProperty('groqTtsModel', 'canopylabs/orpheus-v1-english')
      expect(config).toHaveProperty('groqTtsVoice', 'troy')
      expect(config).toHaveProperty('openaiTtsVoice', 'alloy')
    })
  })

  describe('ORPHEUS voice constants', () => {
    it('should have valid English voices', () => {
      expect(ORPHEUS_ENGLISH_VOICES).toContain('troy')
      expect(ORPHEUS_ENGLISH_VOICES).toContain('autumn')
      expect(ORPHEUS_ENGLISH_VOICES.length).toBe(6)
    })

    it('should have valid Arabic voices', () => {
      expect(ORPHEUS_ARABIC_VOICES).toContain('fahad')
      expect(ORPHEUS_ARABIC_VOICES).toContain('noura')
      expect(ORPHEUS_ARABIC_VOICES.length).toBe(4)
    })
  })

  describe('migrateGroqTtsConfig', () => {
    it('should migrate playai-tts to orpheus-v1-english', () => {
      const config = { groqTtsModel: 'playai-tts', groqTtsVoice: 'some-voice' }
      const migrated = migrateGroqTtsConfig(config)

      expect(migrated.groqTtsModel).toBe('canopylabs/orpheus-v1-english')
      expect(migrated.groqTtsVoice).toBe('troy') // default voice
    })

    it('should migrate playai-tts-arabic to orpheus-arabic-saudi', () => {
      const config = { groqTtsModel: 'playai-tts-arabic', groqTtsVoice: 'some-voice' }
      const migrated = migrateGroqTtsConfig(config)

      expect(migrated.groqTtsModel).toBe('canopylabs/orpheus-arabic-saudi')
      expect(migrated.groqTtsVoice).toBe('fahad') // default Arabic voice
    })

    it('should keep valid model and voice unchanged', () => {
      const config = { groqTtsModel: 'canopylabs/orpheus-v1-english', groqTtsVoice: 'autumn' }
      const migrated = migrateGroqTtsConfig(config)

      expect(migrated.groqTtsModel).toBe('canopylabs/orpheus-v1-english')
      expect(migrated.groqTtsVoice).toBe('autumn')
    })

    it('should reset invalid voices to defaults for English model', () => {
      const config = { groqTtsModel: 'canopylabs/orpheus-v1-english', groqTtsVoice: 'invalid-voice' }
      const migrated = migrateGroqTtsConfig(config)

      expect(migrated.groqTtsVoice).toBe('troy')
    })

    it('should reset invalid voices to defaults for Arabic model', () => {
      const config = { groqTtsModel: 'canopylabs/orpheus-arabic-saudi', groqTtsVoice: 'troy' }
      const migrated = migrateGroqTtsConfig(config)

      expect(migrated.groqTtsVoice).toBe('fahad')
    })

    it('should migrate unknown model to orpheus-v1-english', () => {
      const config = { groqTtsModel: 'unknown-model', groqTtsVoice: 'troy' }
      const migrated = migrateGroqTtsConfig(config)

      expect(migrated.groqTtsModel).toBe('canopylabs/orpheus-v1-english')
    })
  })
})

describe('env.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('getEnvConfig', () => {
    it('should return default port when SPEAKMCP_PORT is not set', () => {
      vi.stubEnv('SPEAKMCP_PORT', '')

      const config = getEnvConfig()

      expect(config.port).toBe(3210)
    })

    it('should parse SPEAKMCP_PORT as integer', () => {
      vi.stubEnv('SPEAKMCP_PORT', '8080')

      const config = getEnvConfig()

      expect(config.port).toBe(8080)
    })

    it('should return default port for invalid SPEAKMCP_PORT', () => {
      vi.stubEnv('SPEAKMCP_PORT', 'not-a-number')

      const config = getEnvConfig()

      expect(config.port).toBe(3210)
    })

    it('should read SPEAKMCP_BIND_ADDRESS', () => {
      vi.stubEnv('SPEAKMCP_BIND_ADDRESS', '0.0.0.0')

      const config = getEnvConfig()

      expect(config.bindAddress).toBe('0.0.0.0')
    })

    it('should default bind address to 127.0.0.1', () => {
      vi.stubEnv('SPEAKMCP_BIND_ADDRESS', '')

      const config = getEnvConfig()

      expect(config.bindAddress).toBe('127.0.0.1')
    })

    it('should read SPEAKMCP_AUTH_TOKEN', () => {
      vi.stubEnv('SPEAKMCP_AUTH_TOKEN', 'my-secret-token')

      const config = getEnvConfig()

      expect(config.authToken).toBe('my-secret-token')
    })

    it('should parse valid log levels', () => {
      vi.stubEnv('SPEAKMCP_LOG_LEVEL', 'debug')
      expect(getEnvConfig().logLevel).toBe('debug')

      vi.stubEnv('SPEAKMCP_LOG_LEVEL', 'warn')
      expect(getEnvConfig().logLevel).toBe('warn')

      vi.stubEnv('SPEAKMCP_LOG_LEVEL', 'ERROR')
      expect(getEnvConfig().logLevel).toBe('error')
    })

    it('should default log level to info for invalid values', () => {
      vi.stubEnv('SPEAKMCP_LOG_LEVEL', 'invalid')

      const config = getEnvConfig()

      expect(config.logLevel).toBe('info')
    })

    it('should read API keys with SPEAKMCP_ prefix', () => {
      vi.stubEnv('SPEAKMCP_OPENAI_API_KEY', 'sk-openai-key')
      vi.stubEnv('SPEAKMCP_GROQ_API_KEY', 'groq-key')
      vi.stubEnv('SPEAKMCP_GEMINI_API_KEY', 'gemini-key')

      const config = getEnvConfig()

      expect(config.openaiApiKey).toBe('sk-openai-key')
      expect(config.groqApiKey).toBe('groq-key')
      expect(config.geminiApiKey).toBe('gemini-key')
    })

    it('should fall back to standard API key env vars', () => {
      vi.stubEnv('SPEAKMCP_OPENAI_API_KEY', '')
      vi.stubEnv('OPENAI_API_KEY', 'sk-standard-key')

      const config = getEnvConfig()

      expect(config.openaiApiKey).toBe('sk-standard-key')
    })

    it('should read Langfuse configuration', () => {
      vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-langfuse')
      vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-langfuse')
      vi.stubEnv('LANGFUSE_BASE_URL', 'https://langfuse.example.com')

      const config = getEnvConfig()

      expect(config.langfusePublicKey).toBe('pk-langfuse')
      expect(config.langfuseSecretKey).toBe('sk-langfuse')
      expect(config.langfuseBaseUrl).toBe('https://langfuse.example.com')
    })

    it('should read path overrides', () => {
      vi.stubEnv('SPEAKMCP_DATA_DIR', '/custom/data')
      vi.stubEnv('SPEAKMCP_CONFIG_PATH', '/custom/config.json')

      const config = getEnvConfig()

      expect(config.dataDir).toBe('/custom/data')
      expect(config.configPath).toBe('/custom/config.json')
    })
  })
})

describe('config store preset sync', () => {
  let tempDir: string
  let configPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakmcp-config-sync-test-'))
    configPath = path.join(tempDir, 'config.json')
    vi.stubEnv('SPEAKMCP_DATA_DIR', tempDir)
    vi.stubEnv('SPEAKMCP_CONFIG_PATH', configPath)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('SPEAKMCP_OPENAI_API_KEY', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should sync legacy OpenAI fields from active model preset on load', async () => {
    const presetApiKey = 'preset-openrouter-key'
    const legacyApiKey = 'legacy-openai-key'
    const presetBaseUrl = 'https://openrouter.ai/api/v1'
    const presetModel = 'x-ai/grok-4.1-fast'

    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          currentModelPresetId: 'builtin-openrouter',
          modelPresets: [
            {
              id: 'builtin-openrouter',
              name: 'OpenRouter',
              baseUrl: presetBaseUrl,
              apiKey: presetApiKey,
              isBuiltIn: true,
              mcpToolsModel: presetModel,
              transcriptProcessingModel: presetModel,
            },
          ],
          mcpToolsProviderId: 'openai',
          openaiApiKey: legacyApiKey,
          openaiBaseUrl: 'https://api.openai.com/v1',
          mcpToolsOpenaiModel: 'gpt-4o-mini',
          transcriptPostProcessingOpenaiModel: 'gpt-4o-mini',
        },
        null,
        2,
      ),
    )

    const { configStore } = await import('./index')
    const config = configStore.get() as Record<string, unknown>

    expect(config.currentModelPresetId).toBe('builtin-openrouter')
    expect(config.openaiApiKey).toBe(presetApiKey)
    expect(config.openaiBaseUrl).toBe(presetBaseUrl)
    expect(config.mcpToolsOpenaiModel).toBe(presetModel)
    expect(config.transcriptPostProcessingOpenaiModel).toBe(presetModel)
  })

  it('should sync legacy OpenAI fields from active model preset on save', async () => {
    const presetApiKey = 'preset-openrouter-key'
    const legacyApiKey = 'legacy-openai-key'
    const presetBaseUrl = 'https://openrouter.ai/api/v1'
    const presetModel = 'x-ai/grok-4.1-fast'

    const { configStore } = await import('./index')
    const current = configStore.get() as Record<string, unknown>

    configStore.save({
      ...current,
      currentModelPresetId: 'builtin-openrouter',
      modelPresets: [
        {
          id: 'builtin-openrouter',
          name: 'OpenRouter',
          baseUrl: presetBaseUrl,
          apiKey: presetApiKey,
          isBuiltIn: true,
          mcpToolsModel: presetModel,
          transcriptProcessingModel: presetModel,
        },
      ],
      mcpToolsProviderId: 'openai',
      openaiApiKey: legacyApiKey,
      openaiBaseUrl: 'https://api.openai.com/v1',
      mcpToolsOpenaiModel: 'gpt-4o-mini',
      transcriptPostProcessingOpenaiModel: 'gpt-4o-mini',
    })

    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(persisted.currentModelPresetId).toBe('builtin-openrouter')
    expect(persisted.openaiApiKey).toBe(presetApiKey)
    expect(persisted.openaiBaseUrl).toBe(presetBaseUrl)
    expect(persisted.mcpToolsOpenaiModel).toBe(presetModel)
    expect(persisted.transcriptPostProcessingOpenaiModel).toBe(presetModel)
  })
})
