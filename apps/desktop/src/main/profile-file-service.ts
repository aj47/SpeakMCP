import fs from "fs"
import path from "path"
import { Profile } from "@shared/types"
import {
  ProfileFrontmatter,
  ProfileMarkdown,
  FILE_DISCOVERY_FOLDERS,
} from "@shared/file-discovery-types"
import { dataFolder } from "./config"
import { logApp } from "./debug"

class ProfileFileService {
  private discoveryFolder: string
  private profilesFolder: string

  constructor() {
    this.discoveryFolder = path.join(dataFolder, FILE_DISCOVERY_FOLDERS.ROOT)
    this.profilesFolder = path.join(this.discoveryFolder, FILE_DISCOVERY_FOLDERS.PROFILES)
  }

  ensureFolders(): void {
    try {
      if (!fs.existsSync(this.discoveryFolder)) {
        fs.mkdirSync(this.discoveryFolder, { recursive: true })
      }
      if (!fs.existsSync(this.profilesFolder)) {
        fs.mkdirSync(this.profilesFolder, { recursive: true })
      }
    } catch (error) {
      logApp("Error creating profile folders:", error)
    }
  }

  profileToMarkdown(profile: Profile): string {
    const frontmatter: ProfileFrontmatter = {
      id: profile.id,
      name: profile.name,
      created: new Date(profile.createdAt).toISOString(),
      updated: new Date(profile.updatedAt).toISOString(),
      ...(profile.isDefault ? { isDefault: true } : {}),
    }

    const lines: string[] = []
    lines.push("---")
    lines.push(`id: ${frontmatter.id}`)
    lines.push(`name: ${frontmatter.name}`)
    lines.push(`created: ${frontmatter.created}`)
    lines.push(`updated: ${frontmatter.updated}`)
    if (frontmatter.isDefault) {
      lines.push(`isDefault: true`)
    }
    lines.push("---")
    lines.push("")
    lines.push(`# ${profile.name}`)
    lines.push("")

    lines.push("## Guidelines")
    lines.push(profile.guidelines || "")
    lines.push("")

    if (profile.systemPrompt) {
      lines.push("## System Prompt")
      lines.push(profile.systemPrompt)
      lines.push("")
    }

    // Enabled MCP Servers
    lines.push("## Enabled MCP Servers")
    const enabledServers = profile.mcpServerConfig?.enabledServers || []
    if (enabledServers.length > 0) {
      for (const server of enabledServers) {
        lines.push(`- ${server}`)
      }
    }
    lines.push("")

    // Disabled Tools
    lines.push("## Disabled Tools")
    const disabledTools = profile.mcpServerConfig?.disabledTools || []
    if (disabledTools.length > 0) {
      for (const tool of disabledTools) {
        lines.push(`- ${tool}`)
      }
    }
    lines.push("")

    // Model Configuration
    lines.push("## Model Configuration")
    const modelConfig = profile.modelConfig
    if (modelConfig) {
      const provider = modelConfig.mcpToolsProviderId || "default"
      let model = "default"
      if (modelConfig.mcpToolsProviderId === "openai") {
        model = modelConfig.mcpToolsOpenaiModel || "default"
      } else if (modelConfig.mcpToolsProviderId === "groq") {
        model = modelConfig.mcpToolsGroqModel || "default"
      } else if (modelConfig.mcpToolsProviderId === "gemini") {
        model = modelConfig.mcpToolsGeminiModel || "default"
      }
      lines.push(`- MCP Tools Provider: ${provider}`)
      lines.push(`- MCP Tools Model: ${model}`)
      lines.push(`- STT Provider: ${modelConfig.sttProviderId || "default"}`)
      lines.push(`- TTS Provider: ${modelConfig.ttsProviderId || "default"}`)
    } else {
      lines.push(`- MCP Tools Provider: default`)
      lines.push(`- MCP Tools Model: default`)
      lines.push(`- STT Provider: default`)
      lines.push(`- TTS Provider: default`)
    }
    lines.push("")

    return lines.join("\n")
  }

  parseProfileMarkdown(markdown: string): ProfileMarkdown | null {
    try {
      // Extract frontmatter
      const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/)
      if (!frontmatterMatch) {
        return null
      }

      const frontmatterText = frontmatterMatch[1]
      const frontmatter: Partial<ProfileFrontmatter> = {}

      for (const line of frontmatterText.split("\n")) {
        const colonIndex = line.indexOf(":")
        if (colonIndex === -1) continue
        const key = line.slice(0, colonIndex).trim()
        const value = line.slice(colonIndex + 1).trim()

        if (key === "id") frontmatter.id = value
        else if (key === "name") frontmatter.name = value
        else if (key === "created") frontmatter.created = value
        else if (key === "updated") frontmatter.updated = value
        else if (key === "isDefault") frontmatter.isDefault = value === "true"
      }

      if (!frontmatter.id || !frontmatter.name || !frontmatter.created || !frontmatter.updated) {
        return null
      }

      const content = markdown.slice(frontmatterMatch[0].length)

      // Parse sections
      const guidelinesMatch = content.match(/## Guidelines\n([\s\S]*?)(?=\n## |$)/)
      const systemPromptMatch = content.match(/## System Prompt\n([\s\S]*?)(?=\n## |$)/)
      const enabledServersMatch = content.match(/## Enabled MCP Servers\n([\s\S]*?)(?=\n## |$)/)
      // Note: disabledToolsMatch captured but not used - ProfileMarkdown uses enabledTools
      // which requires full tool list knowledge to compute from disabled tools
      const _disabledToolsMatch = content.match(/## Disabled Tools\n([\s\S]*?)(?=\n## |$)/)
      void _disabledToolsMatch // Silence unused variable warning
      const modelConfigMatch = content.match(/## Model Configuration\n([\s\S]*?)(?=\n## |$)/)

      const guidelines = guidelinesMatch ? guidelinesMatch[1].trim() : ""
      const systemPrompt = systemPromptMatch ? systemPromptMatch[1].trim() : undefined

      const enabledServers: string[] = []
      if (enabledServersMatch) {
        const serverLines = enabledServersMatch[1].trim().split("\n")
        for (const line of serverLines) {
          const match = line.match(/^- (.+)$/)
          if (match) enabledServers.push(match[1])
        }
      }

      const enabledTools: string[] = []
      // Note: We store disabledTools, but ProfileMarkdown expects enabledTools
      // For parsing, we read disabledTools section but leave enabledTools empty
      // as we don't know the full tool list here

      const modelConfig: ProfileMarkdown["modelConfig"] = {}
      if (modelConfigMatch) {
        const configLines = modelConfigMatch[1].trim().split("\n")
        for (const line of configLines) {
          const providerMatch = line.match(/^- MCP Tools Provider: (.+)$/)
          const modelMatch = line.match(/^- MCP Tools Model: (.+)$/)
          const sttMatch = line.match(/^- STT Provider: (.+)$/)
          const ttsMatch = line.match(/^- TTS Provider: (.+)$/)

          if (providerMatch && providerMatch[1] !== "default") {
            modelConfig.provider = providerMatch[1]
          }
          if (modelMatch && modelMatch[1] !== "default") {
            modelConfig.model = modelMatch[1]
          }
          if (sttMatch && sttMatch[1] !== "default") {
            modelConfig.sttProvider = sttMatch[1]
          }
          if (ttsMatch && ttsMatch[1] !== "default") {
            modelConfig.ttsProvider = ttsMatch[1]
          }
        }
      }

      return {
        frontmatter: frontmatter as ProfileFrontmatter,
        guidelines,
        systemPrompt,
        enabledServers,
        enabledTools,
        modelConfig: Object.keys(modelConfig).length > 0 ? modelConfig : undefined,
      }
    } catch (error) {
      logApp("Error parsing profile markdown:", error)
      return null
    }
  }

  writeProfileFile(profile: Profile): void {
    try {
      this.ensureFolders()
      const markdown = this.profileToMarkdown(profile)
      const filePath = this.getProfileFilePath(profile.id)
      fs.writeFileSync(filePath, markdown, "utf-8")
    } catch (error) {
      logApp("Error writing profile file:", error)
    }
  }

  readProfileFile(profileId: string): ProfileMarkdown | null {
    try {
      const filePath = this.getProfileFilePath(profileId)
      if (!fs.existsSync(filePath)) {
        return null
      }
      const markdown = fs.readFileSync(filePath, "utf-8")
      return this.parseProfileMarkdown(markdown)
    } catch (error) {
      logApp("Error reading profile file:", error)
      return null
    }
  }

  syncAllProfiles(profiles: Profile[]): void {
    try {
      this.ensureFolders()

      // Get existing profile files
      const existingFiles = this.listProfileFiles()
      const existingIds = new Set(existingFiles.map((f) => path.basename(f, ".md")))

      // Write all current profiles
      for (const profile of profiles) {
        this.writeProfileFile(profile)
        existingIds.delete(profile.id)
      }

      // Remove orphaned profile files (profiles that no longer exist)
      for (const orphanedId of existingIds) {
        this.removeProfileFile(orphanedId)
      }
    } catch (error) {
      logApp("Error syncing all profiles:", error)
    }
  }

  removeProfileFile(profileId: string): void {
    try {
      const filePath = this.getProfileFilePath(profileId)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (error) {
      logApp("Error removing profile file:", error)
    }
  }

  getProfileFilePath(profileId: string): string {
    return path.join(this.profilesFolder, `${profileId}.md`)
  }

  listProfileFiles(): string[] {
    try {
      this.ensureFolders()
      const files = fs.readdirSync(this.profilesFolder)
      return files
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join(this.profilesFolder, f))
    } catch (error) {
      logApp("Error listing profile files:", error)
      return []
    }
  }
}

export const profileFileService = new ProfileFileService()
