import { LogLevel } from './utils/logger'

export interface WebDebugConfig {
  // Auto-session feature flag
  autoSessionEnabled: boolean
  
  // Logging configuration
  logLevel: LogLevel
  enableConsoleLogging: boolean
  enableUILogging: boolean
  maxLogEntries: number
  
  // Server configuration
  port: number
  host: string
  
  // MCP configuration
  enableMockTools: boolean
  mockDelay: number
}

// Default configuration
const DEFAULT_CONFIG: WebDebugConfig = {
  autoSessionEnabled: true,
  logLevel: 'info',
  enableConsoleLogging: true,
  enableUILogging: true,
  maxLogEntries: 1000,
  port: 3001,
  host: 'localhost',
  enableMockTools: true,
  mockDelay: 1000
}

// Environment variable mappings
const ENV_MAPPINGS = {
  WEB_DEBUG_LOG_LEVEL: (value: string) => {
    const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']
    return validLevels.includes(value as LogLevel) ? (value as LogLevel) : 'info'
  },
  WEB_DEBUG_AUTO_SESSION: (value: string) => value.toLowerCase() === 'true',
  WEB_DEBUG_PORT: (value: string) => parseInt(value, 10) || 3001,
  WEB_DEBUG_HOST: (value: string) => value || 'localhost',
  WEB_DEBUG_CONSOLE_LOGGING: (value: string) => value.toLowerCase() !== 'false',
  WEB_DEBUG_UI_LOGGING: (value: string) => value.toLowerCase() !== 'false',
  WEB_DEBUG_MAX_LOG_ENTRIES: (value: string) => parseInt(value, 10) || 1000,
  WEB_DEBUG_MOCK_TOOLS: (value: string) => value.toLowerCase() !== 'false',
  WEB_DEBUG_MOCK_DELAY: (value: string) => parseInt(value, 10) || 1000
}

// Load configuration from environment variables
function loadConfigFromEnv(): Partial<WebDebugConfig> {
  const config: Partial<WebDebugConfig> = {}
  
  // Map environment variables to config
  if (process.env.WEB_DEBUG_LOG_LEVEL) {
    config.logLevel = ENV_MAPPINGS.WEB_DEBUG_LOG_LEVEL(process.env.WEB_DEBUG_LOG_LEVEL)
  }
  
  if (process.env.WEB_DEBUG_AUTO_SESSION !== undefined) {
    config.autoSessionEnabled = ENV_MAPPINGS.WEB_DEBUG_AUTO_SESSION(process.env.WEB_DEBUG_AUTO_SESSION)
  }
  
  if (process.env.WEB_DEBUG_PORT) {
    config.port = ENV_MAPPINGS.WEB_DEBUG_PORT(process.env.WEB_DEBUG_PORT)
  }
  
  if (process.env.WEB_DEBUG_HOST) {
    config.host = ENV_MAPPINGS.WEB_DEBUG_HOST(process.env.WEB_DEBUG_HOST)
  }
  
  if (process.env.WEB_DEBUG_CONSOLE_LOGGING !== undefined) {
    config.enableConsoleLogging = ENV_MAPPINGS.WEB_DEBUG_CONSOLE_LOGGING(process.env.WEB_DEBUG_CONSOLE_LOGGING)
  }
  
  if (process.env.WEB_DEBUG_UI_LOGGING !== undefined) {
    config.enableUILogging = ENV_MAPPINGS.WEB_DEBUG_UI_LOGGING(process.env.WEB_DEBUG_UI_LOGGING)
  }
  
  if (process.env.WEB_DEBUG_MAX_LOG_ENTRIES) {
    config.maxLogEntries = ENV_MAPPINGS.WEB_DEBUG_MAX_LOG_ENTRIES(process.env.WEB_DEBUG_MAX_LOG_ENTRIES)
  }
  
  if (process.env.WEB_DEBUG_MOCK_TOOLS !== undefined) {
    config.enableMockTools = ENV_MAPPINGS.WEB_DEBUG_MOCK_TOOLS(process.env.WEB_DEBUG_MOCK_TOOLS)
  }
  
  if (process.env.WEB_DEBUG_MOCK_DELAY) {
    config.mockDelay = ENV_MAPPINGS.WEB_DEBUG_MOCK_DELAY(process.env.WEB_DEBUG_MOCK_DELAY)
  }
  
  return config
}

// Create the final configuration
export function createWebDebugConfig(overrides: Partial<WebDebugConfig> = {}): WebDebugConfig {
  const envConfig = loadConfigFromEnv()
  
  return {
    ...DEFAULT_CONFIG,
    ...envConfig,
    ...overrides
  }
}

// Export a default instance
export const webDebugConfig = createWebDebugConfig()

// Helper function to update configuration at runtime
export function updateWebDebugConfig(updates: Partial<WebDebugConfig>): WebDebugConfig {
  Object.assign(webDebugConfig, updates)
  return webDebugConfig
}

// Helper function to get configuration documentation
export function getConfigDocumentation(): Record<string, string> {
  return {
    WEB_DEBUG_LOG_LEVEL: 'Set log level (trace, debug, info, warn, error). Default: info',
    WEB_DEBUG_AUTO_SESSION: 'Enable auto-session creation (true/false). Default: true',
    WEB_DEBUG_PORT: 'Web debug server port. Default: 3001',
    WEB_DEBUG_HOST: 'Web debug server host. Default: localhost',
    WEB_DEBUG_CONSOLE_LOGGING: 'Enable console logging (true/false). Default: true',
    WEB_DEBUG_UI_LOGGING: 'Enable UI logging (true/false). Default: true',
    WEB_DEBUG_MAX_LOG_ENTRIES: 'Maximum log entries to keep in memory. Default: 1000',
    WEB_DEBUG_MOCK_TOOLS: 'Enable mock MCP tools (true/false). Default: true',
    WEB_DEBUG_MOCK_DELAY: 'Mock tool execution delay in ms. Default: 1000'
  }
}

// Helper function to validate configuration
export function validateWebDebugConfig(config: WebDebugConfig): string[] {
  const errors: string[] = []
  
  if (config.port < 1 || config.port > 65535) {
    errors.push('Port must be between 1 and 65535')
  }
  
  if (!config.host || config.host.trim() === '') {
    errors.push('Host cannot be empty')
  }
  
  if (config.maxLogEntries < 1) {
    errors.push('Max log entries must be at least 1')
  }
  
  if (config.mockDelay < 0) {
    errors.push('Mock delay cannot be negative')
  }
  
  return errors
}
