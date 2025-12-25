import { app } from "electron"
import path from "path"
import fs from "fs"
import { Profile, ProfilesData, ProfileMcpServerConfig, ProfileModelConfig } from "@shared/types"
import { randomUUID } from "crypto"
import { logApp } from "./debug"
import { configStore } from "./config"
import { getBuiltinToolNames } from "./builtin-tool-definitions"

const RESERVED_SERVER_NAMES = ["speakmcp-settings"]

export const profilesPath = path.join(
  app.getPath("appData"),
  process.env.APP_ID,
  "profiles.json"
)

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
      logApp("Error loading profiles:", error)
    }

    // For new installs, initialize the default profile with all MCPs disabled
    // This aligns with createProfile() behavior - users opt-in to what they need
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    // Also disable all builtin tools by default - users must opt-in
    const builtinToolNames = getBuiltinToolNames()

    const defaultProfileWithMcpConfig: Profile = {
      ...DEFAULT_PROFILES[0],
      mcpServerConfig: {
        disabledServers: allServerNames,
        disabledTools: builtinToolNames,
        // Flag ensures newly-added servers are also disabled by default
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
      fs.mkdirSync(dataFolder, { recursive: true })
      fs.writeFileSync(profilesPath, JSON.stringify(this.profilesData, null, 2))
    } catch (error) {
      logApp("Error saving profiles:", error)
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
    // Get all configured MCP server names to disable them by default
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    // Also disable all builtin tools by default - users must opt-in
    const builtinToolNames = getBuiltinToolNames()

    const newProfile: Profile = {
      id: randomUUID(),
      name,
      guidelines,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(systemPrompt !== undefined && { systemPrompt }),
      // New profiles have all MCPs disabled by default
      // Users can enable specific MCPs as needed
      mcpServerConfig: {
        disabledServers: allServerNames,
        disabledTools: builtinToolNames,
        // Flag ensures newly-added servers are also disabled by default
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

    // Merge with existing config - only update fields that are explicitly provided
    // Use ?? {} to handle undefined profile.mcpServerConfig for profiles without prior config
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
   * This allows saving the current enabled/disabled server state to a profile
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

    // Merge with existing config - only update fields that are explicitly provided
    // Use ?? {} to handle undefined profile.modelConfig for profiles without prior config
    const mergedModelConfig: ProfileModelConfig = {
      ...(profile.modelConfig ?? {}),
      // Agent/MCP Tools settings
      ...(modelConfig.mcpToolsProviderId !== undefined && { mcpToolsProviderId: modelConfig.mcpToolsProviderId }),
      ...(modelConfig.mcpToolsOpenaiModel !== undefined && { mcpToolsOpenaiModel: modelConfig.mcpToolsOpenaiModel }),
      ...(modelConfig.mcpToolsGroqModel !== undefined && { mcpToolsGroqModel: modelConfig.mcpToolsGroqModel }),
      ...(modelConfig.mcpToolsGeminiModel !== undefined && { mcpToolsGeminiModel: modelConfig.mcpToolsGeminiModel }),
      ...(modelConfig.currentModelPresetId !== undefined && { currentModelPresetId: modelConfig.currentModelPresetId }),
      // STT Provider settings
      ...(modelConfig.sttProviderId !== undefined && { sttProviderId: modelConfig.sttProviderId }),
      // Transcript Post-Processing settings
      ...(modelConfig.transcriptPostProcessingProviderId !== undefined && { transcriptPostProcessingProviderId: modelConfig.transcriptPostProcessingProviderId }),
      ...(modelConfig.transcriptPostProcessingOpenaiModel !== undefined && { transcriptPostProcessingOpenaiModel: modelConfig.transcriptPostProcessingOpenaiModel }),
      ...(modelConfig.transcriptPostProcessingGroqModel !== undefined && { transcriptPostProcessingGroqModel: modelConfig.transcriptPostProcessingGroqModel }),
      ...(modelConfig.transcriptPostProcessingGeminiModel !== undefined && { transcriptPostProcessingGeminiModel: modelConfig.transcriptPostProcessingGeminiModel }),
      // TTS Provider settings
      ...(modelConfig.ttsProviderId !== undefined && { ttsProviderId: modelConfig.ttsProviderId }),
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
   * This allows saving the current provider/model selection to a profile
   */
  saveCurrentModelStateToProfile(
    id: string,
    modelConfig: ProfileModelConfig
  ): Profile {
    return this.updateProfileModelConfig(id, modelConfig)
  }

  exportProfile(id: string): string {
    const profile = this.getProfile(id)
    if (!profile) {
      throw new Error(`Profile with id ${id} not found`)
    }

    // Create a comprehensive export with all profile settings and enabled MCP servers
    const exportData: any = {
      version: 1, // For future compatibility
      name: profile.name,
      guidelines: profile.guidelines,
    }

    // Include systemPrompt if it exists
    if (profile.systemPrompt) {
      exportData.systemPrompt = profile.systemPrompt
    }

    // Include MCP server configuration if it exists
    if (profile.mcpServerConfig) {
      exportData.mcpServerConfig = profile.mcpServerConfig
    }

    // Include model configuration if it exists
    if (profile.modelConfig) {
      exportData.modelConfig = profile.modelConfig
    }

    // Include actual MCP server definitions for enabled servers
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    if (mcpConfig && mcpConfig.mcpServers && profile.mcpServerConfig) {
      const enabledServers: Record<string, any> = {}

      // Determine which servers are enabled based on the profile's configuration
      const allServerNames = Object.keys(mcpConfig.mcpServers)
      const disabledServers = profile.mcpServerConfig.disabledServers || []
      const explicitlyEnabledServers = profile.mcpServerConfig.enabledServers || []
      const allServersDisabledByDefault = profile.mcpServerConfig.allServersDisabledByDefault || false

      // Logic to determine enabled servers:
      // If allServersDisabledByDefault is true, only enabledServers are enabled
      // Otherwise, all servers except those in disabledServers are enabled
      let serversToExport: string[]
      if (allServersDisabledByDefault) {
        serversToExport = explicitlyEnabledServers
      } else {
        serversToExport = allServerNames.filter(name => !disabledServers.includes(name))
      }

      // Export the definitions of enabled servers
      for (const serverName of serversToExport) {
        if (mcpConfig.mcpServers[serverName]) {
          const serverConfig = mcpConfig.mcpServers[serverName]
          // Strip sensitive fields that may contain API keys/secrets
          const { env, headers, ...sanitizedConfig } = serverConfig
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

      // Guidelines can be empty string for imports (backwards compatible)
      if (importData.guidelines !== undefined && typeof importData.guidelines !== "string") {
        throw new Error("Invalid profile data: guidelines must be a string")
      }

      // SystemPrompt is optional
      if (importData.systemPrompt !== undefined && typeof importData.systemPrompt !== "string") {
        throw new Error("Invalid profile data: systemPrompt must be a string")
      }

      // Create the basic profile
      const newProfile = this.createProfile(
        importData.name,
        importData.guidelines || "",
        importData.systemPrompt
      )

      // Import MCP server definitions if present
      if (importData.mcpServers && typeof importData.mcpServers === "object") {
        const config = configStore.get()
        const currentMcpServers = config.mcpConfig?.mcpServers || {}

        // Merge imported servers with existing ones (don't overwrite existing servers)
        const mergedServers = { ...currentMcpServers }
        let newServersAdded = 0

        for (const [serverName, serverConfig] of Object.entries(importData.mcpServers)) {
          // Validate against prototype pollution attacks
          if (serverName === "__proto__" || serverName === "constructor" || serverName === "prototype") {
            logApp(`Skipping dangerous server name: ${serverName}`)
            continue
          }

          // Validate against reserved names (case-insensitive)
          if (RESERVED_SERVER_NAMES.some(reserved => reserved.toLowerCase() === serverName.toLowerCase())) {
            logApp(`Skipping reserved server name: ${serverName}`)
            continue
          }

          if (!mergedServers[serverName]) {
            mergedServers[serverName] = serverConfig
            newServersAdded++
          }
        }

        // Update config with merged servers
        if (newServersAdded > 0) {
          configStore.save({
            ...config,
            mcpConfig: {
              ...config.mcpConfig,
              mcpServers: mergedServers,
            },
          })
          logApp(`Imported ${newServersAdded} new MCP server(s)`)
        }
      }

      // Apply MCP server configuration if present
      if (importData.mcpServerConfig && typeof importData.mcpServerConfig === "object") {
        this.updateProfileMcpConfig(newProfile.id, importData.mcpServerConfig)
      }

      // Apply model configuration if present
      if (importData.modelConfig && typeof importData.modelConfig === "object") {
        this.updateProfileModelConfig(newProfile.id, importData.modelConfig)
      }

      // Return the updated profile
      return this.getProfile(newProfile.id)!
    } catch (error) {
      throw new Error(`Failed to import profile: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  resetToDefaults(): void {
    // Reset to defaults with all MCPs disabled, consistent with createProfile() and first run behavior
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
    // Also disable all builtin tools by default - users must opt-in
    const builtinToolNames = getBuiltinToolNames()

    const defaultProfileWithMcpConfig: Profile = {
      ...DEFAULT_PROFILES[0],
      mcpServerConfig: {
        disabledServers: allServerNames,
        disabledTools: builtinToolNames,
        // Flag ensures newly-added servers are also disabled by default
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

