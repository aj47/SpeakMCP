import { app } from "electron"
import path from "path"
import fs from "fs"
import {
  AgentProfile,
  AgentProfileRole,
  AgentProfilesData,
  ConversationMessage,
  Profile,
  ProfilesData,
  Persona,
  PersonasData,
  ACPAgentConfig,
  profileToAgentProfile,
  personaToAgentProfile,
  acpAgentConfigToAgentProfile,
} from "@shared/types"
import { randomUUID } from "crypto"
import { logApp } from "./debug"
import { configStore } from "./config"
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

/**
 * Type for agent profile conversations storage.
 */
interface AgentProfileConversationsData {
  [profileId: string]: ConversationMessage[]
}

/**
 * Default built-in profiles.
 */
const DEFAULT_PROFILES: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">[] = [
  {
    name: "default",
    displayName: "Default",
    description: "Default user profile",
    guidelines: "",
    connection: { type: "internal" },
    role: "user-profile",
    enabled: true,
    isBuiltIn: true,
    isUserProfile: true,
    isAgentTarget: false,
    isDefault: true,
  },
  {
    name: "general-assistant",
    displayName: "General Assistant",
    description: "Handles general tasks when no specialized agent matches",
    systemPrompt: "You are a helpful general assistant. Answer questions clearly and assist with a wide variety of tasks.",
    guidelines: "Be helpful, clear, and concise. If you don't know something, say so.",
    capabilities: ["general", "chat", "help"],
    toolConfig: {
      enabledServers: [],
      disabledTools: [],
      enabledBuiltinTools: [],
    },
    modelConfig: {
      mcpToolsProviderId: "openai",
      mcpToolsOpenaiModel: "gpt-4o",
    },
    skillsConfig: {
      enabledSkillIds: [],
    },
    connection: { type: "internal" },
    isStateful: false,
    role: "delegation-target",
    enabled: true,
    isBuiltIn: true,
    isUserProfile: false,
    isAgentTarget: true,
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
   * Migrate from legacy Profile, Persona, and ACPAgentConfig formats.
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

    // Migrate legacy personas (agent targets)
    try {
      if (fs.existsSync(legacyPersonasPath)) {
        const data = JSON.parse(fs.readFileSync(legacyPersonasPath, "utf8")) as PersonasData
        for (const persona of data.personas) {
          if (!seenIds.has(persona.id)) {
            migrated.push(personaToAgentProfile(persona))
            seenIds.add(persona.id)
          }
        }
        logApp(`Migrated ${data.personas.length} legacy personas`)
      }
    } catch (error) {
      logApp("Error migrating legacy personas:", error)
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
   * Get the current active profile.
   */
  getCurrentProfile(): AgentProfile | undefined {
    const currentId = this.profilesData?.currentProfileId
    if (currentId) {
      return this.getById(currentId)
    }
    // Fall back to default profile
    return this.getAll().find((p) => p.isDefault && (p.isUserProfile || p.role === "user-profile"))
  }

  /**
   * Set the current active profile.
   */
  setCurrentProfile(id: string): void {
    if (!this.profilesData) return
    const profile = this.getById(id)
    if (profile && (profile.isUserProfile || profile.role === "user-profile")) {
      this.profilesData.currentProfileId = id
      this.saveProfiles()
    }
  }

  /**
   * Get profiles by capability.
   */
  getByCapability(capability: string): AgentProfile[] {
    return this.getAll().filter((p) =>
      p.capabilities?.includes(capability) && p.enabled
    )
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
      capabilities: profile.capabilities ?? [],
      baseUrl,
      spawnConfig,
    }
  }
}

export const agentProfileService = new AgentProfileService()