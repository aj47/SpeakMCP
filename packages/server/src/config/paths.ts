import path from 'path'
import os from 'os'
import fs from 'fs'

// The Electron app uses 'app.speakmcp' as its app ID (from electron-builder.config.cjs)
const ELECTRON_APP_ID = 'app.speakmcp'
// Standalone server data directory name
const STANDALONE_DATA_DIR = 'speakmcp'

/**
 * Get the Electron app's data directory path
 * This matches Electron's app.getPath('appData') + appId behavior
 */
export function getElectronAppDataDir(): string {
  const platform = process.platform
  const homeDir = os.homedir()

  switch (platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', ELECTRON_APP_ID)
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), ELECTRON_APP_ID)
    case 'linux':
    default:
      // Electron uses ~/.config on Linux
      const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config')
      return path.join(xdgConfig, ELECTRON_APP_ID)
  }
}

/**
 * Get the standalone server's data directory path
 */
function getStandaloneDataDir(): string {
  const platform = process.platform
  const homeDir = os.homedir()

  switch (platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', STANDALONE_DATA_DIR)
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), STANDALONE_DATA_DIR)
    case 'linux':
    default:
      // Follow XDG Base Directory Specification
      const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share')
      return path.join(xdgDataHome, STANDALONE_DATA_DIR)
  }
}

/**
 * Get the base data directory for SpeakMCP
 * Priority:
 * 1. SPEAKMCP_DATA_DIR environment variable
 * 2. Electron app directory (if exists and has config)
 * 3. Standalone server directory
 */
export function getDataDir(): string {
  // Environment variable override takes precedence
  if (process.env.SPEAKMCP_DATA_DIR) {
    return process.env.SPEAKMCP_DATA_DIR
  }

  // Check if Electron app config exists - if so, use that directory
  // This allows the server to share config with the desktop app
  const electronDir = getElectronAppDataDir()
  const electronConfigPath = path.join(electronDir, 'config.json')

  if (fs.existsSync(electronConfigPath)) {
    return electronDir
  }

  // Fall back to standalone data directory
  return getStandaloneDataDir()
}

/**
 * Get the config file path
 * Override with SPEAKMCP_CONFIG_PATH environment variable
 */
export function getConfigPath(): string {
  if (process.env.SPEAKMCP_CONFIG_PATH) {
    return process.env.SPEAKMCP_CONFIG_PATH
  }
  return path.join(getDataDir(), 'config.json')
}

/**
 * Get the conversations folder path
 */
export function getConversationsFolder(): string {
  return path.join(getDataDir(), 'conversations')
}

/**
 * Get the recordings folder path
 */
export function getRecordingsFolder(): string {
  return path.join(getDataDir(), 'recordings')
}

/**
 * Get the profiles folder path
 */
export function getProfilesFolder(): string {
  return path.join(getDataDir(), 'profiles')
}

/**
 * Get the OAuth storage path
 */
export function getOAuthStoragePath(): string {
  return path.join(getDataDir(), 'oauth-tokens.json')
}

/**
 * Get the memories folder path
 */
export function getMemoriesFolder(): string {
  return path.join(getDataDir(), 'memories')
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Ensure all required data directories exist
 */
export function ensureDataDirs(): void {
  ensureDir(getDataDir())
  ensureDir(getConversationsFolder())
  ensureDir(getRecordingsFolder())
  ensureDir(getProfilesFolder())
  ensureDir(getMemoriesFolder())
}

