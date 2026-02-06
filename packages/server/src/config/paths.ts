import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Electron app ID — used as the data directory name to share config/profiles
 * with the Electron desktop app.
 */
const APP_ID = 'app.speakmcp'
const LEGACY_DIR_NAME = 'speakmcp'

/**
 * Get the base data directory for SpeakMCP
 * Uses the same path as Electron's app.getPath('appData') + APP_ID so that
 * the standalone server and Electron share profiles, config, and conversations.
 * Falls back to the legacy 'speakmcp' directory if it exists and the
 * Electron-compatible directory does not (backward compatibility).
 */
export function getDataDir(): string {
  // Environment variable override takes precedence
  if (process.env.SPEAKMCP_DATA_DIR) {
    return process.env.SPEAKMCP_DATA_DIR
  }

  const platform = process.platform
  const homeDir = os.homedir()

  let primaryDir: string
  let legacyDir: string

  switch (platform) {
    case 'darwin':
      primaryDir = path.join(homeDir, 'Library', 'Application Support', APP_ID)
      legacyDir = path.join(homeDir, 'Library', 'Application Support', LEGACY_DIR_NAME)
      break
    case 'win32': {
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
      primaryDir = path.join(appData, APP_ID)
      legacyDir = path.join(appData, LEGACY_DIR_NAME)
      break
    }
    case 'linux':
    default: {
      // Match Electron's app.getPath('appData') which uses XDG_CONFIG_HOME
      const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config')
      primaryDir = path.join(xdgConfigHome, APP_ID)
      // Legacy used XDG_DATA_HOME
      const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share')
      legacyDir = path.join(xdgDataHome, LEGACY_DIR_NAME)
      break
    }
  }

  // Prefer the Electron-compatible directory.
  // Fall back to legacy directory only if it exists and the primary does not.
  if (fs.existsSync(primaryDir)) {
    return primaryDir
  }
  if (fs.existsSync(legacyDir)) {
    return legacyDir
  }
  // New installation — use the Electron-compatible path
  return primaryDir
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

