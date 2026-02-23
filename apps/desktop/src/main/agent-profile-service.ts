import { app } from "electron"
import path from "path"
import fs from "fs"
import {
  AgentProfile,
  AgentProfileRole,
  AgentProfilesData,
  AgentProfileToolConfig,
  ConversationMessage,
  Profile,
  ProfilesData,
  ProfileMcpServerConfig,
  ProfileModelConfig,
  ProfileSkillsConfig,
  SessionProfileSnapshot,
  Persona,
  PersonasData,
  MCPServerConfig,
  ACPAgentConfig,
  profileToAgentProfile,
  personaToAgentProfile,
  acpAgentConfigToAgentProfile,
} from "@shared/types"
import { randomUUID } from "crypto"
import { logApp } from "./debug"
import { configStore } from "./config"
import { getBuiltinToolNames } from "./builtin-tool-definitions"
import { acpRegistry } from "./acp/acp-registry"
import type { ACPAgentDefinition } from "./acp/types"

/**
 * Path to the agent profiles storage file.
 */
export const agentProfilesPath = path.join(
  app.getPath("userData"),
  "agent-profiles.json"
)

/**
 * Path to the agent profile conversations storage file.
 */
export const agentProfileConversationsPath = path.join(
  app.getPath("userData"),
  "agent-profile-conversations.json"
)

// Legacy paths for migration
const legacyProfilesPath = path.join(app.getPath("userData"), "profiles.json")
const legacyPersonasPath = path.join(app.getPath("userData"), "personas.json")

// ============================================================================
// Validation Helpers (ported from profile-service.ts)
// ============================================================================

const RESERVED_SERVER_NAMES = ["speakmcp-settings"]
const VALID_PROVIDER_IDS = ["openai", "groq", "gemini"]
const VALID_STT_PROVIDER_IDS = ["openai", "groq", "parakeet"]
const VALID_TTS_PROVIDER_IDS = ["openai", "groq", "gemini", "kitten", "supertonic"]

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isValidServerConfig(config: unknown): boolean {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return false
  const c = config as Record<string, unknown>
  if (c.transport !== undefined && (typeof c.transport !== "string" || !["stdio", "websocket", "streamableHttp"].includes(c.transport))) return false
  if (c.command !== undefined && typeof c.command !== "string") return false
  if (c.args !== undefined && (!Array.isArray(c.args) || !c.args.every((arg) => typeof arg === "string"))) return false
  if (c.url !== undefined && typeof c.url !== "string") return false
  const transport = c.transport as string | undefined
  if (transport === "stdio" && !c.command) return false
  if ((transport === "websocket" || transport === "streamableHttp") && !c.url) return false
  if (transport === undefined && !c.command && !c.url) return false
  if (c.env !== undefined) {
    if (typeof c.env !== "object" || c.env === null || Array.isArray(c.env)) return false
    if (!Object.values(c.env as Record<string, unknown>).every((val) => typeof val === "string")) return false
  }
  if (c.headers !== undefined) {
    if (typeof c.headers !== "object" || c.headers === null || Array.isArray(c.headers)) return false
    if (!Object.values(c.headers as Record<string, unknown>).every((val) => typeof val === "string")) return false
  }
  if (c.timeout !== undefined && typeof c.timeout !== "number") return false
  if (c.disabled !== undefined && typeof c.disabled !== "boolean") return false
  if (c.oauth !== undefined) {
    if (typeof c.oauth !== "object" || c.oauth === null || Array.isArray(c.oauth)) return false
    const oauth = c.oauth as Record<string, unknown>
    if (oauth.clientId !== undefined && typeof oauth.clientId !== "string") return false
    if (oauth.clientSecret !== undefined && typeof oauth.clientSecret !== "string") return false
    if (oauth.scope !== undefined && typeof oauth.scope !== "string") return false
    if (oauth.redirectUri !== undefined && typeof oauth.redirectUri !== "string") return false
    if (oauth.useDiscovery !== undefined && typeof oauth.useDiscovery !== "boolean") return false
    if (oauth.useDynamicRegistration !== undefined && typeof oauth.useDynamicRegistration !== "boolean") return false
    if (oauth.serverMetadata !== undefined) {
      if (typeof oauth.serverMetadata !== "object" || oauth.serverMetadata === null || Array.isArray(oauth.serverMetadata)) return false
      const sm = oauth.serverMetadata as Record<string, unknown>
      if (sm.authorization_endpoint !== undefined && typeof sm.authorization_endpoint !== "string") return false
      if (sm.token_endpoint !== undefined && typeof sm.token_endpoint !== "string") return false
      if (sm.issuer !== undefined && typeof sm.issuer !== "string") return false
    }
  }
  return true
}

function isValidMcpServerConfig(config: unknown): config is Partial<ProfileMcpServerConfig> {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return false
  const c = config as Record<string, unknown>
  if (c.disabledServers !== undefined && !isStringArray(c.disabledServers)) return false
  if (c.disabledTools !== undefined && !isStringArray(c.disabledTools)) return false
  if (c.enabledServers !== undefined && !isStringArray(c.enabledServers)) return false
  if (c.allServersDisabledByDefault !== undefined && typeof c.allServersDisabledByDefault !== "boolean") return false
  return true
}

function isValidModelConfig(config: unknown): boolean {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return false
  const c = config as Record<string, unknown>
  for (const field of ["mcpToolsProviderId", "transcriptPostProcessingProviderId"]) {
    if (c[field] !== undefined && (typeof c[field] !== "string" || !VALID_PROVIDER_IDS.includes(c[field] as string))) return false
  }
  if (c.sttProviderId !== undefined && (typeof c.sttProviderId !== "string" || !VALID_STT_PROVIDER_IDS.includes(c.sttProviderId as string))) return false
  if (c.ttsProviderId !== undefined && (typeof c.ttsProviderId !== "string" || !VALID_TTS_PROVIDER_IDS.includes(c.ttsProviderId as string))) return false
  for (const field of ["mcpToolsOpenaiModel", "mcpToolsGroqModel", "mcpToolsGeminiModel", "currentModelPresetId", "transcriptPostProcessingOpenaiModel", "transcriptPostProcessingGroqModel", "transcriptPostProcessingGeminiModel"]) {
    if (c[field] !== undefined && typeof c[field] !== "string") return false
  }
  return true
}

function isValidSkillsConfig(config: unknown): config is Partial<ProfileSkillsConfig> {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return false
  const c = config as Record<string, unknown>
  if (c.enabledSkillIds !== undefined && !isStringArray(c.enabledSkillIds)) return false
  if (c.allSkillsDisabledByDefault !== undefined && typeof c.allSkillsDisabledByDefault !== "boolean") return false
  return true
}

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Convert AgentProfileToolConfig to ProfileMcpServerConfig.
 * Used when creating session snapshots from AgentProfile.
 */
export function toolConfigToMcpServerConfig(toolConfig?: AgentProfileToolConfig): ProfileMcpServerConfig | undefined {
  if (!toolConfig) return undefined
  return {
    disabledServers: toolConfig.disabledServers,
    disabledTools: toolConfig.disabledTools,
    allServersDisabledByDefault: toolConfig.allServersDisabledByDefault,
    enabledServers: toolConfig.enabledServers,
    enabledBuiltinTools: toolConfig.enabledBuiltinTools,
  }
}

/**
 * Convert ProfileMcpServerConfig to AgentProfileToolConfig.
 * Used when importing legacy profile data.
 */
export function mcpServerConfigToToolConfig(mcpConfig?: ProfileMcpServerConfig): AgentProfileToolConfig | undefined {
  if (!mcpConfig) return undefined
  return {
    disabledServers: mcpConfig.disabledServers,
    disabledTools: mcpConfig.disabledTools,
    allServersDisabledByDefault: mcpConfig.allServersDisabledByDefault,
    enabledServers: mcpConfig.enabledServers,
    enabledBuiltinTools: mcpConfig.enabledBuiltinTools,
  }
}

/**
 * Create a SessionProfileSnapshot from an AgentProfile.
 * Used by session creation code to capture profile state at session start.
 */
export function createSessionSnapshotFromProfile(
  profile: AgentProfile,
  skillsInstructions?: string,
): SessionProfileSnapshot {
  return {
    profileId: profile.id,
    profileName: profile.displayName || profile.name,
    guidelines: profile.guidelines || "",
    systemPrompt: profile.systemPrompt,
    mcpServerConfig: toolConfigToMcpServerConfig(profile.toolConfig),
    modelConfig: profile.modelConfig,
    skillsInstructions,
    agentProperties: profile.properties,
    skillsConfig: profile.skillsConfig,
  }
}

/**
 * Type for agent profile conversations storage.
 */
interface AgentProfileConversationsData {
  [profileId: string]: ConversationMessage[]
}

/**
 * Default built-in agents.
 * The "main-agent" is the primary agent that handles all user interactions.
 * Its guidelines come from `.agents/agents.md` via config.mcpToolsSystemPrompt.
 */
const DEFAULT_PROFILES: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">[] = [
  {
    name: "main-agent",
    displayName: "Main Agent",
    description: "The primary agent that handles all user interactions",
    systemPrompt: "You are a helpful assistant. Answer questions clearly and assist with a wide variety of tasks.",
    guidelines: "",
    connection: { type: "internal" },
    isStateful: false,
    role: "delegation-target",
    enabled: true,
    isBuiltIn: true,
    isUserProfile: false,
    isAgentTarget: true,
    isDefault: true,
  },
]

/**
 * Service for managing agent profiles.
 * Handles CRUD operations, migration, and queries.
 */
class AgentProfileService {
  private profilesData: AgentProfilesData | undefined
  private conversationsData: AgentProfileConversationsData = {}

  constructor() {
    this.loadProfiles()
    this.loadConversations()
  }

  /**
   * Load profiles from storage, migrating from legacy formats if needed.
   */
  private loadProfiles(): AgentProfilesData {
    try {
      if (fs.existsSync(agentProfilesPath)) {
        const data = JSON.parse(fs.readFileSync(agentProfilesPath, "utf8")) as AgentProfilesData
        this.profilesData = data
        return data
      }
    } catch (error) {
      logApp("Error loading agent profiles:", error)
    }

    // Try to migrate from legacy formats
    const migratedProfiles = this.migrateFromLegacy()
    if (migratedProfiles.length > 0) {
      this.profilesData = { profiles: migratedProfiles }
      this.saveProfiles()
      return this.profilesData
    }

    // Initialize with defaults
    const now = Date.now()
    const defaultProfiles: AgentProfile[] = DEFAULT_PROFILES.map((p) => ({
      ...p,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }))

    this.profilesData = { profiles: defaultProfiles }
    this.saveProfiles()
    return this.profilesData
  }

  /**
   * Migrate from legacy Profile, Persona, and ACPAgentConfig formats (one-time migration).
   */
  private migrateFromLegacy(): AgentProfile[] {
    const migrated: AgentProfile[] = []
    const seenIds = new Set<string>()

    // Migrate legacy profiles (user profiles)
    try {
      if (fs.existsSync(legacyProfilesPath)) {
        const data = JSON.parse(fs.readFileSync(legacyProfilesPath, "utf8")) as ProfilesData
        for (const profile of data.profiles) {
          if (!seenIds.has(profile.id)) {
            const agentProfile = profileToAgentProfile(profile)
            // Preserve currentProfileId as isDefault
            if (data.currentProfileId === profile.id) {
              agentProfile.isDefault = true
            }
            migrated.push(agentProfile)
            seenIds.add(profile.id)
          }
        }
        logApp(`Migrated ${data.profiles.length} legacy profiles`)
      }
    } catch (error) {
      logApp("Error migrating legacy profiles:", error)
    }

    // Migrate legacy personas/agents (agent targets)
    try {
      if (fs.existsSync(legacyPersonasPath)) {
        const data = JSON.parse(fs.readFileSync(legacyPersonasPath, "utf8")) as PersonasData
        for (const persona of data.personas) {
          if (!seenIds.has(persona.id)) {
            migrated.push(personaToAgentProfile(persona))
            seenIds.add(persona.id)
          }
        }
        logApp(`Migrated ${data.personas.length} legacy agents (from personas.json)`)
      }
    } catch (error) {
      logApp("Error migrating legacy agents:", error)
    }

    // Migrate ACP agents from config
    try {
      const config = configStore.get()
      if (config.acpAgents) {
        for (const acpAgent of config.acpAgents) {
          if (!seenIds.has(acpAgent.name)) {
            migrated.push(acpAgentConfigToAgentProfile(acpAgent))
            seenIds.add(acpAgent.name)
          }
        }
        logApp(`Migrated ${config.acpAgents.length} legacy ACP agents`)
      }
    } catch (error) {
      logApp("Error migrating legacy ACP agents:", error)
    }

    return migrated
  }

  /**
   * Save profiles to storage.
   */
  private saveProfiles(): void {
    if (!this.profilesData) return
    try {
      fs.writeFileSync(agentProfilesPath, JSON.stringify(this.profilesData, null, 2))
    } catch (error) {
      logApp("Error saving agent profiles:", error)
    }
  }

  /**
   * Load conversations from storage.
   */
  private loadConversations(): void {
    try {
      if (fs.existsSync(agentProfileConversationsPath)) {
        this.conversationsData = JSON.parse(
          fs.readFileSync(agentProfileConversationsPath, "utf8")
        )
      }
    } catch (error) {
      logApp("Error loading agent profile conversations:", error)
    }
  }

  /**
   * Save conversations to storage.
   */
  private saveConversations(): void {
    try {
      fs.writeFileSync(
        agentProfileConversationsPath,
        JSON.stringify(this.conversationsData, null, 2)
      )
    } catch (error) {
      logApp("Error saving agent profile conversations:", error)
    }
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  /**
   * Get all profiles.
   */
  getAll(): AgentProfile[] {
    return this.profilesData?.profiles ?? []
  }

  /**
   * Get a profile by ID.
   */
  getById(id: string): AgentProfile | undefined {
    return this.profilesData?.profiles.find((p) => p.id === id)
  }

  /**
   * Get a profile by name.
   */
  getByName(name: string): AgentProfile | undefined {
    return this.profilesData?.profiles.find((p) => p.name === name)
  }

  /**
   * Create a new profile.
   */
  create(profile: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">): AgentProfile {
    const now = Date.now()
    const newProfile: AgentProfile = {
      ...profile,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }

    if (!this.profilesData) {
      this.profilesData = { profiles: [] }
    }
    this.profilesData.profiles.push(newProfile)
    this.saveProfiles()

    return newProfile
  }

  /**
   * Update a profile.
   */
  update(id: string, updates: Partial<AgentProfile>): AgentProfile | undefined {
    const profile = this.getById(id)
    if (!profile) return undefined

    // Don't allow updating certain fields
    const { id: _, createdAt, isBuiltIn, ...allowedUpdates } = updates

    Object.assign(profile, allowedUpdates, { updatedAt: Date.now() })
    this.saveProfiles()

    return profile
  }

  /**
   * Delete a profile.
   */
  delete(id: string): boolean {
    if (!this.profilesData) return false

    const profile = this.getById(id)
    if (!profile || profile.isBuiltIn) return false

    const index = this.profilesData.profiles.findIndex((p) => p.id === id)
    if (index === -1) return false

    this.profilesData.profiles.splice(index, 1)
    this.saveProfiles()

    // Also delete conversation
    delete this.conversationsData[id]
    this.saveConversations()

    return true
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get profiles by role.
   * Uses the new role field, falling back to legacy flags for backward compatibility.
   */
  getByRole(role: AgentProfileRole): AgentProfile[] {
    return this.getAll().filter((p) => {
      // Use role field if present
      if (p.role) {
        return p.role === role
      }
      // Fall back to legacy flags for backward compatibility
      switch (role) {
        case "user-profile":
          return p.isUserProfile === true
        case "delegation-target":
          return p.isAgentTarget === true
        case "external-agent":
          // External agents have acp/stdio/remote connection types and are agent targets
          return p.isAgentTarget === true &&
            (p.connection.type === "acp" || p.connection.type === "stdio" || p.connection.type === "remote")
        default:
          return false
      }
    })
  }

  /**
   * Get user profiles (shown in profile picker).
   * Uses getByRole internally for consistency.
   */
  getUserProfiles(): AgentProfile[] {
    // Use getByRole, but also include legacy isUserProfile for backward compatibility
    const byRole = this.getByRole("user-profile")
    const byLegacy = this.getAll().filter((p) => p.isUserProfile && !p.role)
    // Combine and deduplicate by id
    const ids = new Set(byRole.map(p => p.id))
    return [...byRole, ...byLegacy.filter(p => !ids.has(p.id))]
  }

  /**
   * Get agent targets (available for delegation).
   * Uses getByRole internally for consistency.
   */
  getAgentTargets(): AgentProfile[] {
    // Use getByRole, but also include legacy isAgentTarget for backward compatibility
    const byRole = this.getByRole("delegation-target")
    const byLegacy = this.getAll().filter((p) => p.isAgentTarget && !p.role)
    // Combine and deduplicate by id
    const ids = new Set(byRole.map(p => p.id))
    return [...byRole, ...byLegacy.filter(p => !ids.has(p.id))]
  }

  /**
   * Get external agents (ACP/stdio/remote agents).
   */
  getExternalAgents(): AgentProfile[] {
    return this.getByRole("external-agent")
  }

  /**
   * Get enabled agent targets.
   */
  getEnabledAgentTargets(): AgentProfile[] {
    return this.getAgentTargets().filter((p) => p.enabled)
  }

  /**
   * Get the current active agent profile.
   * Falls back to the default agent if no current profile is set.
   */
  getCurrentProfile(): AgentProfile | undefined {
    const currentId = this.profilesData?.currentProfileId
    if (currentId) {
      return this.getById(currentId)
    }
    // Fall back to any default profile (user profiles no longer exist)
    return this.getAll().find((p) => p.isDefault)
  }

  /**
   * Set the current active agent profile.
   */
  setCurrentProfile(id: string): void {
    if (!this.profilesData) return
    const profile = this.getById(id)
    if (profile) {
      this.profilesData.currentProfileId = id
      this.saveProfiles()
    }
  }

  // ============================================================================
  // Conversation State (for stateful agents)
  // ============================================================================

  /**
   * Get conversation for a profile.
   */
  getConversation(profileId: string): ConversationMessage[] {
    return this.conversationsData[profileId] ?? []
  }

  /**
   * Set conversation for a profile.
   */
  setConversation(profileId: string, messages: ConversationMessage[]): void {
    this.conversationsData[profileId] = messages
    this.saveConversations()
  }

  /**
   * Add message to a profile's conversation.
   */
  addToConversation(profileId: string, message: ConversationMessage): void {
    if (!this.conversationsData[profileId]) {
      this.conversationsData[profileId] = []
    }
    this.conversationsData[profileId].push(message)
    this.saveConversations()
  }

  /**
   * Clear conversation for a profile.
   */
  clearConversation(profileId: string): void {
    delete this.conversationsData[profileId]
    this.saveConversations()

    // Also clear conversationId on the profile
    const profile = this.getById(profileId)
    if (profile) {
      profile.conversationId = undefined
      this.saveProfiles()
    }
  }

  /**
   * Reload profiles from disk (for external changes).
   */
  reload(): void {
    this.profilesData = undefined
    this.loadProfiles()
    this.loadConversations()
  }

  // ============================================================================
  // ACP Integration
  // ============================================================================

  /**
   * Sync enabled agent profiles (delegation targets) to the ACP registry.
   * Converts agent profiles to ACPAgentDefinition and registers them.
   * This allows agent profiles to appear as available agents for delegation.
   */
  syncAgentProfilesToACPRegistry(): void {
    const enabledTargets = this.getEnabledAgentTargets()

    for (const profile of enabledTargets) {
      const definition = this.agentProfileToACPDefinition(profile)
      acpRegistry.registerAgent(definition)
    }

    logApp(`Synced ${enabledTargets.length} agent profile(s) to ACP registry`)
  }

  /**
   * Convert an AgentProfile to an ACPAgentDefinition.
   */
  private agentProfileToACPDefinition(profile: AgentProfile): ACPAgentDefinition {
    // Determine baseUrl based on connection type
    let baseUrl: string
    if (profile.connection.type === "remote" && profile.connection.baseUrl) {
      baseUrl = profile.connection.baseUrl
    } else if (profile.connection.type === "internal") {
      // Internal profiles don't have a baseUrl, use a placeholder
      baseUrl = "internal://"
    } else {
      // acp/stdio profiles use localhost
      baseUrl = "http://localhost"
    }

    // Build spawn config for stdio/acp profiles
    const spawnConfig =
      (profile.connection.type === "stdio" || profile.connection.type === "acp") &&
      profile.connection.command
        ? {
            command: profile.connection.command,
            args: profile.connection.args ?? [],
            env: profile.connection.env,
            cwd: profile.connection.cwd,
          }
        : undefined

    return {
      name: profile.name,
      displayName: profile.displayName,
      description: profile.description ?? "",
      baseUrl,
      spawnConfig,
    }
  }

  // ============================================================================
  // MCP Config Management (ported from ProfileService)
  // ============================================================================

  /**
   * Update the tool/MCP server configuration for a profile.
   * Merges with existing config - only provided fields are updated.
   * Accepts ProfileMcpServerConfig for backward compatibility with callers.
   */
  updateProfileMcpConfig(id: string, mcpServerConfig: Partial<ProfileMcpServerConfig>): AgentProfile | undefined {
    const profile = this.getById(id)
    if (!profile) return undefined

    const existing = profile.toolConfig ?? {}
    const mergedToolConfig: AgentProfileToolConfig = {
      ...existing,
      ...(mcpServerConfig.disabledServers !== undefined && { disabledServers: mcpServerConfig.disabledServers }),
      ...(mcpServerConfig.disabledTools !== undefined && { disabledTools: mcpServerConfig.disabledTools }),
      ...(mcpServerConfig.allServersDisabledByDefault !== undefined && { allServersDisabledByDefault: mcpServerConfig.allServersDisabledByDefault }),
      ...(mcpServerConfig.enabledServers !== undefined && { enabledServers: mcpServerConfig.enabledServers }),
      ...(mcpServerConfig.enabledBuiltinTools !== undefined && { enabledBuiltinTools: mcpServerConfig.enabledBuiltinTools }),
    }

    return this.update(id, { toolConfig: mergedToolConfig })
  }

  /**
   * Save current MCP state to a profile.
   */
  saveCurrentMcpStateToProfile(id: string, disabledServers: string[], disabledTools: string[], enabledServers?: string[]): AgentProfile | undefined {
    return this.updateProfileMcpConfig(id, {
      disabledServers,
      disabledTools,
      ...(enabledServers !== undefined && { enabledServers }),
    })
  }

  // ============================================================================
  // Model Config Management (ported from ProfileService)
  // ============================================================================

  /**
   * Update the model configuration for a profile.
   * Merges with existing config - only provided fields are updated.
   */
  updateProfileModelConfig(id: string, modelConfig: Partial<ProfileModelConfig>): AgentProfile | undefined {
    const profile = this.getById(id)
    if (!profile) return undefined

    const mergedModelConfig: ProfileModelConfig = {
      ...(profile.modelConfig ?? {}),
      ...(modelConfig.mcpToolsProviderId !== undefined && { mcpToolsProviderId: modelConfig.mcpToolsProviderId }),
      ...(modelConfig.mcpToolsOpenaiModel !== undefined && { mcpToolsOpenaiModel: modelConfig.mcpToolsOpenaiModel }),
      ...(modelConfig.mcpToolsGroqModel !== undefined && { mcpToolsGroqModel: modelConfig.mcpToolsGroqModel }),
      ...(modelConfig.mcpToolsGeminiModel !== undefined && { mcpToolsGeminiModel: modelConfig.mcpToolsGeminiModel }),
      ...(modelConfig.currentModelPresetId !== undefined && { currentModelPresetId: modelConfig.currentModelPresetId }),
      ...(modelConfig.sttProviderId !== undefined && { sttProviderId: modelConfig.sttProviderId }),
      ...(modelConfig.transcriptPostProcessingProviderId !== undefined && { transcriptPostProcessingProviderId: modelConfig.transcriptPostProcessingProviderId }),
      ...(modelConfig.transcriptPostProcessingOpenaiModel !== undefined && { transcriptPostProcessingOpenaiModel: modelConfig.transcriptPostProcessingOpenaiModel }),
      ...(modelConfig.transcriptPostProcessingGroqModel !== undefined && { transcriptPostProcessingGroqModel: modelConfig.transcriptPostProcessingGroqModel }),
      ...(modelConfig.transcriptPostProcessingGeminiModel !== undefined && { transcriptPostProcessingGeminiModel: modelConfig.transcriptPostProcessingGeminiModel }),
      ...(modelConfig.ttsProviderId !== undefined && { ttsProviderId: modelConfig.ttsProviderId }),
    }

    return this.update(id, { modelConfig: mergedModelConfig })
  }

  /**
   * Save current model state to a profile.
   */
  saveCurrentModelStateToProfile(id: string, modelConfig: ProfileModelConfig): AgentProfile | undefined {
    return this.updateProfileModelConfig(id, modelConfig)
  }

  // ============================================================================
  // Skills Management (ported from ProfileService)
  // ============================================================================

  /**
   * Update the skills configuration for a profile.
   * Merges with existing config - only provided fields are updated.
   */
  updateProfileSkillsConfig(id: string, skillsConfig: Partial<ProfileSkillsConfig>): AgentProfile | undefined {
    const profile = this.getById(id)
    if (!profile) return undefined

    const mergedSkillsConfig: ProfileSkillsConfig = {
      ...(profile.skillsConfig ?? {}),
      ...(skillsConfig.enabledSkillIds !== undefined && { enabledSkillIds: skillsConfig.enabledSkillIds }),
      ...(skillsConfig.allSkillsDisabledByDefault !== undefined && { allSkillsDisabledByDefault: skillsConfig.allSkillsDisabledByDefault }),
    }

    return this.update(id, { skillsConfig: mergedSkillsConfig })
  }

  /**
   * Toggle a skill's enabled state for a specific profile.
   */
  toggleProfileSkill(profileId: string, skillId: string): AgentProfile | undefined {
    const profile = this.getById(profileId)
    if (!profile) return undefined

    const currentEnabledSkills = profile.skillsConfig?.enabledSkillIds ?? []
    const isCurrentlyEnabled = currentEnabledSkills.includes(skillId)

    const newEnabledSkillIds = isCurrentlyEnabled
      ? currentEnabledSkills.filter(id => id !== skillId)
      : [...currentEnabledSkills, skillId]

    return this.updateProfileSkillsConfig(profileId, {
      enabledSkillIds: newEnabledSkillIds,
      allSkillsDisabledByDefault: true,
    })
  }

  /**
   * Check if a skill is enabled for a specific profile.
   */
  isSkillEnabledForProfile(profileId: string, skillId: string): boolean {
    const profile = this.getById(profileId)
    if (!profile) return false
    return (profile.skillsConfig?.enabledSkillIds ?? []).includes(skillId)
  }

  /**
   * Get all enabled skill IDs for a profile.
   */
  getEnabledSkillIdsForProfile(profileId: string): string[] {
    const profile = this.getById(profileId)
    if (!profile) return []
    return profile.skillsConfig?.enabledSkillIds ?? []
  }

  /**
   * Enable a skill for the current profile (used when installing new skills).
   */
  enableSkillForCurrentProfile(skillId: string): AgentProfile | undefined {
    const currentProfile = this.getCurrentProfile()
    if (!currentProfile) return undefined

    const currentEnabledSkills = currentProfile.skillsConfig?.enabledSkillIds ?? []
    if (currentEnabledSkills.includes(skillId)) return currentProfile

    return this.updateProfileSkillsConfig(currentProfile.id, {
      enabledSkillIds: [...currentEnabledSkills, skillId],
      allSkillsDisabledByDefault: true,
    })
  }

  // ============================================================================
  // Import / Export (ported from ProfileService)
  // ============================================================================

  /**
   * Export a profile as a JSON string.
   */
  exportProfile(id: string): string {
    const profile = this.getById(id)
    if (!profile) throw new Error(`Profile with id ${id} not found`)

    const mcpServerConfig = toolConfigToMcpServerConfig(profile.toolConfig)
    const exportData: Record<string, unknown> = {
      version: 1,
      name: profile.displayName || profile.name,
      guidelines: profile.guidelines || "",
    }

    if (profile.systemPrompt) exportData.systemPrompt = profile.systemPrompt
    if (mcpServerConfig) exportData.mcpServerConfig = mcpServerConfig
    if (profile.modelConfig) exportData.modelConfig = profile.modelConfig
    if (profile.skillsConfig) exportData.skillsConfig = profile.skillsConfig

    // Include actual MCP server definitions for enabled servers
    const config = configStore.get()
    const mcpConfig = config.mcpConfig
    if (mcpConfig?.mcpServers) {
      const enabledServers: Record<string, unknown> = {}
      const allServerNames = Object.keys(mcpConfig.mcpServers)

      let serversToExport: string[]
      if (mcpServerConfig) {
        if (mcpServerConfig.allServersDisabledByDefault) {
          serversToExport = mcpServerConfig.enabledServers || []
        } else {
          serversToExport = allServerNames.filter(name => !(mcpServerConfig.disabledServers || []).includes(name))
        }
      } else {
        serversToExport = allServerNames
      }

      for (const serverName of serversToExport) {
        if (mcpConfig.mcpServers[serverName]) {
          const { env, headers, oauth, ...sanitizedConfig } = mcpConfig.mcpServers[serverName]
          enabledServers[serverName] = sanitizedConfig
        }
      }

      if (Object.keys(enabledServers).length > 0) {
        exportData.mcpServers = enabledServers
      }
    }

    return JSON.stringify(exportData, null, 2)
  }

  /**
   * Import a profile from a JSON string.
   */
  importProfile(profileJson: string): AgentProfile {
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

      // Create default tool config with all servers disabled
      const appConfig = configStore.get()
      const allServerNames = Object.keys(appConfig.mcpConfig?.mcpServers || {})
      const builtinToolNames = getBuiltinToolNames()

      const newProfile = this.create({
        name: importData.name,
        displayName: importData.name,
        guidelines: importData.guidelines || "",
        systemPrompt: importData.systemPrompt,
        connection: { type: "internal" },
        role: "delegation-target",
        enabled: true,
        isUserProfile: false,
        isAgentTarget: true,
        toolConfig: {
          disabledServers: allServerNames,
          disabledTools: builtinToolNames,
          allServersDisabledByDefault: true,
        },
      })

      // Import MCP server definitions if present
      const importedServerNames: string[] = []
      if (importData.mcpServers && typeof importData.mcpServers === "object" && !Array.isArray(importData.mcpServers)) {
        const currentMcpServers = appConfig.mcpConfig?.mcpServers || {}
        const mergedServers = { ...currentMcpServers }
        let newServersAdded = 0

        for (const [serverName, serverConfig] of Object.entries(importData.mcpServers)) {
          const normalizedServerName = serverName.trim()
          if (!normalizedServerName) continue
          if (["__proto__", "constructor", "prototype"].includes(normalizedServerName)) continue
          if (RESERVED_SERVER_NAMES.some(r => r.toLowerCase() === normalizedServerName.toLowerCase())) continue
          if (!mergedServers[normalizedServerName]) {
            if (!isValidServerConfig(serverConfig)) continue
            mergedServers[normalizedServerName] = serverConfig as MCPServerConfig
            importedServerNames.push(normalizedServerName)
            newServersAdded++
          }
        }

        if (newServersAdded > 0) {
          configStore.save({ ...appConfig, mcpConfig: { ...appConfig.mcpConfig, mcpServers: mergedServers } })
          logApp(`Imported ${newServersAdded} new MCP server(s)`)
        }
      }

      // Apply MCP server configuration if present
      if (importData.mcpServerConfig && typeof importData.mcpServerConfig === "object") {
        if (isValidMcpServerConfig(importData.mcpServerConfig)) {
          this.updateProfileMcpConfig(newProfile.id, importData.mcpServerConfig)
        }
      } else if (importedServerNames.length > 0) {
        const current = this.getById(newProfile.id)
        const currentEnabled = current?.toolConfig?.enabledServers || []
        this.updateProfileMcpConfig(newProfile.id, {
          enabledServers: [...new Set([...currentEnabled, ...importedServerNames])],
        })
      }

      // Apply model configuration if present
      if (importData.modelConfig && typeof importData.modelConfig === "object") {
        if (isValidModelConfig(importData.modelConfig)) {
          this.updateProfileModelConfig(newProfile.id, importData.modelConfig)
        }
      }

      // Apply skills configuration if present
      if (importData.skillsConfig && typeof importData.skillsConfig === "object") {
        if (isValidSkillsConfig(importData.skillsConfig)) {
          this.updateProfileSkillsConfig(newProfile.id, importData.skillsConfig)
        }
      }

      return this.getById(newProfile.id)!
    } catch (error) {
      throw new Error(`Failed to import profile: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ============================================================================
  // Backward Compatibility Helpers
  // ============================================================================

  /**
   * Get profiles in legacy Profile format (for backward-compatible IPC handlers).
   * Returns only user-profile role profiles shaped like the legacy Profile type.
   */
  getProfilesLegacy(): Profile[] {
    return this.getUserProfiles().map(p => this.agentProfileToLegacyProfile(p))
  }

  /**
   * Get a single profile in legacy Profile format.
   */
  getProfileLegacy(id: string): Profile | undefined {
    const profile = this.getById(id)
    if (!profile) return undefined
    return this.agentProfileToLegacyProfile(profile)
  }

  /**
   * Get current profile in legacy Profile format.
   */
  getCurrentProfileLegacy(): Profile | undefined {
    const profile = this.getCurrentProfile()
    if (!profile) return undefined
    return this.agentProfileToLegacyProfile(profile)
  }

  /**
   * Convert an AgentProfile to legacy Profile format.
   */
  private agentProfileToLegacyProfile(p: AgentProfile): Profile {
    return {
      id: p.id,
      name: p.displayName || p.name,
      guidelines: p.guidelines || "",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      isDefault: p.isDefault,
      mcpServerConfig: toolConfigToMcpServerConfig(p.toolConfig),
      modelConfig: p.modelConfig,
      skillsConfig: p.skillsConfig,
      systemPrompt: p.systemPrompt,
    }
  }

  /**
   * Create an agent with legacy-style parameters.
   * Used by backward-compatible IPC handlers and builtin tools.
   */
  createUserProfile(name: string, guidelines: string, systemPrompt?: string): AgentProfile {
    const config = configStore.get()
    const allServerNames = Object.keys(config.mcpConfig?.mcpServers || {})
    const builtinToolNames = getBuiltinToolNames()

    return this.create({
      name,
      displayName: name,
      guidelines,
      systemPrompt,
      connection: { type: "internal" },
      role: "delegation-target",
      enabled: true,
      isUserProfile: false,
      isAgentTarget: true,
      toolConfig: {
        disabledServers: allServerNames,
        disabledTools: builtinToolNames,
        allServersDisabledByDefault: true,
      },
    })
  }

  /**
   * Set current profile and return it (throws if not found, like legacy ProfileService).
   */
  setCurrentProfileStrict(id: string): AgentProfile {
    const profile = this.getById(id)
    if (!profile) throw new Error(`Profile with id ${id} not found`)
    this.setCurrentProfile(id)
    return profile
  }
}

export const agentProfileService = new AgentProfileService()