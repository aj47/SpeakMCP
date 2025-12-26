import React, { useState, useEffect, useReducer } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Switch } from "@renderer/components/ui/switch"
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Card } from "@renderer/components/ui/card"
import { Upload, FileText } from "lucide-react"
import { Spinner } from "@renderer/components/ui/spinner"
import { MCPServerConfig, MCPTransportType, OAuthConfig } from "@shared/types"
import { toast } from "sonner"
import { OAuthServerConfig } from "../OAuthServerConfig"
import { OAUTH_MCP_EXAMPLES } from "@shared/oauth-examples"
import { parseShellCommand } from "@shared/shell-parse"

export interface ServerDialogProps {
  server?: { name: string; config: MCPServerConfig }
  onSave: (name: string, config: MCPServerConfig) => void
  onCancel: () => void
  onImportFromFile?: () => Promise<void>
  onImportFromText?: (text: string) => Promise<boolean>
  isOpen?: boolean
}

// Reserved server names that cannot be used by users (used for built-in functionality)
const RESERVED_SERVER_NAMES = ["speakmcp-settings"]

// Example MCP server configurations
const MCP_EXAMPLES: Record<string, { name: string; config: MCPServerConfig; note?: string }> = {
  github: {
    name: "github",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "your-github-token-here",
      },
    },
  },
  exa: {
    name: "exa",
    config: {
      transport: "streamableHttp" as MCPTransportType,
      url: "https://mcp.exa.ai/mcp",
    },
  },
  memory: {
    name: "memory",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      env: {},
    },
  },
  "sequential-thinking": {
    name: "sequential-thinking",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      env: {},
    },
  },
  "desktop-commander": {
    name: "desktop-commander",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
      env: {},
    },
  },
  filesystem: {
    name: "filesystem",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/allowed/directory",
      ],
      env: {},
    },
  },
  playwright: {
    name: "playwright",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
      env: {},
    },
  },
  "headless-terminal": {
    name: "headless-terminal",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "ht-mcp",
      args: [],
      env: {},
    },
  },
}

// Consolidated state interface using useReducer pattern
interface ServerFormState {
  name: string
  activeTab: 'manual' | 'file' | 'paste' | 'examples'
  jsonInputText: string
  isValidatingJson: boolean
  transport: MCPTransportType
  fullCommand: string
  url: string
  env: string
  timeout: string
  selectedExample: string
  disabled: boolean
  headers: string
  oauthConfig: OAuthConfig
}

type ServerFormAction =
  | { type: 'SET_NAME'; payload: string }
  | { type: 'SET_TAB'; payload: 'manual' | 'file' | 'paste' | 'examples' }
  | { type: 'SET_JSON_INPUT'; payload: string }
  | { type: 'SET_VALIDATING'; payload: boolean }
  | { type: 'SET_TRANSPORT'; payload: MCPTransportType }
  | { type: 'SET_COMMAND'; payload: string }
  | { type: 'SET_URL'; payload: string }
  | { type: 'SET_ENV'; payload: string }
  | { type: 'SET_TIMEOUT'; payload: string }
  | { type: 'SET_EXAMPLE'; payload: string }
  | { type: 'SET_DISABLED'; payload: boolean }
  | { type: 'SET_HEADERS'; payload: string }
  | { type: 'SET_OAUTH'; payload: OAuthConfig }
  | { type: 'LOAD_FROM_EXAMPLE'; payload: { name: string; config: MCPServerConfig; oauth?: OAuthConfig } }
  | { type: 'RESET_TO_DEFAULT'; payload?: { server?: { name: string; config: MCPServerConfig } } }

function serverFormReducer(state: ServerFormState, action: ServerFormAction): ServerFormState {
  switch (action.type) {
    case 'SET_NAME':
      return { ...state, name: action.payload }
    case 'SET_TAB':
      return { ...state, activeTab: action.payload }
    case 'SET_JSON_INPUT':
      return { ...state, jsonInputText: action.payload }
    case 'SET_VALIDATING':
      return { ...state, isValidatingJson: action.payload }
    case 'SET_TRANSPORT':
      return { ...state, transport: action.payload }
    case 'SET_COMMAND':
      return { ...state, fullCommand: action.payload }
    case 'SET_URL':
      return { ...state, url: action.payload }
    case 'SET_ENV':
      return { ...state, env: action.payload }
    case 'SET_TIMEOUT':
      return { ...state, timeout: action.payload }
    case 'SET_EXAMPLE':
      return { ...state, selectedExample: action.payload }
    case 'SET_DISABLED':
      return { ...state, disabled: action.payload }
    case 'SET_HEADERS':
      return { ...state, headers: action.payload }
    case 'SET_OAUTH':
      return { ...state, oauthConfig: action.payload }
    case 'LOAD_FROM_EXAMPLE':
      const { name, config, oauth } = action.payload
      const cmd = config.command || ""
      const args = config.args?.join(" ") || ""
      return {
        ...state,
        name,
        transport: config.transport,
        fullCommand: args ? `${cmd} ${args}` : cmd,
        url: config.url || "",
        env: config.env
          ? Object.entries(config.env)
              .map(([k, v]) => `${k}=${v}`)
              .join("\n")
          : "",
        timeout: config.timeout?.toString() || "",
        disabled: config.disabled || false,
        headers: config.headers
          ? Object.entries(config.headers)
              .map(([k, v]) => `${k}=${v}`)
              .join("\n")
          : "",
        oauthConfig: oauth || {},
        activeTab: 'manual'
      }
    case 'RESET_TO_DEFAULT':
      const server = action.payload?.server
      if (server) {
        const serverCmd = server.config.command
        const serverArgs = server.config.args ? server.config.args.join(" ") : ""
        return {
          name: server.name,
          activeTab: 'manual',
          jsonInputText: "",
          isValidatingJson: false,
          transport: server.config.transport,
          fullCommand: serverArgs ? `${serverCmd} ${serverArgs}` : serverCmd,
          url: server.config.url || "",
          env: server.config.env
            ? Object.entries(server.config.env)
                .map(([k, v]) => `${k}=${v}`)
                .join("\n")
            : "",
          timeout: server.config.timeout?.toString() || "",
          selectedExample: "",
          disabled: server.config.disabled || false,
          headers: server.config.headers
            ? Object.entries(server.config.headers)
                .map(([k, v]) => `${k}=${v}`)
                .join("\n")
            : "",
          oauthConfig: server.config.oauth || {},
        }
      }
      return {
        name: "",
        activeTab: 'examples',
        jsonInputText: "",
        isValidatingJson: false,
        transport: "stdio",
        fullCommand: "",
        url: "",
        env: "",
        timeout: "",
        selectedExample: "",
        disabled: false,
        headers: "",
        oauthConfig: {},
      }
    default:
      return state
  }
}

export function ServerDialog({ server, onSave, onCancel, onImportFromFile, onImportFromText, isOpen }: ServerDialogProps) {
  const [state, dispatch] = useReducer(serverFormReducer, {
    name: server?.name || "",
    activeTab: server ? 'manual' : 'examples',
    jsonInputText: "",
    isValidatingJson: false,
    transport: server?.config.transport || "stdio",
    fullCommand: (() => {
      if (server?.config.command) {
        const cmd = server.config.command
        const args = server.config.args ? server.config.args.join(" ") : ""
        return args ? `${cmd} ${args}` : cmd
      }
      return ""
    })(),
    url: server?.config.url || "",
    env: server?.config.env
      ? Object.entries(server.config.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
    timeout: server?.config.timeout?.toString() || "",
    selectedExample: "",
    disabled: server?.config.disabled || false,
    headers: server?.config.headers
      ? Object.entries(server.config.headers)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
    oauthConfig: server?.config.oauth || {},
  })

  // Reset all fields when server prop changes
  useEffect(() => {
    dispatch({ type: 'RESET_TO_DEFAULT', payload: { server } })
  }, [server])

  // Reset all form state when dialog opens or closes (for Add mode)
  useEffect(() => {
    if (!server) {
      dispatch({ type: 'RESET_TO_DEFAULT' })
    }
  }, [isOpen, server])

  const handleSave = () => {
    if (!state.name.trim()) {
      toast.error("Server name is required")
      return
    }

    // Check for reserved server names
    if (RESERVED_SERVER_NAMES.includes(state.name.trim().toLowerCase())) {
      toast.error(`Server name "${state.name.trim()}" is reserved and cannot be used`)
      return
    }

    // Validate based on transport type
    if (state.transport === "stdio") {
      if (!state.fullCommand.trim()) {
        toast.error("Command is required for stdio transport")
        return
      }
    } else if (state.transport === "websocket" || state.transport === "streamableHttp") {
      if (!state.url.trim()) {
        toast.error("URL is required for remote transport")
        return
      }
      // Basic URL validation
      try {
        new URL(state.url.trim())
      } catch (error) {
        toast.error("Invalid URL format")
        return
      }
    }

    const envObject: Record<string, string> = {}
    if (state.env.trim()) {
      try {
        state.env.split("\n").forEach((line) => {
          const [key, ...valueParts] = line.split("=")
          if (key && valueParts.length > 0) {
            envObject[key.trim()] = valueParts.join("=").trim()
          }
        })
      } catch (error) {
        toast.error("Invalid environment variables format")
        return
      }
    }

    const headersObject: Record<string, string> = {}
    if (state.headers.trim()) {
      try {
        state.headers.split("\n").forEach((line) => {
          const [key, ...valueParts] = line.split("=")
          if (key && valueParts.length > 0) {
            headersObject[key.trim()] = valueParts.join("=").trim()
          }
        })
      } catch (error) {
        toast.error("Invalid headers format")
        return
      }
    }

    // Parse the full command into command and args
    let parsedCommand = ""
    let parsedArgs: string[] = []
    if (state.transport === "stdio" && state.fullCommand.trim()) {
      const parsed = parseShellCommand(state.fullCommand.trim())
      parsedCommand = parsed.command
      parsedArgs = parsed.args
    }

    const serverConfig: MCPServerConfig = {
      transport: state.transport,
      ...(state.transport === "stdio" && {
        command: parsedCommand,
        args: parsedArgs,
      }),
      ...(state.transport !== "stdio" && {
        url: state.url.trim(),
      }),
      ...(Object.keys(envObject).length > 0 && { env: envObject }),
      ...(state.transport === "streamableHttp" && Object.keys(headersObject).length > 0 && { headers: headersObject }),
      ...(state.timeout && { timeout: parseInt(state.timeout) }),
      ...(state.disabled && { disabled: state.disabled }),
      ...(state.transport === "streamableHttp" && Object.keys(state.oauthConfig).length > 0 && { oauth: state.oauthConfig }),
    }

    onSave(state.name.trim(), serverConfig)
  }

  return (
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{server ? "Edit Server" : "Add Server"}</DialogTitle>
        <DialogDescription>
          Add or configure an MCP server
        </DialogDescription>
      </DialogHeader>

      <div className="w-full">
        <div className="flex space-x-1 mb-4">
          <Button
            variant={state.activeTab === 'manual' ? 'default' : 'outline'}
            onClick={() => dispatch({ type: 'SET_TAB', payload: 'manual' })}
            className="flex-1"
            size="sm"
          >
            Manual
          </Button>
          {!server && onImportFromFile && (
            <Button
              variant={state.activeTab === 'file' ? 'default' : 'outline'}
              onClick={() => dispatch({ type: 'SET_TAB', payload: 'file' })}
              className="flex-1"
              size="sm"
            >
              <Upload className="mr-1 h-3 w-3" />
              From File
            </Button>
          )}
          {!server && onImportFromText && (
            <Button
              variant={state.activeTab === 'paste' ? 'default' : 'outline'}
              onClick={() => dispatch({ type: 'SET_TAB', payload: 'paste' })}
              className="flex-1"
              size="sm"
            >
              <FileText className="mr-1 h-3 w-3" />
              Paste JSON
            </Button>
          )}
          <Button
            variant={state.activeTab === 'examples' ? 'default' : 'outline'}
            onClick={() => dispatch({ type: 'SET_TAB', payload: 'examples' })}
            className="flex-1"
            size="sm"
          >
            Examples
          </Button>
        </div>

        {/* Manual Configuration Tab */}
        {state.activeTab === 'manual' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server-name">Server Name</Label>
              <Input
                id="server-name"
                value={state.name}
                onChange={(e) => dispatch({ type: 'SET_NAME', payload: e.target.value })}
                placeholder="e.g., google-maps"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transport">Transport Type</Label>
              <Select
                value={state.transport}
                onValueChange={(value: MCPTransportType) => dispatch({ type: 'SET_TRANSPORT', payload: value })}
              >
                <SelectTrigger id="transport" className="border border-primary/40">
                  <SelectValue placeholder="Select transport type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">Local Command (stdio)</SelectItem>
                  <SelectItem value="websocket">WebSocket</SelectItem>
                  <SelectItem value="streamableHttp">Streamable HTTP</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose how to connect to the MCP server
              </p>
            </div>

            {state.transport === "stdio" ? (
              <div className="space-y-2">
                <Label htmlFor="fullCommand">Command</Label>
                <Input
                  id="fullCommand"
                  value={state.fullCommand}
                  onChange={(e) => dispatch({ type: 'SET_COMMAND', payload: e.target.value })}
                  placeholder="e.g., npx -y @modelcontextprotocol/server-google-maps"
                />
                <p className="text-xs text-muted-foreground">
                  Full command with arguments (space-separated)
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="url">Server URL</Label>
                <Input
                  id="url"
                  value={state.url}
                  onChange={(e) => dispatch({ type: 'SET_URL', payload: e.target.value })}
                  placeholder={
                    state.transport === "websocket"
                      ? "ws://localhost:8080"
                      : "http://localhost:8080"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {state.transport === "websocket"
                    ? "WebSocket URL (e.g., ws://localhost:8080 or wss://example.com/mcp)"
                    : "HTTP URL for streamable HTTP transport (e.g., http://localhost:8080/mcp)"}
                </p>
              </div>
            )}

            {state.transport === "streamableHttp" && (
              <div className="space-y-2">
                <Label htmlFor="headers">Custom HTTP Headers</Label>
                <Textarea
                  id="headers"
                  value={state.headers}
                  onChange={(e) => dispatch({ type: 'SET_HEADERS', payload: e.target.value })}
                  placeholder="X-API-Key=your-api-key&#10;User-Agent=MyApp/1.0&#10;Content-Type=application/json"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  One per line in Header-Name=value format. These headers will be included in all HTTP requests to the server.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="env">Environment Variables</Label>
              <Textarea
                id="env"
                value={state.env}
                onChange={(e) => dispatch({ type: 'SET_ENV', payload: e.target.value })}
                placeholder="API_KEY=your-key-here&#10;ANOTHER_VAR=value"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                One per line in KEY=value format
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (ms)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={state.timeout}
                  onChange={(e) => dispatch({ type: 'SET_TIMEOUT', payload: e.target.value })}
                  placeholder="60000"
                />
              </div>

              <div className="flex items-center space-x-2 pt-6">
                <Switch
                  id="disabled"
                  checked={state.disabled}
                  onCheckedChange={(checked) => dispatch({ type: 'SET_DISABLED', payload: checked })}
                />
                <Label htmlFor="disabled">Disabled</Label>
              </div>
            </div>

            {state.transport === "streamableHttp" && state.url && (
              <OAuthServerConfig
                serverName={state.name || "New Server"}
                serverUrl={state.url}
                oauthConfig={state.oauthConfig}
                onConfigChange={(config) => dispatch({ type: 'SET_OAUTH', payload: config })}
                onStartAuth={async () => {
                  if (!state.name) {
                    toast.error("Please save the server configuration first")
                    return
                  }
                  try {
                    await window.electronAPI.initiateOAuthFlow(state.name)
                    toast.success("OAuth authentication started. Please complete the flow in your browser.")
                  } catch (error) {
                    toast.error(`Failed to start OAuth flow: ${error instanceof Error ? error.message : String(error)}`)
                  }
                }}
                onRevokeAuth={async () => {
                  if (!state.name) return
                  try {
                    await window.electronAPI.revokeOAuthTokens(state.name)
                    toast.success("OAuth tokens revoked successfully")
                  } catch (error) {
                    toast.error(`Failed to revoke OAuth tokens: ${error instanceof Error ? error.message : String(error)}`)
                  }
                }}
                onTestConnection={async () => {
                  if (!state.name) {
                    toast.error("Please save the server configuration first")
                    return
                  }
                  try {
                    const envObject: Record<string, string> = {}
                    if (state.env.trim()) {
                      state.env.split("\n").forEach((line) => {
                        const [key, ...valueParts] = line.split("=")
                        if (key && valueParts.length > 0) {
                          envObject[key.trim()] = valueParts.join("=").trim()
                        }
                      })
                    }

                    const headersObject: Record<string, string> = {}
                    if (state.headers.trim()) {
                      state.headers.split("\n").forEach((line) => {
                        const [key, ...valueParts] = line.split("=")
                        if (key && valueParts.length > 0) {
                          headersObject[key.trim()] = valueParts.join("=").trim()
                        }
                      })
                    }

                    const testServerConfig: MCPServerConfig = { transport: state.transport }

                    if ((state.transport as string) === "stdio") {
                      const parsed = parseShellCommand(state.fullCommand.trim())
                      testServerConfig.command = parsed.command
                      testServerConfig.args = parsed.args
                    } else {
                      testServerConfig.url = state.url.trim()
                    }

                    if (Object.keys(envObject).length > 0) {
                      testServerConfig.env = envObject
                    }
                    if (state.transport === "streamableHttp" && Object.keys(headersObject).length > 0) {
                      testServerConfig.headers = headersObject
                    }
                    if (state.timeout) {
                      testServerConfig.timeout = parseInt(state.timeout)
                    }
                    if (state.disabled) {
                      testServerConfig.disabled = state.disabled
                    }
                    if (state.transport === "streamableHttp" && Object.keys(state.oauthConfig).length > 0) {
                      testServerConfig.oauth = state.oauthConfig
                    }

                    const result = await window.electronAPI.testMCPServer(state.name, testServerConfig)
                    if (result.success) {
                      toast.success("Connection test successful!")
                    } else {
                      toast.error(`Connection test failed: ${result.error}`)
                    }
                  } catch (error) {
                    toast.error(`Connection test failed: ${error instanceof Error ? error.message : String(error)}`)
                  }
                }}
              />
            )}
          </div>
        )}

        {/* From File Tab */}
        {state.activeTab === 'file' && onImportFromFile && (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Import from JSON file</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Select a JSON file containing MCP server configurations
              </p>
              <Button onClick={async () => {
                await onImportFromFile()
              }}>
                Choose File
              </Button>
            </div>
          </div>
        )}

        {/* Paste JSON Tab */}
        {state.activeTab === 'paste' && onImportFromText && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="json-text-dialog">Paste JSON Configuration</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    try {
                      const formatted = JSON.stringify(JSON.parse(state.jsonInputText), null, 2)
                      dispatch({ type: 'SET_JSON_INPUT', payload: formatted })
                    } catch {
                      // Ignore formatting errors
                    }
                  }}
                  disabled={!state.jsonInputText.trim()}
                >
                  Format
                </Button>
              </div>
              <Textarea
                id="json-text-dialog"
                value={state.jsonInputText}
                onChange={(e) => dispatch({ type: 'SET_JSON_INPUT', payload: e.target.value })}
                placeholder='{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"]
    }
  }
}'
                rows={12}
                className="font-mono text-sm whitespace-pre"
              />
              <p className="text-xs text-muted-foreground">
                Paste valid JSON configuration. New servers will be merged. Duplicate names will be replaced by imported versions.
              </p>
            </div>
            <Button
              onClick={async () => {
                dispatch({ type: 'SET_VALIDATING', payload: true })
                try {
                  const success = await onImportFromText(state.jsonInputText)
                  if (success) {
                    dispatch({ type: 'SET_JSON_INPUT', payload: "" })
                  }
                } finally {
                  dispatch({ type: 'SET_VALIDATING', payload: false })
                }
              }}
              disabled={state.isValidatingJson || !state.jsonInputText.trim()}
              className="w-full"
            >
              {state.isValidatingJson ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Validating...
                </>
              ) : (
                "Import Configuration"
              )}
            </Button>
          </div>
        )}

        {/* Examples Tab */}
        {state.activeTab === 'examples' && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground mb-4">
              Choose from popular MCP server configurations to get started quickly.
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {/* Standard MCP Examples */}
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Standard MCP Servers</h4>
                {Object.entries(MCP_EXAMPLES).map(([key, example]) => (
                  <Card key={key} className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h5 className="font-medium text-sm">{example.name}</h5>
                        <p className="text-xs text-muted-foreground mt-1">
                          {example.config.transport === "stdio"
                            ? `Command: ${example.config.command} ${example.config.args?.join(" ") || ""}`
                            : `URL: ${example.config.url}`
                          }
                        </p>
                        {example.config.env && Object.keys(example.config.env).length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Environment: {Object.keys(example.config.env).join(", ")}
                          </p>
                        )}
                        {example.note && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            {example.note}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          dispatch({
                            type: 'LOAD_FROM_EXAMPLE',
                            payload: { name: example.name, config: example.config }
                          })
                        }}
                      >
                        Use
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>

              {/* OAuth MCP Examples */}
              {Object.keys(OAUTH_MCP_EXAMPLES).length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">OAuth-Enabled MCP Servers</h4>
                  {Object.entries(OAUTH_MCP_EXAMPLES).map(([key, example]) => (
                    <Card key={key} className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h5 className="font-medium text-sm">{example.name}</h5>
                          <p className="text-xs text-muted-foreground mt-1">
                            {example.description}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            URL: {example.config.url}
                          </p>
                          {example.requiredScopes && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Scopes: {example.requiredScopes.join(", ")}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            dispatch({
                              type: 'LOAD_FROM_EXAMPLE',
                              payload: { name: example.name, config: example.config, oauth: example.config.oauth }
                            })
                          }}
                        >
                          Use
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {(state.activeTab === 'manual' || state.activeTab === 'examples') && (
          <Button onClick={handleSave}>{server ? "Update" : "Add"} Server</Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}
