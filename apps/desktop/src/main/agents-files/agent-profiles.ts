import fs from "fs"
import path from "path"
import type {
  AgentProfile,
  AgentProfileConnection,
  AgentProfileConnectionType,
  AgentProfileRole,
  AgentProfileToolConfig,
  ProfileModelConfig,
  ProfileSkillsConfig,
} from "@shared/types"
import type { AgentsLayerPaths } from "./modular-config"
import { AGENTS_AGENT_PROFILES_DIR, getAgentsLayerPaths } from "./modular-config"
import { parseFrontmatterOrBody, stringifyFrontmatterDocument } from "./frontmatter"
import { readTextFileIfExistsSync, safeWriteFileSync } from "./safe-file"
import { safeReadJsonFileSync, safeWriteJsonFileSync } from "./safe-file"

export const AGENTS_PROFILE_CANONICAL_FILENAME = "agent.md"
export const AGENTS_PROFILE_CONFIG_FILENAME = "config.json"
export const AGENTS_PROFILE_AVATAR_FILENAME = "avatar.png"

export type AgentProfileOrigin = {
  filePath: string
  configJsonPath?: string
}

export type LoadedAgentProfilesLayer = {
  profiles: AgentProfile[]
  originById: Map<string, AgentProfileOrigin>
}

// ============================================================================
// Helpers
// ============================================================================

function sanitizeFileComponent(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function normalizeSingleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
}

function parseBoolean(raw: string | undefined, defaultValue: boolean): boolean {
  const trimmed = (raw ?? "").trim().toLowerCase()
  if (!trimmed) return defaultValue
  if (["1", "true", "yes", "y", "on"].includes(trimmed)) return true
  if (["0", "false", "no", "n", "off"].includes(trimmed)) return false
  return defaultValue
}

function parseNumber(raw: string | undefined, defaultValue: number): number {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return defaultValue
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : defaultValue
}

function tryGetFileMtimeMs(filePath: string | undefined): number | undefined {
  if (!filePath) return undefined
  try {
    const stat = fs.statSync(filePath)
    const mtime = stat.mtimeMs
    if (!Number.isFinite(mtime)) return undefined
    return Math.floor(mtime)
  } catch {
    return undefined
  }
}

const VALID_CONNECTION_TYPES = new Set<string>(["internal", "acp", "stdio", "remote"])
const VALID_ROLES = new Set<string>(["user-profile", "delegation-target", "external-agent"])

// ============================================================================
// Directory / Path helpers
// ============================================================================

export function getAgentProfilesDir(layer: AgentsLayerPaths): string {
  return path.join(layer.agentsDir, AGENTS_AGENT_PROFILES_DIR)
}

export function getAgentProfilesBackupDir(layer: AgentsLayerPaths): string {
  return path.join(layer.backupsDir, AGENTS_AGENT_PROFILES_DIR)
}

export function agentProfileIdToDirPath(layer: AgentsLayerPaths, id: string): string {
  return path.join(getAgentProfilesDir(layer), sanitizeFileComponent(id))
}

export function agentProfileIdToFilePath(layer: AgentsLayerPaths, id: string): string {
  return path.join(agentProfileIdToDirPath(layer, id), AGENTS_PROFILE_CANONICAL_FILENAME)
}

export function agentProfileIdToConfigJsonPath(layer: AgentsLayerPaths, id: string): string {
  return path.join(agentProfileIdToDirPath(layer, id), AGENTS_PROFILE_CONFIG_FILENAME)
}



// ============================================================================
// config.json — complex nested config that doesn't fit in frontmatter
// ============================================================================

export type AgentProfileConfigJson = {
  toolConfig?: AgentProfileToolConfig
  modelConfig?: ProfileModelConfig
  skillsConfig?: ProfileSkillsConfig
  connection?: Partial<AgentProfileConnection>
}

function readConfigJson(configJsonPath: string, backupDir: string): AgentProfileConfigJson {
  return safeReadJsonFileSync<AgentProfileConfigJson>(configJsonPath, {
    backupDir,
    defaultValue: {},
  })
}

function writeConfigJson(
  configJsonPath: string,
  config: AgentProfileConfigJson,
  backupDir: string,
  maxBackups: number,
): void {
  // Only write if there's something to persist
  const hasContent =
    config.toolConfig ||
    config.modelConfig ||
    config.skillsConfig ||
    (config.connection && Object.keys(config.connection).length > 0)

  if (!hasContent) return

  safeWriteJsonFileSync(configJsonPath, config, {
    backupDir,
    maxBackups,
    pretty: true,
  })
}

// ============================================================================
// Stringify agent.md
// ============================================================================

export function stringifyAgentProfileMarkdown(profile: AgentProfile): string {
  const frontmatter: Record<string, string> = {
    kind: "agent",
    id: profile.id,
    name: normalizeSingleLine(profile.name),
    displayName: normalizeSingleLine(profile.displayName),
    enabled: String(profile.enabled),
    createdAt: String(profile.createdAt),
    updatedAt: String(profile.updatedAt),
  }

  if (profile.description) frontmatter.description = normalizeSingleLine(profile.description)
  if (profile.connection.type) frontmatter["connection-type"] = profile.connection.type
  if (profile.role) frontmatter.role = profile.role
  if (profile.isBuiltIn) frontmatter.isBuiltIn = "true"
  if (profile.isDefault) frontmatter.isDefault = "true"
  if (profile.isStateful) frontmatter.isStateful = "true"
  if (profile.autoSpawn) frontmatter.autoSpawn = "true"

  // Guidelines go in frontmatter as a single line (they're typically short)
  if (profile.guidelines) frontmatter.guidelines = normalizeSingleLine(profile.guidelines)

  // System prompt is the body (markdown content)
  return stringifyFrontmatterDocument({ frontmatter, body: profile.systemPrompt || "" })
}

// ============================================================================
// Parse agent.md
// ============================================================================

export function parseAgentProfileMarkdown(
  markdown: string,
  options: { fallbackId?: string; filePath?: string } = {},
): Partial<AgentProfile> | null {
  const { frontmatter: fm, body } = parseFrontmatterOrBody(markdown)

  const fallbackId = options.fallbackId?.trim()
  const id = (fm.id ?? "").trim() || fallbackId || (fm.name ?? "").trim()
  if (!id) return null

  const name = (fm.name ?? "").trim() || id
  const displayName = (fm.displayName ?? "").trim() || name

  const stableNow = tryGetFileMtimeMs(options.filePath) ?? Date.now()
  const createdAt = parseNumber(fm.createdAt, stableNow)
  const updatedAt = parseNumber(fm.updatedAt, createdAt)

  const connectionTypeRaw = (fm["connection-type"] ?? "internal").trim()
  const connectionType: AgentProfileConnectionType = VALID_CONNECTION_TYPES.has(connectionTypeRaw)
    ? (connectionTypeRaw as AgentProfileConnectionType)
    : "internal"

  const roleRaw = (fm.role ?? "").trim()
  const role: AgentProfileRole | undefined = VALID_ROLES.has(roleRaw)
    ? (roleRaw as AgentProfileRole)
    : undefined

  return {
    id,
    name,
    displayName,
    description: (fm.description ?? "").trim() || undefined,
    systemPrompt: body.trim() || undefined,
    guidelines: (fm.guidelines ?? "").trim() || undefined,
    connection: { type: connectionType },
    role,
    enabled: parseBoolean(fm.enabled, true),
    isBuiltIn: parseBoolean(fm.isBuiltIn, false) || undefined,
    isDefault: parseBoolean(fm.isDefault, false) || undefined,
    isStateful: parseBoolean(fm.isStateful, false) || undefined,
    autoSpawn: parseBoolean(fm.autoSpawn, false) || undefined,
    createdAt,
    updatedAt,
  }
}

// ============================================================================
// Assemble full AgentProfile from agent.md + config.json
// ============================================================================

function assembleAgentProfile(
  mdPartial: Partial<AgentProfile>,
  configJson: AgentProfileConfigJson,
): AgentProfile | null {
  if (!mdPartial.id) return null

  // Merge connection: frontmatter has `type`, config.json may have command/args/env/cwd/baseUrl
  const connection: AgentProfileConnection = {
    ...(configJson.connection ?? {}),
    type: mdPartial.connection?.type ?? "internal",
  }

  return {
    id: mdPartial.id,
    name: mdPartial.name ?? mdPartial.id,
    displayName: mdPartial.displayName ?? mdPartial.name ?? mdPartial.id,
    description: mdPartial.description,
    systemPrompt: mdPartial.systemPrompt,
    guidelines: mdPartial.guidelines,
    connection,
    role: mdPartial.role,
    enabled: mdPartial.enabled ?? true,
    isBuiltIn: mdPartial.isBuiltIn,
    isDefault: mdPartial.isDefault,
    isStateful: mdPartial.isStateful,
    autoSpawn: mdPartial.autoSpawn,
    isAgentTarget: mdPartial.role === "delegation-target" || mdPartial.role === "external-agent" || undefined,
    createdAt: mdPartial.createdAt ?? Date.now(),
    updatedAt: mdPartial.updatedAt ?? Date.now(),
    // From config.json
    toolConfig: configJson.toolConfig,
    modelConfig: configJson.modelConfig,
    skillsConfig: configJson.skillsConfig,
  }
}

// ============================================================================
// Load all agent profiles from a layer
// ============================================================================

export function loadAgentProfilesLayer(layer: AgentsLayerPaths): LoadedAgentProfilesLayer {
  const profiles: AgentProfile[] = []
  const originById = new Map<string, AgentProfileOrigin>()

  const profilesDir = getAgentProfilesDir(layer)

  try {
    if (!fs.existsSync(profilesDir) || !fs.statSync(profilesDir).isDirectory()) {
      return { profiles, originById }
    }

    const entries = fs.readdirSync(profilesDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith(".")) continue

      const agentDir = path.join(profilesDir, entry.name)
      const agentMdPath = path.join(agentDir, AGENTS_PROFILE_CANONICAL_FILENAME)
      const configJsonPath = path.join(agentDir, AGENTS_PROFILE_CONFIG_FILENAME)

      const raw = readTextFileIfExistsSync(agentMdPath, "utf8")
      if (raw === null) continue

      const mdPartial = parseAgentProfileMarkdown(raw, {
        fallbackId: entry.name,
        filePath: agentMdPath,
      })
      if (!mdPartial) continue

      const configJson = fs.existsSync(configJsonPath)
        ? readConfigJson(configJsonPath, getAgentProfilesBackupDir(layer))
        : {}

      const profile = assembleAgentProfile(mdPartial, configJson)
      if (!profile) continue

      // Deduplicate: keep newest updatedAt
      const existingOrigin = originById.get(profile.id)
      if (existingOrigin) {
        const existingProfile = profiles.find((p) => p.id === profile.id)
        if (existingProfile && existingProfile.updatedAt > profile.updatedAt) continue
        const idx = profiles.findIndex((p) => p.id === profile.id)
        if (idx >= 0) profiles[idx] = profile
      } else {
        profiles.push(profile)
      }

      originById.set(profile.id, {
        filePath: agentMdPath,
        configJsonPath: fs.existsSync(configJsonPath) ? configJsonPath : undefined,
      })
    }
  } catch {
    // best-effort
  }

  return { profiles, originById }
}

// ============================================================================
// Write a single agent profile to agent.md + config.json
// ============================================================================

export function writeAgentsProfileFiles(
  layer: AgentsLayerPaths,
  profile: AgentProfile,
  options: { maxBackups?: number } = {},
): void {
  const maxBackups = options.maxBackups ?? 10
  const backupDir = getAgentProfilesBackupDir(layer)

  const agentDir = agentProfileIdToDirPath(layer, profile.id)
  fs.mkdirSync(agentDir, { recursive: true })

  // 1. Write agent.md (frontmatter + system prompt body)
  const mdContent = stringifyAgentProfileMarkdown(profile)
  const mdPath = path.join(agentDir, AGENTS_PROFILE_CANONICAL_FILENAME)
  safeWriteFileSync(mdPath, mdContent, { backupDir, maxBackups })

  // 2. Write config.json (complex nested objects)
  const configJsonPath = path.join(agentDir, AGENTS_PROFILE_CONFIG_FILENAME)

  // Extract connection fields beyond `type` (type lives in frontmatter)
  const { type: _connType, ...connectionExtra } = profile.connection ?? {}

  const configJson: AgentProfileConfigJson = {
    ...(profile.toolConfig ? { toolConfig: profile.toolConfig } : {}),
    ...(profile.modelConfig ? { modelConfig: profile.modelConfig } : {}),
    ...(profile.skillsConfig ? { skillsConfig: profile.skillsConfig } : {}),
    ...(Object.keys(connectionExtra).length > 0 ? { connection: connectionExtra } : {}),
  }

  if (Object.keys(configJson).length > 0) {
    writeConfigJson(configJsonPath, configJson, backupDir, maxBackups)
  } else {
    // Clean up config.json if it exists but is no longer needed
    try {
      if (fs.existsSync(configJsonPath)) fs.unlinkSync(configJsonPath)
    } catch { /* best-effort */ }
  }
}

// ============================================================================
// Write all agent profiles for a layer
// ============================================================================

export function writeAllAgentsProfileFiles(
  layer: AgentsLayerPaths,
  profiles: AgentProfile[],
  options: { maxBackups?: number; onlyIfMissing?: boolean } = {},
): void {
  const profilesDir = getAgentProfilesDir(layer)
  fs.mkdirSync(profilesDir, { recursive: true })

  for (const profile of profiles) {
    if (options.onlyIfMissing) {
      const mdPath = agentProfileIdToFilePath(layer, profile.id)
      if (fs.existsSync(mdPath)) continue
    }
    writeAgentsProfileFiles(layer, profile, options)
  }
}

// ============================================================================
// Delete an agent profile's directory
// ============================================================================

export function deleteAgentProfileFiles(layer: AgentsLayerPaths, profileId: string): void {
  const agentDir = agentProfileIdToDirPath(layer, profileId)
  try {
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true, force: true })
    }
  } catch {
    // best-effort
  }
}

// ============================================================================
// Load merged agent profiles from global + optional workspace layer
// ============================================================================

export function loadMergedAgentProfiles(options: {
  globalAgentsDir: string
  workspaceAgentsDir: string | null
}): { profiles: AgentProfile[]; originById: Map<string, AgentProfileOrigin> } {
  const globalLayer = getAgentsLayerPaths(options.globalAgentsDir)
  const globalResult = loadAgentProfilesLayer(globalLayer)

  if (!options.workspaceAgentsDir) {
    return globalResult
  }

  const workspaceLayer = getAgentsLayerPaths(options.workspaceAgentsDir)
  const workspaceResult = loadAgentProfilesLayer(workspaceLayer)

  // Merge: workspace overrides global by ID
  const mergedById = new Map<string, AgentProfile>()
  const mergedOriginById = new Map<string, AgentProfileOrigin>()

  for (const profile of globalResult.profiles) {
    mergedById.set(profile.id, profile)
    const origin = globalResult.originById.get(profile.id)
    if (origin) mergedOriginById.set(profile.id, origin)
  }

  for (const profile of workspaceResult.profiles) {
    mergedById.set(profile.id, profile) // workspace wins
    const origin = workspaceResult.originById.get(profile.id)
    if (origin) mergedOriginById.set(profile.id, origin)
  }

  return {
    profiles: Array.from(mergedById.values()),
    originById: mergedOriginById,
  }
}