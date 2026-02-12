/**
 * CLI Config File Utilities
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
const APP_ID = process.env.APP_ID || "acpremote"

export const dataFolder = path.join(getAppDataPath(), APP_ID)
export const configPath = path.join(dataFolder, "config.json")
export const agentProfilesPath = path.join(dataFolder, "agent-profiles.json")

/**
 * Default configuration values (subset of full Config type)
 */
const DEFAULT_CONFIG = {
  onboardingCompleted: false,
  remoteServerEnabled: false,
  remoteServerPort: 3210,
  remoteServerBindAddress: "127.0.0.1",
  mainAgentName: "general-assistant",
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
  return `rsk_${crypto.randomBytes(24).toString("base64url")}`
}

/**
 * Load agent profiles from disk
 */
export function loadAgentProfiles(): { profiles: any[] } {
  try {
    if (fs.existsSync(agentProfilesPath)) {
      return JSON.parse(fs.readFileSync(agentProfilesPath, "utf8"))
    }
  } catch (error) {
    console.error("Error loading agent profiles:", error)
  }
  return { profiles: [] }
}

/**
 * Save agent profiles to disk
 */
export function saveAgentProfiles(data: { profiles: any[] }): void {
  fs.mkdirSync(dataFolder, { recursive: true })
  fs.writeFileSync(agentProfilesPath, JSON.stringify(data, null, 2))
}

/**
 * Add or update an agent profile
 */
export function upsertAgentProfile(profile: any): void {
  const data = loadAgentProfiles()
  const existingIndex = data.profiles.findIndex((p) => p.name === profile.name)
  
  if (existingIndex >= 0) {
    data.profiles[existingIndex] = { ...data.profiles[existingIndex], ...profile }
  } else {
    // Generate ID and timestamps for new profiles
    profile.id = profile.id || crypto.randomUUID()
    profile.createdAt = profile.createdAt || new Date().toISOString()
    profile.updatedAt = new Date().toISOString()
    data.profiles.push(profile)
  }
  
  saveAgentProfiles(data)
}

/**
 * Get an agent profile by name
 */
export function getAgentProfileByName(name: string): any | undefined {
  const data = loadAgentProfiles()
  return data.profiles.find((p) => p.name === name)
}

/**
 * List all agent profiles
 */
export function listAgentProfiles(): any[] {
  return loadAgentProfiles().profiles
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(configPath)
}

