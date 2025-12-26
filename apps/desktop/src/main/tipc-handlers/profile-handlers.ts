import fs from "fs"
import { tipc } from "@egoist/tipc/main"
import { dialog } from "electron"
import { profileService } from "../profile-service"
import { configStore } from "../config"
import { mcpService } from "../mcp-service"

const t = tipc.create()

export const profileHandlers = {
  // Profile Management
  getProfiles: t.procedure.action(async () => {
    return profileService.getProfiles()
  }),

  getProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return profileService.getProfile(input.id)
    }),

  getCurrentProfile: t.procedure.action(async () => {
    return profileService.getCurrentProfile()
  }),

  // Get the default system prompt for restore functionality
  getDefaultSystemPrompt: t.procedure.action(async () => {
    const { DEFAULT_SYSTEM_PROMPT } = await import("../system-prompts")
    return DEFAULT_SYSTEM_PROMPT
  }),

  createProfile: t.procedure
    .input<{ name: string; guidelines: string; systemPrompt?: string }>()
    .action(async ({ input }) => {
        return profileService.createProfile(input.name, input.guidelines, input.systemPrompt)
    }),

  updateProfile: t.procedure
    .input<{ id: string; name?: string; guidelines?: string; systemPrompt?: string }>()
    .action(async ({ input }) => {
        const updates: any = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.guidelines !== undefined) updates.guidelines = input.guidelines
      if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt
      const updatedProfile = profileService.updateProfile(input.id, updates)

      // If the updated profile is the current profile, sync guidelines to live config
      const currentProfile = profileService.getCurrentProfile()
      if (currentProfile && currentProfile.id === input.id && input.guidelines !== undefined) {
        const config = configStore.get()
        configStore.save({
          ...config,
          mcpToolsSystemPrompt: input.guidelines,
        })
      }

      return updatedProfile
    }),

  deleteProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return profileService.deleteProfile(input.id)
    }),

  setCurrentProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        const profile = profileService.setCurrentProfile(input.id)

      // Update the config with the profile's guidelines, system prompt, and model config
      const config = configStore.get()
      const updatedConfig = {
        ...config,
        mcpToolsSystemPrompt: profile.guidelines,
        mcpCurrentProfileId: profile.id,
        // Apply custom system prompt if it exists, otherwise clear it to use default
        mcpCustomSystemPrompt: profile.systemPrompt || "",
        // Apply model config if it exists
        // Agent/MCP Tools settings
        ...(profile.modelConfig?.mcpToolsProviderId && {
          mcpToolsProviderId: profile.modelConfig.mcpToolsProviderId,
        }),
        ...(profile.modelConfig?.mcpToolsOpenaiModel && {
          mcpToolsOpenaiModel: profile.modelConfig.mcpToolsOpenaiModel,
        }),
        ...(profile.modelConfig?.mcpToolsGroqModel && {
          mcpToolsGroqModel: profile.modelConfig.mcpToolsGroqModel,
        }),
        ...(profile.modelConfig?.mcpToolsGeminiModel && {
          mcpToolsGeminiModel: profile.modelConfig.mcpToolsGeminiModel,
        }),
        ...(profile.modelConfig?.currentModelPresetId && {
          currentModelPresetId: profile.modelConfig.currentModelPresetId,
        }),
        // STT Provider settings
        ...(profile.modelConfig?.sttProviderId && {
          sttProviderId: profile.modelConfig.sttProviderId,
        }),
        // Transcript Post-Processing settings
        ...(profile.modelConfig?.transcriptPostProcessingProviderId && {
          transcriptPostProcessingProviderId: profile.modelConfig.transcriptPostProcessingProviderId,
        }),
        ...(profile.modelConfig?.transcriptPostProcessingOpenaiModel && {
          transcriptPostProcessingOpenaiModel: profile.modelConfig.transcriptPostProcessingOpenaiModel,
        }),
        ...(profile.modelConfig?.transcriptPostProcessingGroqModel && {
          transcriptPostProcessingGroqModel: profile.modelConfig.transcriptPostProcessingGroqModel,
        }),
        ...(profile.modelConfig?.transcriptPostProcessingGeminiModel && {
          transcriptPostProcessingGeminiModel: profile.modelConfig.transcriptPostProcessingGeminiModel,
        }),
        // TTS Provider settings
        ...(profile.modelConfig?.ttsProviderId && {
          ttsProviderId: profile.modelConfig.ttsProviderId,
        }),
      }
      configStore.save(updatedConfig)

      // Apply the profile's MCP server configuration
      // If the profile has no mcpServerConfig, we pass empty arrays to reset to default (all enabled)
      mcpService.applyProfileMcpConfig(
        profile.mcpServerConfig?.disabledServers ?? [],
        profile.mcpServerConfig?.disabledTools ?? [],
        profile.mcpServerConfig?.allServersDisabledByDefault ?? false,
        profile.mcpServerConfig?.enabledServers ?? []
      )

      return profile
    }),

  exportProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return profileService.exportProfile(input.id)
    }),

  importProfile: t.procedure
    .input<{ profileJson: string }>()
    .action(async ({ input }) => {
        return profileService.importProfile(input.profileJson)
    }),

  // Save current MCP server state to a profile
  saveCurrentMcpStateToProfile: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {

      const currentState = mcpService.getCurrentMcpConfigState()
      return profileService.saveCurrentMcpStateToProfile(
        input.profileId,
        currentState.disabledServers,
        currentState.disabledTools,
        currentState.enabledServers
      )
    }),

  // Update profile MCP server configuration
  updateProfileMcpConfig: t.procedure
    .input<{ profileId: string; disabledServers?: string[]; disabledTools?: string[]; enabledServers?: string[] }>()
    .action(async ({ input }) => {
        return profileService.updateProfileMcpConfig(input.profileId, {
        disabledServers: input.disabledServers,
        disabledTools: input.disabledTools,
        enabledServers: input.enabledServers,
      })
    }),

  // Save current model state to a profile
  saveCurrentModelStateToProfile: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
        const config = configStore.get()
      return profileService.saveCurrentModelStateToProfile(input.profileId, {
        // Agent/MCP Tools settings
        mcpToolsProviderId: config.mcpToolsProviderId,
        mcpToolsOpenaiModel: config.mcpToolsOpenaiModel,
        mcpToolsGroqModel: config.mcpToolsGroqModel,
        mcpToolsGeminiModel: config.mcpToolsGeminiModel,
        currentModelPresetId: config.currentModelPresetId,
        // STT Provider settings
        sttProviderId: config.sttProviderId,
        // Transcript Post-Processing settings
        transcriptPostProcessingProviderId: config.transcriptPostProcessingProviderId,
        transcriptPostProcessingOpenaiModel: config.transcriptPostProcessingOpenaiModel,
        transcriptPostProcessingGroqModel: config.transcriptPostProcessingGroqModel,
        transcriptPostProcessingGeminiModel: config.transcriptPostProcessingGeminiModel,
        // TTS Provider settings
        ttsProviderId: config.ttsProviderId,
      })
    }),

  // Update profile model configuration
  updateProfileModelConfig: t.procedure
    .input<{
      profileId: string
      // Agent/MCP Tools settings
      mcpToolsProviderId?: "openai" | "groq" | "gemini"
      mcpToolsOpenaiModel?: string
      mcpToolsGroqModel?: string
      mcpToolsGeminiModel?: string
      currentModelPresetId?: string
      // STT Provider settings
      sttProviderId?: "openai" | "groq"
      // Transcript Post-Processing settings
      transcriptPostProcessingProviderId?: "openai" | "groq" | "gemini"
      transcriptPostProcessingOpenaiModel?: string
      transcriptPostProcessingGroqModel?: string
      transcriptPostProcessingGeminiModel?: string
      // TTS Provider settings
      ttsProviderId?: "openai" | "groq" | "gemini"
    }>()
    .action(async ({ input }) => {
        return profileService.updateProfileModelConfig(input.profileId, {
        // Agent/MCP Tools settings
        mcpToolsProviderId: input.mcpToolsProviderId,
        mcpToolsOpenaiModel: input.mcpToolsOpenaiModel,
        mcpToolsGroqModel: input.mcpToolsGroqModel,
        mcpToolsGeminiModel: input.mcpToolsGeminiModel,
        currentModelPresetId: input.currentModelPresetId,
        // STT Provider settings
        sttProviderId: input.sttProviderId,
        // Transcript Post-Processing settings
        transcriptPostProcessingProviderId: input.transcriptPostProcessingProviderId,
        transcriptPostProcessingOpenaiModel: input.transcriptPostProcessingOpenaiModel,
        transcriptPostProcessingGroqModel: input.transcriptPostProcessingGroqModel,
        transcriptPostProcessingGeminiModel: input.transcriptPostProcessingGeminiModel,
        // TTS Provider settings
        ttsProviderId: input.ttsProviderId,
      })
    }),

  saveProfileFile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        const profileJson = profileService.exportProfile(input.id)

      const result = await dialog.showSaveDialog({
        title: "Export Profile",
        defaultPath: "profile.json",
        filters: [
          { name: "JSON Files", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return false
      }

      try {
        fs.writeFileSync(result.filePath, profileJson)
        return true
      } catch (error) {
        throw new Error(
          `Failed to save profile: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),

  loadProfileFile: t.procedure.action(async () => {
    const result = await dialog.showOpenDialog({
      title: "Import Profile",
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    })

    if (result.canceled || !result.filePaths.length) {
      return null
    }

    try {
      const profileJson = fs.readFileSync(result.filePaths[0], "utf8")
        return profileService.importProfile(profileJson)
    } catch (error) {
      throw new Error(
        `Failed to import profile: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }),
}
