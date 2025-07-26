import { app } from "electron"
import path from "path"
import fs from "fs"
import { Config } from "@shared/types"
import { DEFAULT_CONFIG } from "@shared/constants"

export const dataFolder = path.join(app.getPath("appData"), process.env.APP_ID)

export const recordingsFolder = path.join(dataFolder, "recordings")

export const conversationsFolder = path.join(dataFolder, "conversations")

export const configPath = path.join(dataFolder, "config.json")

const getConfig = () => {
  const defaultConfig: Partial<Config> = {
    mcpToolsShortcut: "hold-ctrl-alt",
    mcpToolsEnabled: true,
    mcpAgentModeEnabled: true,
    mcpAutoPasteEnabled: true,
    mcpAutoPasteDelay: DEFAULT_CONFIG.MCP_AUTO_PASTE_DELAY,
    mcpMaxIterations: DEFAULT_CONFIG.MCP_MAX_ITERATIONS,
    textInputEnabled: true,
    textInputShortcut: "ctrl-t",
    conversationsEnabled: true,
    maxConversationsToKeep: DEFAULT_CONFIG.MAX_CONVERSATIONS_TO_KEEP,
    autoSaveConversations: true,
  }

  try {
    const savedConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as Config
    return { ...defaultConfig, ...savedConfig }
  } catch {
    return defaultConfig
  }
}

class ConfigStore {
  config: Config | undefined

  constructor() {
    this.config = getConfig()
  }

  get() {
    return this.config || {}
  }

  save(config: Config) {
    this.config = config
    fs.mkdirSync(dataFolder, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config))
  }
}

export const configStore = new ConfigStore()
