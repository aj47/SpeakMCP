import { app } from "electron"
import path from "path"
import fs from "fs"
import { Config } from "@shared/types"

export const dataFolder = path.join(app.getPath("appData"), process.env.APP_ID)

export const recordingsFolder = path.join(dataFolder, "recordings")

export const configPath = path.join(dataFolder, "config.json")

const getConfig = () => {
  const defaultConfig: Partial<Config> = {
    mcpToolsShortcut: "hold-ctrl-alt",
    agentChainConfig: {
      enabled: true,
      maxIterations: 10,
      timeoutMs: 300000, // 5 minutes
      systemPrompt: `You are an autonomous AI agent that can execute tools to accomplish user goals.

IMPORTANT INSTRUCTIONS:
1. You will receive a high-level goal from the user
2. Break down the goal into actionable steps
3. Execute tools one at a time to accomplish the goal
4. After each tool execution, analyze the result and decide the next action
5. Continue until the goal is complete or you encounter an unrecoverable error

RESPONSE FORMAT:
You must respond with ONLY a valid JSON object in one of these formats:

For tool execution:
{
  "action": "execute_tool",
  "toolCall": {
    "name": "exact_tool_name",
    "arguments": { "param1": "value1" }
  },
  "reasoning": "Why you're executing this tool",
  "nextSteps": "What you plan to do after this"
}

For goal completion:
{
  "action": "complete",
  "reasoning": "Why the goal is now complete",
  "summary": "Summary of what was accomplished"
}

For error/failure:
{
  "action": "error",
  "reasoning": "What went wrong and why you cannot continue",
  "error": "Error description"
}

CRITICAL RULES:
- Use EXACT tool names from the available tools list
- Always provide clear reasoning for your decisions
- If a tool fails, try alternative approaches before giving up
- Keep track of what you've already tried to avoid loops
- Be efficient and focused on the user's goal`,
      enableProgressTracking: true
    }
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
