import fs from "fs"
import path from "path"
import type { Config } from "@shared/types"
import {
  readTextFileIfExistsSync,
  safeReadJsonFileSync,
  safeWriteFileSync,
  safeWriteJsonFileSync,
} from "./safe-file"
import { parseFrontmatterOrBody, stringifyFrontmatterDocument } from "./frontmatter"

export const AGENTS_DIR_NAME = ".agents"
export const AGENTS_BACKUPS_DIR_NAME = ".backups"

export const AGENTS_SETTINGS_JSON = "speakmcp-settings.json"
export const AGENTS_MCP_JSON = "mcp.json"
export const AGENTS_MODELS_JSON = "models.json"

export const AGENTS_SYSTEM_PROMPT_MD = "system-prompt.md"
export const AGENTS_AGENTS_MD = "agents.md"

export const AGENTS_LAYOUTS_DIR = "layouts"
export const AGENTS_DEFAULT_LAYOUT_JSON = "ui.json"

export type AgentsLayerPaths = {
  agentsDir: string
  backupsDir: string
  settingsJsonPath: string
  mcpJsonPath: string
  modelsJsonPath: string
  layoutsDir: string
  layoutJsonPath: string
  systemPromptMdPath: string
  agentsMdPath: string
}

export function getAgentsLayerPaths(agentsDir: string): AgentsLayerPaths {
  return {
    agentsDir,
    backupsDir: path.join(agentsDir, AGENTS_BACKUPS_DIR_NAME),
    settingsJsonPath: path.join(agentsDir, AGENTS_SETTINGS_JSON),
    mcpJsonPath: path.join(agentsDir, AGENTS_MCP_JSON),
    modelsJsonPath: path.join(agentsDir, AGENTS_MODELS_JSON),
    layoutsDir: path.join(agentsDir, AGENTS_LAYOUTS_DIR),
    layoutJsonPath: path.join(agentsDir, AGENTS_LAYOUTS_DIR, AGENTS_DEFAULT_LAYOUT_JSON),
    systemPromptMdPath: path.join(agentsDir, AGENTS_SYSTEM_PROMPT_MD),
    agentsMdPath: path.join(agentsDir, AGENTS_AGENTS_MD),
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

export function layerHasAnyAgentsConfig(layer: AgentsLayerPaths): boolean {
  return (
    fileExists(layer.settingsJsonPath) ||
    fileExists(layer.mcpJsonPath) ||
    fileExists(layer.modelsJsonPath) ||
    fileExists(layer.layoutJsonPath) ||
    fileExists(layer.systemPromptMdPath) ||
    fileExists(layer.agentsMdPath)
  )
}

function readAgentsMarkdownBody(filePath: string): string | null {
  const raw = readTextFileIfExistsSync(filePath, "utf8")
  if (raw === null) return null
  return parseFrontmatterOrBody(raw).body
}

function normalizePromptForConfig(promptBody: string, defaultSystemPrompt: string): string {
  const bodyTrim = promptBody.trim()
  if (!bodyTrim) return ""
  if (bodyTrim === defaultSystemPrompt.trim()) return ""
  return promptBody
}

export function loadAgentsLayerConfig(layer: AgentsLayerPaths, defaultSystemPrompt: string): Partial<Config> {
  const settings = safeReadJsonFileSync<Partial<Config>>(layer.settingsJsonPath, {
    backupDir: layer.backupsDir,
    defaultValue: {},
  })
  const mcp = safeReadJsonFileSync<Partial<Config>>(layer.mcpJsonPath, {
    backupDir: layer.backupsDir,
    defaultValue: {},
  })
  const models = safeReadJsonFileSync<Partial<Config>>(layer.modelsJsonPath, {
    backupDir: layer.backupsDir,
    defaultValue: {},
  })
  const layout = safeReadJsonFileSync<Partial<Config>>(layer.layoutJsonPath, {
    backupDir: layer.backupsDir,
    defaultValue: {},
  })

  const systemPromptBody = readAgentsMarkdownBody(layer.systemPromptMdPath)
  const agentsGuidelinesBody = readAgentsMarkdownBody(layer.agentsMdPath)

  const promptConfig: Partial<Config> = {}
  if (systemPromptBody !== null) {
    promptConfig.mcpCustomSystemPrompt = normalizePromptForConfig(systemPromptBody, defaultSystemPrompt)
  }
  if (agentsGuidelinesBody !== null) {
    promptConfig.mcpToolsSystemPrompt = agentsGuidelinesBody
  }

  return { ...settings, ...models, ...mcp, ...layout, ...promptConfig }
}

export function loadMergedAgentsConfig(
  options: {
    globalAgentsDir: string
    workspaceAgentsDir?: string | null
  },
  defaultSystemPrompt: string,
): { merged: Partial<Config>; hasAnyAgentsFiles: boolean } {
  const globalLayer = getAgentsLayerPaths(options.globalAgentsDir)
  const workspaceLayer = options.workspaceAgentsDir
    ? getAgentsLayerPaths(options.workspaceAgentsDir)
    : null

  const globalHas = layerHasAnyAgentsConfig(globalLayer)
  const workspaceHas = workspaceLayer ? layerHasAnyAgentsConfig(workspaceLayer) : false

  const globalConfig = globalHas
    ? loadAgentsLayerConfig(globalLayer, defaultSystemPrompt)
    : ({} as Partial<Config>)
  const workspaceConfig = workspaceHas && workspaceLayer
    ? loadAgentsLayerConfig(workspaceLayer, defaultSystemPrompt)
    : ({} as Partial<Config>)

  return {
    merged: { ...globalConfig, ...workspaceConfig },
    hasAnyAgentsFiles: globalHas || workspaceHas,
  }
}

function ensureDirSync(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
}

const LAYOUT_KEYS = new Set<string>([
  "themePreference",
  "panelPosition",
  "panelCustomPosition",
  "panelDragEnabled",
  "panelCustomSize",
  "panelProgressSize",
  "floatingPanelAutoShow",
  "hidePanelWhenMainFocused",
])

function isModelsKey(key: string): boolean {
  if (key === "modelPresets" || key === "currentModelPresetId") return true

  if (key.endsWith("ApiKey") || key.endsWith("BaseUrl")) return true

  // Provider/model configuration buckets
  return (
    key.startsWith("openai") ||
    key.startsWith("groq") ||
    key.startsWith("gemini") ||
    key.startsWith("stt") ||
    key.startsWith("tts") ||
    key.startsWith("parakeet") ||
    key.startsWith("kitten") ||
    key.startsWith("supertonic") ||
    key.startsWith("transcript")
  )
}

export type SplitAgentsConfig = {
  settings: Partial<Config>
  mcp: Partial<Config>
  models: Partial<Config>
  layout: Partial<Config>
  prompts: {
    systemPrompt: string
    agentsGuidelines: string
  }
}

export function splitConfigIntoAgentsFiles(config: Config): SplitAgentsConfig {
  const settings: Partial<Config> = {}
  const mcp: Partial<Config> = {}
  const models: Partial<Config> = {}
  const layout: Partial<Config> = {}

  const prompts = {
    systemPrompt: config.mcpCustomSystemPrompt ?? "",
    agentsGuidelines: config.mcpToolsSystemPrompt ?? "",
  }

  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (key === "mcpCustomSystemPrompt" || key === "mcpToolsSystemPrompt") continue

    if (LAYOUT_KEYS.has(key)) {
      ;(layout as any)[key] = value
      continue
    }

    if (key.startsWith("mcp")) {
      ;(mcp as any)[key] = value
      continue
    }

    if (isModelsKey(key)) {
      ;(models as any)[key] = value
      continue
    }

    ;(settings as any)[key] = value
  }

  return { settings, mcp, models, layout, prompts }
}

export function writeAgentsLayerFromConfig(
  layer: AgentsLayerPaths,
  config: Config,
  defaultSystemPrompt: string,
  options: { onlyIfMissing?: boolean; maxBackups?: number } = {},
): void {
  const onlyIfMissing = options.onlyIfMissing === true
  const maxBackups = options.maxBackups ?? 10

  ensureDirSync(layer.agentsDir)
  ensureDirSync(layer.layoutsDir)

  const split = splitConfigIntoAgentsFiles(config)

  const writeJsonIfNeeded = (filePath: string, value: unknown) => {
    if (onlyIfMissing && fileExists(filePath)) return
    safeWriteJsonFileSync(filePath, value, {
      backupDir: layer.backupsDir,
      maxBackups,
      pretty: true,
    })
  }

  writeJsonIfNeeded(layer.settingsJsonPath, split.settings)
  writeJsonIfNeeded(layer.mcpJsonPath, split.mcp)
  writeJsonIfNeeded(layer.modelsJsonPath, split.models)
  writeJsonIfNeeded(layer.layoutJsonPath, split.layout)

  const effectiveSystemPrompt = split.prompts.systemPrompt?.trim()
    ? split.prompts.systemPrompt
    : defaultSystemPrompt
  const systemPromptMd = stringifyFrontmatterDocument({
    frontmatter: { kind: "system-prompt" },
    body: effectiveSystemPrompt,
  })

  const agentsMd = stringifyFrontmatterDocument({
    frontmatter: { kind: "agents" },
    body: split.prompts.agentsGuidelines || "",
  })

  if (!onlyIfMissing || !fileExists(layer.systemPromptMdPath)) {
    safeWriteFileSync(layer.systemPromptMdPath, systemPromptMd, {
      backupDir: layer.backupsDir,
      maxBackups,
      encoding: "utf8",
    })
  }

  if (!onlyIfMissing || !fileExists(layer.agentsMdPath)) {
    safeWriteFileSync(layer.agentsMdPath, agentsMd, {
      backupDir: layer.backupsDir,
      maxBackups,
      encoding: "utf8",
    })
  }
}

/**
 * Find a `.agents` directory by walking upward from `startDir`.
 * Returns the full path to the `.agents` directory (not the repo root).
 */
export function findAgentsDirUpward(startDir: string, maxDepth: number = 25): string | null {
  let current = path.resolve(startDir)

  for (let i = 0; i < maxDepth; i++) {
    const candidate = path.join(current, AGENTS_DIR_NAME)
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
    } catch {
      // ignore
    }

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}
