import { app } from "electron"
import path from "path"
import fs from "fs"
import { Profile, ProfilesData, ProfileMcpServerConfig, ProfileModelConfig } from "@shared/types"
import { randomUUID } from "crypto"
import { logApp } from "./debug"

export const profilesPath = path.join(
  app.getPath("appData"),
  process.env.APP_ID,
  "profiles.json"
)

// Default profiles that come with the app
const DEFAULT_PROFILES: Profile[] = [
  {
    id: "default",
    name: "Default",
    guidelines: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isDefault: true,
  },
  {
    id: "git-profile",
    name: "Git & Version Control",
    guidelines: `CUSTOM GUIDELINES FOR GIT & VERSION CONTROL:
- Always check git status before making commits
- Write clear, descriptive commit messages following conventional commits format
- Review changes before committing
- Ask for confirmation before force pushing or rebasing
- Suggest creating feature branches for new work
- Remind about pulling latest changes before pushing

SAFETY RULES:
- Never force push to main/master branches
- Always create backups before destructive operations
- Verify remote repository before pushing
- Check for merge conflicts before merging`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "ai-coding-agent",
    name: "AI Coding Agent",
    guidelines: `CUSTOM GUIDELINES FOR AI CODING ASSISTANCE:
- Prioritize code quality and maintainability
- Follow existing code style and conventions
- Add comments for complex logic
- Suggest tests for new functionality
- Consider edge cases and error handling
- Recommend refactoring when appropriate

CODE REVIEW FOCUS:
- Check for potential bugs and security issues
- Verify proper error handling
- Ensure consistent naming conventions
- Look for opportunities to reduce code duplication
- Validate input parameters and return types`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
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

    // Return default profiles if file doesn't exist or there's an error
    this.profilesData = {
      profiles: DEFAULT_PROFILES,
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
    const newProfile: Profile = {
      id: randomUUID(),
      name,
      guidelines,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(systemPrompt !== undefined && { systemPrompt }),
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

    // Don't allow updating default profiles
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

    // Don't allow deleting default profiles
    if (profile.isDefault) {
      throw new Error("Cannot delete default profiles")
    }

    // If deleting the current profile, switch to default
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
  saveCurrentMcpStateToProfile(id: string, disabledServers: string[], disabledTools: string[]): Profile {
    return this.updateProfileMcpConfig(id, {
      disabledServers,
      disabledTools,
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

    // Create a clean export without the id (will be regenerated on import)
    const exportData: { name: string; guidelines: string; systemPrompt?: string } = {
      name: profile.name,
      guidelines: profile.guidelines,
    }

    // Include systemPrompt if it exists
    if (profile.systemPrompt) {
      exportData.systemPrompt = profile.systemPrompt
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

      return this.createProfile(
        importData.name,
        importData.guidelines || "",
        importData.systemPrompt
      )
    } catch (error) {
      throw new Error(`Failed to import profile: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  resetToDefaults(): void {
    this.profilesData = {
      profiles: DEFAULT_PROFILES,
      currentProfileId: "default",
    }
    this.saveProfiles()
  }
}

export const profileService = new ProfileService()

