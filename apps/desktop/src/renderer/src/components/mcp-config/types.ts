export interface DetailedTool {
  name: string
  description: string
  serverName: string
  enabled: boolean
  inputSchema: any
}

// Reserved server names that cannot be used by users (used for built-in functionality)
export const RESERVED_SERVER_NAMES = ["speakmcp-settings"]

// Built-in server name - always enabled regardless of profile config
export const BUILTIN_SERVER_NAME = "speakmcp-settings"
