import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Get the base data directory for SpeakMCP
 * This matches Electron's app.getPath('appData') behavior
 */
export function getDataDir(): string {
  // Environment variable override takes precedence
  if (process.env.SPEAKMCP_DATA_DIR) {
    return process.env.SPEAKMCP_DATA_DIR
  }

  const platform = process.platform
  const homeDir = os.homedir()

  switch (platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'speakmcp')
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'speakmcp')
    case 'linux':
    default:
      // Follow XDG Base Directory Specification
      const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share')
      return path.join(xdgDataHome, 'speakmcp')
  }
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

