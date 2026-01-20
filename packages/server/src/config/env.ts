/**
 * Environment variable handling for SpeakMCP server
 * Provides type-safe access to environment configuration with defaults
 */

export interface EnvConfig {
  // Server settings
  port: number
  bindAddress: string
  authToken?: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'

  // API Keys
  openaiApiKey?: string
  groqApiKey?: string
  geminiApiKey?: string

  // Langfuse
  langfusePublicKey?: string
  langfuseSecretKey?: string
  langfuseBaseUrl?: string

  // Paths
  dataDir?: string
  configPath?: string
}

/**
 * Parse a string to an integer with a default value
 */
function parseIntWithDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Validate log level string
 */
function parseLogLevel(value: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
  const validLevels = ['debug', 'info', 'warn', 'error']
  if (value && validLevels.includes(value.toLowerCase())) {
    return value.toLowerCase() as 'debug' | 'info' | 'warn' | 'error'
  }
  return 'info'
}

/**
 * Get environment configuration
 * Reads from environment variables with SPEAKMCP_ prefix
 */
export function getEnvConfig(): EnvConfig {
  return {
    // Server settings
    port: parseIntWithDefault(process.env.SPEAKMCP_PORT, 3210),
    bindAddress: process.env.SPEAKMCP_BIND_ADDRESS || '127.0.0.1',
    authToken: process.env.SPEAKMCP_AUTH_TOKEN,
    logLevel: parseLogLevel(process.env.SPEAKMCP_LOG_LEVEL),

    // API Keys - check both SPEAKMCP_ prefixed and standard env vars
    openaiApiKey: process.env.SPEAKMCP_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    groqApiKey: process.env.SPEAKMCP_GROQ_API_KEY || process.env.GROQ_API_KEY,
    geminiApiKey: process.env.SPEAKMCP_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,

    // Langfuse
    langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
    langfuseBaseUrl: process.env.LANGFUSE_BASE_URL,

    // Paths
    dataDir: process.env.SPEAKMCP_DATA_DIR,
    configPath: process.env.SPEAKMCP_CONFIG_PATH,
  }
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development'
}

/**
 * Check if running in standalone server mode (not Electron)
 */
export function isStandaloneServer(): boolean {
  // No Electron version means we're running as standalone
  return !process.versions.electron
}

/**
 * Merge environment config with file config
 * Environment variables take precedence over file config
 */
export function mergeWithEnvConfig<T extends Record<string, unknown>>(fileConfig: T): T & Partial<EnvConfig> {
  const envConfig = getEnvConfig()
  const merged = { ...fileConfig } as T & Partial<EnvConfig>

  // API keys from env override file config
  if (envConfig.openaiApiKey) {
    (merged as any).openaiApiKey = envConfig.openaiApiKey
  }
  if (envConfig.groqApiKey) {
    (merged as any).groqApiKey = envConfig.groqApiKey
  }
  if (envConfig.geminiApiKey) {
    (merged as any).geminiApiKey = envConfig.geminiApiKey
  }

  // Langfuse from env
  if (envConfig.langfusePublicKey) {
    (merged as any).langfusePublicKey = envConfig.langfusePublicKey
  }
  if (envConfig.langfuseSecretKey) {
    (merged as any).langfuseSecretKey = envConfig.langfuseSecretKey
  }
  if (envConfig.langfuseBaseUrl) {
    (merged as any).langfuseBaseUrl = envConfig.langfuseBaseUrl
  }

  // Server settings from env
  if (envConfig.authToken) {
    (merged as any).remoteServerApiKey = envConfig.authToken
  }

  return merged
}

