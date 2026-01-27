import path from "path"
import fs from "fs"
import { randomUUID } from "crypto"
import { getProfilesFolder, ensureDir, configStore } from "../config"
import type { Profile, ProfilesData, ProfileMcpServerConfig, ProfileModelConfig, ProfileSkillsConfig } from "../types"

// MCPServerConfig type for import/export (simplified from shared types)
interface MCPServerConfig {
  transport?: "stdio" | "websocket" | "streamableHttp"
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  timeout?: number
  disabled?: boolean
  oauth?: Record<string, unknown>
}

const RESERVED_SERVER_NAMES = ["speakmcp-settings"]

// Valid provider IDs that are supported by the application
const VALID_PROVIDER_IDS = ["openai", "groq", "gemini"]
// STT only supports openai and groq (no gemini support for STT)
const VALID_STT_PROVIDER_IDS = ["openai", "groq"]

/**
 * Get builtin tool names - stub for server package
 * In the full implementation, this would come from builtin-tools.ts
 */
function getBuiltinToolNames(): string[] {
  // Return empty array - server package doesn't have builtin tools yet
  return []
}

/**
 * Simple logging function for profile service
 */
function logProfile(...args: unknown[]) {
  console.log("[ProfileService]", ...args)
}

/**
 * Validates the shape of an imported MCP server config
 * Returns true if the config has a valid structure, false otherwise
 */
function isValidServerConfig(config: unknown): boolean {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return false
  }

  const c = config as Record<string, unknown>

  // Validate transport if provided
  if (
    c.transport !== undefined &&
    (typeof c.transport !== "string" ||
      !["stdio", "websocket", "streamableHttp"].includes(c.transport))
  ) {
    return false
  }

  // Validate command/args for stdio transport
  if (c.command !== undefined && typeof c.command !== "string") {
    return false
  }
  if (c.args !== undefined) {
    if (!Array.isArray(c.args) || !c.args.every((arg) => typeof arg === "string")) {
      return false
    }
  }

  // Validate url for remote transports
  if (c.url !== undefined && typeof c.url !== "string") {
    return false
  }

  // Validate transport-specific required fields to prevent configs that break MCP initialization
  const transport = c.transport as string | undefined
  if (transport === "stdio" && !c.command) {
    return false
  }
  if ((transport === "websocket" || transport === "streamableHttp") && !c.url) {
    return false
  }
  if (transport === undefined && !c.command && !c.url) {
    return false
  }

  // Validate env if provided (must be Record<string, string>)
  if (c.env !== undefined) {
    if (typeof c.env !== "object" || c.env === null || Array.isArray(c.env)) {
      return false
    }
    const env = c.env as Record<string, unknown>
    if (!Object.values(env).every((val) => typeof val === "string")) {
      return false
    }
  }

  // Validate headers if provided (must be Record<string, string>)
  if (c.headers !== undefined) {
    if (typeof c.headers !== "object" || c.headers === null || Array.isArray(c.headers)) {
      return false
    }
    const headers = c.headers as Record<string, unknown>
    if (!Object.values(headers).every((val) => typeof val === "string")) {
      return false
    }
  }

  // Validate timeout if provided (must be a number)
  if (c.timeout !== undefined && typeof c.timeout !== "number") {
    return false
  }

  // Validate disabled if provided (must be a boolean)
  if (c.disabled !== undefined && typeof c.disabled !== "boolean") {
    return false
  }

  // Validate oauth if provided (must be an object with expected structure)
  if (c.oauth !== undefined) {
    if (typeof c.oauth !== "object" || c.oauth === null || Array.isArray(c.oauth)) {
      return false
    }
    const oauth = c.oauth as Record<string, unknown>
    if (oauth.clientId !== undefined && typeof oauth.clientId !== "string") {
      return false
    }
    if (oauth.clientSecret !== undefined && typeof oauth.clientSecret !== "string") {
      return false
    }
    if (oauth.scope !== undefined && typeof oauth.scope !== "string") {
      return false
    }
    if (oauth.redirectUri !== undefined && typeof oauth.redirectUri !== "string") {
      return false
    }
    if (oauth.useDiscovery !== undefined && typeof oauth.useDiscovery !== "boolean") {
      return false
    }
    if (oauth.useDynamicRegistration !== undefined && typeof oauth.useDynamicRegistration !== "boolean") {
      return false
    }
    if (oauth.serverMetadata !== undefined) {
      if (typeof oauth.serverMetadata !== "object" || oauth.serverMetadata === null || Array.isArray(oauth.serverMetadata)) {
        return false
      }
      const serverMetadata = oauth.serverMetadata as Record<string, unknown>
      if (serverMetadata.authorization_endpoint !== undefined && typeof serverMetadata.authorization_endpoint !== "string") {
        return false
      }
      if (serverMetadata.token_endpoint !== undefined && typeof serverMetadata.token_endpoint !== "string") {
        return false
      }
      if (serverMetadata.issuer !== undefined && typeof serverMetadata.issuer !== "string") {
        return false
      }
    }
  }

  return true
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isValidMcpServerConfig(config: unknown): config is Partial<ProfileMcpServerConfig> {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return false
  }

  const c = config as Record<string, unknown>

  if (c.disabledServers !== undefined && !isStringArray(c.disabledServers)) {
    return false
  }

  if (c.disabledTools !== undefined && !isStringArray(c.disabledTools)) {
    return false
  }

  if (c.enabledServers !== undefined && !isStringArray(c.enabledServers)) {
    return false
  }

  if (c.allServersDisabledByDefault !== undefined && typeof c.allServersDisabledByDefault !== "boolean") {
    return false
  }

  return true
}

/**
 * Validates the shape of an imported model config
 * Returns true if the config has a valid structure, false otherwise
 */
function isValidModelConfig(config: unknown): boolean {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return false
  }

  const c = config as Record<string, unknown>

  const providerIdFields = [
    "mcpToolsProviderId",
    "transcriptPostProcessingProviderId",
    "ttsProviderId",
  ]

  for (const field of providerIdFields) {
    if (c[field] !== undefined) {
      if (typeof c[field] !== "string" || !VALID_PROVIDER_IDS.includes(c[field] as string)) {
        return false
      }
    }
  }

  if (c.sttProviderId !== undefined) {
    if (typeof c.sttProviderId !== "string" || !VALID_STT_PROVIDER_IDS.includes(c.sttProviderId as string)) {
      return false
    }
  }

  const stringFields = [
    "mcpToolsOpenaiModel",
    "mcpToolsGroqModel",
    "mcpToolsGeminiModel",
    "currentModelPresetId",
    "transcriptPostProcessingOpenaiModel",
    "transcriptPostProcessingGroqModel",
    "transcriptPostProcessingGeminiModel",
  ]

  for (const field of stringFields) {
    if (c[field] !== undefined && typeof c[field] !== "string") {
      return false
    }
  }

  return true
}

/**
 * Validates the shape of an imported skills config
 * Returns true if the config has a valid structure, false otherwise
 */
function isValidSkillsConfig(config: unknown): config is Partial<ProfileSkillsConfig> {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return false
  }

  const c = config as Record<string, unknown>

  if (c.enabledSkillIds !== undefined && !isStringArray(c.enabledSkillIds)) {
    return false
  }

  if (c.allSkillsDisabledByDefault !== undefined && typeof c.allSkillsDisabledByDefault !== "boolean") {
    return false
  }

  return true
}

// Get profiles file path using the new path utilities
const profilesDir = getProfilesFolder()
export const profilesPath = path.join(path.dirname(profilesDir), "profiles.json")

const DEFAULT_PROFILES: Profile[] = [
  {
    id: "default",
    name: "Default",
    guidelines: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isDefault: true,
  },
]

class ProfileService {
  private profilesData: ProfilesData | undefined

  constructor() {
    this.loadProfiles()
  }

  private loadProfiles(): ProfilesData {
    try {
      if (fs.existsSync(profilesPath)) {
        const data = JSON.parse(fs.readFileSync(profilesPath, "utf8")) as ProfilesData
        this.profilesData = data
        return data
      }
    } catch (error) {
      logProfile("Error loading profiles:", error)
    }

    // For new installs, initialize the default profile with all MCPs disabled
    const config = configStore.get()
    const mcpConfig = config.mcpConfig as { mcpServers?: Record<string, unknown> } | undefined
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    const builtinToolNames = getBuiltinToolNames()

    const defaultProfileWithMcpConfig: Profile = {
      ...DEFAULT_PROFILES[0],
      mcpServerConfig: {
        disabledServers: allServerNames,
        disabledTools: builtinToolNames,
        allServersDisabledByDefault: true,
      },
    }

    this.profilesData = {
      profiles: [defaultProfileWithMcpConfig],
      currentProfileId: "default",
    }
    this.saveProfiles()
    return this.profilesData
  }

  private saveProfiles(): void {
    if (!this.profilesData) return

    try {
      const dataFolder = path.dirname(profilesPath)
      ensureDir(dataFolder)
      fs.writeFileSync(profilesPath, JSON.stringify(this.profilesData, null, 2))
    } catch (error) {
      logProfile("Error saving profiles:", error)
      throw new Error(`Failed to save profiles: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getProfiles(): Profile[] {
    if (!this.profilesData) {
      this.loadProfiles()
    }
    return this.profilesData?.profiles || []
  }

  getProfile(id: string): Profile | undefined {
    return this.getProfiles().find((p) => p.id === id)
  }

  getCurrentProfile(): Profile | undefined {
    if (!this.profilesData) {
      this.loadProfiles()
    }
    const currentId = this.profilesData?.currentProfileId
    if (currentId) {
      return this.getProfile(currentId)
    }
    return undefined
  }

  createProfile(name: string, guidelines: string, systemPrompt?: string): Profile {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig as { mcpServers?: Record<string, unknown> } | undefined
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    const builtinToolNames = getBuiltinToolNames()

    const newProfile: Profile = {
      id: randomUUID(),
      name,
      guidelines,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(systemPrompt !== undefined && { systemPrompt }),
      mcpServerConfig: {
        disabledServers: allServerNames,
        disabledTools: builtinToolNames,
        allServersDisabledByDefault: true,
      },
    }

    if (!this.profilesData) {
      this.loadProfiles()
    }

    this.profilesData!.profiles.push(newProfile)
    this.saveProfiles()
    return newProfile
  }

  updateProfile(id: string, updates: Partial<Pick<Profile, "name" | "guidelines" | "systemPrompt">>): Profile {
    if (!this.profilesData) {
      this.loadProfiles()
    }

    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    if (profile.isDefault) {
      throw new Error("Cannot update default profiles")
    }

    const updatedProfile = {
      ...profile,
      ...updates,
      updatedAt: Date.now(),
    }

    const index = this.profilesData!.profiles.findIndex((p) => p.id === id)
    this.profilesData!.profiles[index] = updatedProfile
    this.saveProfiles()
    return updatedProfile
  }

  deleteProfile(id: string): boolean {
    if (!this.profilesData) {
      this.loadProfiles()
    }

    const profile = this.getProfile(id)
    if (!profile) {
      return false
    }

    if (profile.isDefault) {
      throw new Error("Cannot delete default profiles")
    }

    if (this.profilesData!.currentProfileId === id) {
      this.profilesData!.currentProfileId = "default"
    }

    this.profilesData!.profiles = this.profilesData!.profiles.filter((p) => p.id !== id)
    this.saveProfiles()
    return true
  }

  setCurrentProfile(id: string): Profile {
    if (!this.profilesData) {
      this.loadProfiles()
    }

    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    this.profilesData!.currentProfileId = id
    this.saveProfiles()
    return profile
  }

  /**
   * Update the MCP server configuration for a profile
   * Merges with existing config - only provided fields are updated
   */
  updateProfileMcpConfig(id: string, mcpServerConfig: Partial<ProfileMcpServerConfig>): Profile {
    if (!this.profilesData) {
      this.loadProfiles()
    }

    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    const mergedMcpServerConfig: ProfileMcpServerConfig = {
      ...(profile.mcpServerConfig ?? {}),
      ...(mcpServerConfig.disabledServers !== undefined && { disabledServers: mcpServerConfig.disabledServers }),
      ...(mcpServerConfig.disabledTools !== undefined && { disabledTools: mcpServerConfig.disabledTools }),
      ...(mcpServerConfig.allServersDisabledByDefault !== undefined && { allServersDisabledByDefault: mcpServerConfig.allServersDisabledByDefault }),
      ...(mcpServerConfig.enabledServers !== undefined && { enabledServers: mcpServerConfig.enabledServers }),
    }

    const updatedProfile = {
      ...profile,
      mcpServerConfig: mergedMcpServerConfig,
      updatedAt: Date.now(),
    }

    const index = this.profilesData!.profiles.findIndex((p) => p.id === id)
    this.profilesData!.profiles[index] = updatedProfile
    this.saveProfiles()
    return updatedProfile
  }

  /**
   * Save current MCP state to a profile
   */
  saveCurrentMcpStateToProfile(id: string, disabledServers: string[], disabledTools: string[], enabledServers?: string[]): Profile {
    return this.updateProfileMcpConfig(id, {
      disabledServers,
      disabledTools,
      ...(enabledServers !== undefined && { enabledServers }),
    })
  }

  /**
   * Update the model configuration for a profile
   * Merges with existing config - only provided fields are updated
   */
  updateProfileModelConfig(id: string, modelConfig: Partial<ProfileModelConfig>): Profile {
    if (!this.profilesData) {
      this.loadProfiles()
    }

    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    const mergedModelConfig: ProfileModelConfig = {
      ...(profile.modelConfig ?? {}),
      ...(modelConfig.mcpToolsProviderId !== undefined && { mcpToolsProviderId: modelConfig.mcpToolsProviderId }),
      ...(modelConfig.mcpToolsOpenaiModel !== undefined && { mcpToolsOpenaiModel: modelConfig.mcpToolsOpenaiModel }),
      ...(modelConfig.mcpToolsGroqModel !== undefined && { mcpToolsGroqModel: modelConfig.mcpToolsGroqModel }),
      ...(modelConfig.mcpToolsGeminiModel !== undefined && { mcpToolsGeminiModel: modelConfig.mcpToolsGeminiModel }),
      ...(modelConfig.currentModelPresetId !== undefined && { currentModelPresetId: modelConfig.currentModelPresetId }),
    }

    const updatedProfile = {
      ...profile,
      modelConfig: mergedModelConfig,
      updatedAt: Date.now(),
    }

    const index = this.profilesData!.profiles.findIndex((p) => p.id === id)
    this.profilesData!.profiles[index] = updatedProfile
    this.saveProfiles()
    return updatedProfile
  }

  /**
   * Save current model state to a profile
   */
  saveCurrentModelStateToProfile(id: string, modelConfig: ProfileModelConfig): Profile {
    return this.updateProfileModelConfig(id, modelConfig)
  }

  /**
   * Update the skills configuration for a profile
   * Merges with existing config - only provided fields are updated
   */
  updateProfileSkillsConfig(id: string, skillsConfig: Partial<ProfileSkillsConfig>): Profile {
    if (!this.profilesData) {
      this.loadProfiles()
    }

    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    const mergedSkillsConfig: ProfileSkillsConfig = {
      ...(profile.skillsConfig ?? {}),
      ...(skillsConfig.enabledSkills !== undefined && { enabledSkills: skillsConfig.enabledSkills }),
      ...(skillsConfig.disabledSkills !== undefined && { disabledSkills: skillsConfig.disabledSkills }),
    }

    const updatedProfile = {
      ...profile,
      skillsConfig: mergedSkillsConfig,
      updatedAt: Date.now(),
    }

    const index = this.profilesData!.profiles.findIndex((p) => p.id === id)
    this.profilesData!.profiles[index] = updatedProfile
    this.saveProfiles()
    return updatedProfile
  }

  /**
   * Toggle a skill's enabled state for a specific profile
   */
  toggleProfileSkill(profileId: string, skillId: string): Profile {
    const profile = this.getProfile(profileId)
    if (!profile) {
      throw new Error(`Profile with id ${profileId} not found`)
    }

    const currentEnabledSkills = profile.skillsConfig?.enabledSkills ?? []
    const isCurrentlyEnabled = currentEnabledSkills.includes(skillId)

    const newEnabledSkills = isCurrentlyEnabled
      ? currentEnabledSkills.filter(id => id !== skillId)
      : [...currentEnabledSkills, skillId]

    return this.updateProfileSkillsConfig(profileId, {
      enabledSkills: newEnabledSkills,
    })
  }

  /**
   * Check if a skill is enabled for a specific profile
   */
  isSkillEnabledForProfile(profileId: string, skillId: string): boolean {
    const profile = this.getProfile(profileId)
    if (!profile) {
      return false
    }

    const enabledSkills = profile.skillsConfig?.enabledSkills ?? []
    return enabledSkills.includes(skillId)
  }

  /**
   * Get all enabled skill IDs for a profile
   */
  getEnabledSkillIdsForProfile(profileId: string): string[] {
    const profile = this.getProfile(profileId)
    if (!profile) {
      return []
    }
    return profile.skillsConfig?.enabledSkills ?? []
  }

  /**
   * Enable a skill for the current profile (used when installing new skills)
   */
  enableSkillForCurrentProfile(skillId: string): Profile | undefined {
    const currentProfile = this.getCurrentProfile()
    if (!currentProfile) {
      return undefined
    }

    const currentEnabledSkills = currentProfile.skillsConfig?.enabledSkills ?? []

    if (currentEnabledSkills.includes(skillId)) {
      return currentProfile
    }

    return this.updateProfileSkillsConfig(currentProfile.id, {
      enabledSkills: [...currentEnabledSkills, skillId],
    })
  }

  exportProfile(id: string): string {
    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    const exportData: Record<string, unknown> = {
      version: 1,
      name: profile.name,
      guidelines: profile.guidelines,
    }

    if (profile.systemPrompt) {
      exportData.systemPrompt = profile.systemPrompt
    }

    if (profile.mcpServerConfig) {
      exportData.mcpServerConfig = profile.mcpServerConfig
    }

    if (profile.modelConfig) {
      exportData.modelConfig = profile.modelConfig
    }

    if (profile.skillsConfig) {
      exportData.skillsConfig = profile.skillsConfig
    }

    const config = configStore.get()
    const mcpConfig = config.mcpConfig as { mcpServers?: Record<string, MCPServerConfig> } | undefined
    if (mcpConfig && mcpConfig.mcpServers) {
      const enabledServers: Record<string, unknown> = {}
      const allServerNames = Object.keys(mcpConfig.mcpServers)

      let serversToExport: string[]
      if (profile.mcpServerConfig) {
        const disabledServers = profile.mcpServerConfig.disabledServers || []
        const explicitlyEnabledServers = profile.mcpServerConfig.enabledServers || []
        const allServersDisabledByDefault = profile.mcpServerConfig.allServersDisabledByDefault || false

        if (allServersDisabledByDefault) {
          serversToExport = explicitlyEnabledServers
        } else {
          serversToExport = allServerNames.filter(name => !disabledServers.includes(name))
        }
      } else {
        serversToExport = allServerNames
      }

      for (const serverName of serversToExport) {
        if (mcpConfig.mcpServers[serverName]) {
          const serverConfig = mcpConfig.mcpServers[serverName]
          const { env, headers, oauth, ...sanitizedConfig } = serverConfig
          enabledServers[serverName] = sanitizedConfig
        }
      }

      if (Object.keys(enabledServers).length > 0) {
        exportData.mcpServers = enabledServers
      }
    }

    return JSON.stringify(exportData, null, 2)
  }

  importProfile(profileJson: string): Profile {
    try {
      const importData = JSON.parse(profileJson)

      if (!importData.name || typeof importData.name !== "string") {
        throw new Error("Invalid profile data: missing or invalid name")
      }

      if (importData.guidelines !== undefined && typeof importData.guidelines !== "string") {
        throw new Error("Invalid profile data: guidelines must be a string")
      }

      if (importData.systemPrompt !== undefined && typeof importData.systemPrompt !== "string") {
        throw new Error("Invalid profile data: systemPrompt must be a string")
      }

      const newProfile = this.createProfile(
        importData.name,
        importData.guidelines || "",
        importData.systemPrompt
      )

      const importedServerNames: string[] = []
      if (importData.mcpServers && typeof importData.mcpServers === "object" && !Array.isArray(importData.mcpServers)) {
        const config = configStore.get()
        const mcpConfig = config.mcpConfig as { mcpServers?: Record<string, MCPServerConfig> } | undefined
        const currentMcpServers = mcpConfig?.mcpServers || {}

        const mergedServers = { ...currentMcpServers }
        let newServersAdded = 0

        for (const [serverName, serverConfig] of Object.entries(importData.mcpServers)) {
          const normalizedServerName = serverName.trim()

          if (!normalizedServerName) {
            logProfile(`Skipping empty server name: "${serverName}"`)
            continue
          }

          if (normalizedServerName === "__proto__" || normalizedServerName === "constructor" || normalizedServerName === "prototype") {
            logProfile(`Skipping dangerous server name: ${serverName}`)
            continue
          }

          if (RESERVED_SERVER_NAMES.some(reserved => reserved.toLowerCase() === normalizedServerName.toLowerCase())) {
            logProfile(`Skipping reserved server name: ${serverName}`)
            continue
          }

          if (!mergedServers[normalizedServerName]) {
            if (!isValidServerConfig(serverConfig)) {
              logProfile(`Skipping server "${serverName}" with invalid configuration`)
              continue
            }
            mergedServers[normalizedServerName] = serverConfig as MCPServerConfig
            importedServerNames.push(normalizedServerName)
            newServersAdded++
          }
        }

        if (newServersAdded > 0) {
          configStore.save({
            ...config,
            mcpConfig: {
              ...mcpConfig,
              mcpServers: mergedServers,
            },
          })
          logProfile(`Imported ${newServersAdded} new MCP server(s)`)
        }
      }

      if (importData.mcpServerConfig && typeof importData.mcpServerConfig === "object") {
        if (isValidMcpServerConfig(importData.mcpServerConfig)) {
          this.updateProfileMcpConfig(newProfile.id, importData.mcpServerConfig)
        } else {
          logProfile("Warning: Invalid mcpServerConfig format in import data, skipping")
        }
      } else if (importedServerNames.length > 0) {
        const currentProfile = this.getProfile(newProfile.id)
        if (currentProfile?.mcpServerConfig) {
          const currentEnabledServers = currentProfile.mcpServerConfig.enabledServers || []
          this.updateProfileMcpConfig(newProfile.id, {
            enabledServers: Array.from(new Set([...currentEnabledServers, ...importedServerNames])),
          })
          logProfile(`Enabled ${importedServerNames.length} imported server(s) for legacy import`)
        }
      }

      if (importData.modelConfig && typeof importData.modelConfig === "object") {
        if (isValidModelConfig(importData.modelConfig)) {
          this.updateProfileModelConfig(newProfile.id, importData.modelConfig)
        } else {
          logProfile("Warning: Invalid modelConfig format in import data, skipping")
        }
      }

      if (importData.skillsConfig && typeof importData.skillsConfig === "object") {
        if (isValidSkillsConfig(importData.skillsConfig)) {
          this.updateProfileSkillsConfig(newProfile.id, importData.skillsConfig)
        } else {
          logProfile("Warning: Invalid skillsConfig format in import data, skipping")
        }
      }

      return this.getProfile(newProfile.id)!
    } catch (error) {
      throw new Error(`Failed to import profile: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  resetToDefaults(): void {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig as { mcpServers?: Record<string, unknown> } | undefined
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    const builtinToolNames = getBuiltinToolNames()

    const defaultProfileWithMcpConfig: Profile = {
      ...DEFAULT_PROFILES[0],
      mcpServerConfig: {
        disabledServers: allServerNames,
        disabledTools: builtinToolNames,
        allServersDisabledByDefault: true,
      },
    }

    this.profilesData = {
      profiles: [defaultProfileWithMcpConfig],
      currentProfileId: "default",
    }
    this.saveProfiles()
  }
}

export const profileService = new ProfileService()

