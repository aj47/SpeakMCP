/**
 * Application-wide constants to avoid magic numbers and hardcoded values
 */

// Timeout values (in milliseconds)
export const TIMEOUTS = {
  DEFAULT_CONNECTION: 10000,
  API_CALL_RETRY: 3000,
  HEALTH_CHECK: 5000,
  MCP_SERVER_CONNECTION: 10000,
  UPDATE_CHECK_INTERVAL: 300000, // 5 minutes
} as const

// Retry configurations
export const RETRY_CONFIG = {
  DEFAULT_ATTEMPTS: 3,
  API_CALL_ATTEMPTS: 3,
  CONNECTION_ATTEMPTS: 2,
} as const

// Cache durations (in milliseconds)
export const CACHE_DURATION = {
  MODELS: 300000, // 5 minutes
  HEALTH_CHECK: 60000, // 1 minute
  DIAGNOSTIC_INFO: 30000, // 30 seconds
} as const

// Default configuration values
export const DEFAULT_CONFIG = {
  MCP_AUTO_PASTE_DELAY: 1000,
  MCP_MAX_ITERATIONS: 10,
  MAX_CONVERSATIONS_TO_KEEP: 100,
  RECENT_ERRORS_WINDOW: 300000, // 5 minutes
} as const

// API endpoints and paths
export const API_ENDPOINTS = {
  OPENAI_CHAT: '/chat/completions',
  GEMINI_GENERATE: '/v1beta/models',
} as const

// Common Node.js paths for MCP servers
export const COMMON_NODE_PATHS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '~/.npm-global/bin',
  '~/node_modules/.bin',
] as const

// File extensions
export const FILE_EXTENSIONS = {
  WINDOWS_EXECUTABLES: ['.exe', '.cmd', '.bat'],
  UNIX_EXECUTABLES: [''],
  AUDIO: ['.webm', '.wav', '.mp3'],
} as const

// Error messages
export const ERROR_MESSAGES = {
  NO_RESPONSE_CONTENT: 'No response content received',
  CONNECTION_TIMEOUT: 'Connection test timeout',
  UNEXPECTED_RETRY_ERROR: 'Unexpected error in retry logic',
  API_CALL_FAILED: 'API call failed after retries',
  SESSION_NOT_FOUND: 'Session not found',
  PERMISSION_DENIED: 'Permission denied',
  RESOURCE_NOT_FOUND: 'Resource not found',
  NPX_NOT_FOUND: 'npx not found in PATH. Please ensure Node.js is properly installed.',
} as const

// Recovery suggestions
export const RECOVERY_SUGGESTIONS = {
  SESSION_LOST: 'For session errors: Create a new session using ht_create_session first',
  CONNECTIVITY: 'For connectivity issues: Wait a moment and retry, or check if the service is running',
  PERMISSIONS: 'For permission errors: Try alternative file locations or check access rights',
  RESOURCE_MISSING: 'For missing resources: Check if the file or resource exists',
  TIMEOUT: 'Retry the operation or check server connectivity',
} as const

// Query keys for React Query
export const QUERY_KEYS = {
  MICROPHONE_STATUS: 'microphone-status',
  CONFIG: 'config',
  UPDATE_INFO: 'update-info',
  SETUP_ACCESSIBILITY: 'setup-isAccessibilityGranted',
  MCP_TOOLS: 'mcp-tools',
  DIAGNOSTIC_REPORT: 'diagnostic-report',
  HEALTH_CHECK: 'health-check',
} as const

// MCP client configuration
export const MCP_CLIENT_CONFIG = {
  NAME: 'speakmcp-mcp-client',
  VERSION: '1.0.0',
} as const

// Platform-specific constants
export const PLATFORM = {
  PATH_SEPARATOR: {
    WIN32: ';',
    UNIX: ':',
  },
  DEFAULT_PATH: '/usr/local/bin:/usr/bin:/bin',
} as const

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const

// Component update intervals (in milliseconds)
export const UPDATE_INTERVALS = {
  MCP_TOOLS_REFRESH: 5000,
  DIAGNOSTIC_REFRESH: 10000,
  STATUS_CHECK: 2000,
} as const
