#!/usr/bin/env node
/**
 * SpeakMCP CLI Config File Utilities
 * 
 * Direct manipulation of config.json without Electron dependencies.
 * Used by the CLI for terminal-based configuration.
 */

import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

// Determine config paths based on platform (mirrors Electron's app.getPath("appData"))
function getAppDataPath(): string {
  const platform = process.platform
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support")
  } else if (platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
  } else {
    // Linux and others use XDG_CONFIG_HOME or ~/.config
    return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  }
}

// App ID from environment or default
const APP_ID = process.env.APP_ID || "speakmcp"

export const dataFolder = path.join(getAppDataPath(), APP_ID)
export const configPath = path.join(dataFolder, "config.json")

/**
 * Default configuration values (subset of SpeakMCP Config type)
 */
const DEFAULT_CONFIG = {
  onboardingCompleted: false,
  remoteServerEnabled: false,
  remoteServerPort: 3210,
  remoteServerBindAddress: "127.0.0.1",
  shortcut: "hold-ctrl",
  ttsEnabled: true,
  themePreference: "system",
}

/**
 * Load config from disk, returning defaults if not found
 */
export function loadConfig(): Record<string, any> {
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, "utf8"))
      return { ...DEFAULT_CONFIG, ...data }
    }
  } catch (error) {
    console.error("Error loading config:", error)
  }
  return { ...DEFAULT_CONFIG }
}

/**
 * Save config to disk
 */
export function saveConfig(config: Record<string, any>): void {
  fs.mkdirSync(dataFolder, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

/**
 * Get a specific config value
 */
export function getConfigValue(key: string): any {
  const config = loadConfig()
  return config[key]
}

/**
 * Set a specific config value
 */
export function setConfigValue(key: string, value: any): void {
  const config = loadConfig()
  config[key] = value
  saveConfig(config)
}

/**
 * Generate a secure API key for remote server access
 */
export function generateApiKey(): string {
  return `smcp_${crypto.randomBytes(24).toString("base64url")}`
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(configPath)
}

/**
 * Get data folder path
 */
export function getDataFolder(): string {
  return dataFolder
}

/**
 * Get config file path
 */
export function getConfigPath(): string {
  return configPath
}
