import { app } from "electron"
import path from "path"
import fs from "fs"
import { Config } from "@shared/types"

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
    mcpAutoPasteDelay: 1000, // 1 second delay by default
    mcpMaxIterations: 10, // Default max iterations for agent mode
    textInputEnabled: true,
    textInputShortcut: "ctrl-t",
    conversationsEnabled: true,
    maxConversationsToKeep: 100,
    autoSaveConversations: true,
    // Agent kill switch defaults
    agentKillSwitchEnabled: true,
    agentKillSwitchHotkey: "ctrl-shift-escape",
    // Wake word defaults
    wakeWord: {
      enabled: false,
      wakeWord: "hey computer",
      sensitivity: 0.5,
      recordingTimeout: 5,
      confirmationMode: false,
      accessKey: "",
    },
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
