import React, { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Switch } from "@renderer/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Badge } from "@renderer/components/ui/badge"
import {
  Trash2,
  Edit,
  Plus,
  Upload,
  Download,
  Server,
  CheckCircle,
  XCircle,
  AlertCircle,
  BookOpen,
  RotateCcw,
  Square,
  Play,
  ExternalLink,
  FileText,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronsUpDown,
  Terminal,
  Trash,
  Search,
  Eye,
  EyeOff,
  Power,
  PowerOff,
  Wrench,
} from "lucide-react"
import { Spinner } from "@renderer/components/ui/spinner"
import { MCPConfig, MCPServerConfig, MCPTransportType, OAuthConfig, ServerLogEntry } from "@shared/types"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"
import { OAuthServerConfig } from "./OAuthServerConfig"
import { OAUTH_MCP_EXAMPLES, getOAuthExample } from "@shared/oauth-examples"
import { parseShellCommand } from "@shared/shell-parse"

interface DetailedTool {
  name: string
  description: string
  serverName: string
  enabled: boolean
  inputSchema: any
}

interface MCPConfigManagerProps {
  config: MCPConfig
  onConfigChange: (config: MCPConfig) => void
}

interface ServerDialogProps {
  server?: { name: string; config: MCPServerConfig }
  onSave: (name: string, config: MCPServerConfig) => void
  onCancel: () => void
  // Import functionality props (only needed for Add mode, not Edit mode)
  onImportFromFile?: () => Promise<void>
  // Returns true on success, false on failure (to preserve user input on errors)
  onImportFromText?: (text: string) => Promise<boolean>
  // Used to trigger state reset when dialog opens/closes (for Add mode where server prop doesn't change)
  isOpen?: boolean
}

function ServerDialog({ server, onSave, onCancel, onImportFromFile, onImportFromText, isOpen }: ServerDialogProps) {
  const [name, setName] = useState(server?.name || "")
  const [activeTab, setActiveTab] = useState<'manual' | 'file' | 'paste' | 'examples'>('manual')
  const [jsonInputText, setJsonInputText] = useState("")
  const [isValidatingJson, setIsValidatingJson] = useState(false)
  const [transport, setTransport] = useState<MCPTransportType>(
    server?.config.transport || "stdio",
  )
  const [fullCommand, setFullCommand] = useState(() => {
    if (server?.config.command) {
      const cmd = server.config.command
      const args = server.config.args ? server.config.args.join(" ") : ""
      return args ? `${cmd} ${args}` : cmd
    }
    return ""
  })
  const [url, setUrl] = useState(server?.config.url || "")
  const [env, setEnv] = useState(
    server?.config.env
      ? Object.entries(server.config.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
  )
  const [timeout, setTimeout] = useState(
    server?.config.timeout?.toString() || "",
  )
  const [selectedExample, setSelectedExample] = useState<string>("")
  const [disabled, setDisabled] = useState(server?.config.disabled || false)
  const [headers, setHeaders] = useState(
    server?.config.headers
      ? Object.entries(server.config.headers)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
  )
  const [oauthConfig, setOAuthConfig] = useState<OAuthConfig>(
    server?.config.oauth || {}
  )
  // OAuth configuration is automatically shown for streamableHttp transport

  // Reset all fields when server prop changes (e.g., when switching from edit to add)
  useEffect(() => {
    setName(server?.name || "")
    setActiveTab('manual')
    setJsonInputText("")  // Clear pasted JSON to prevent data/secrets from persisting across dialog close/open
    setTransport(server?.config.transport || "stdio")

    // Combine command and args for editing, or reset to empty
    if (server?.config.command) {
      const cmd = server.config.command
      const args = server.config.args ? server.config.args.join(" ") : ""
      setFullCommand(args ? `${cmd} ${args}` : cmd)
    } else {
      setFullCommand("")
    }

    setUrl(server?.config.url || "")
    setEnv(
      server?.config.env
        ? Object.entries(server.config.env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : ""
    )
    setTimeout(server?.config.timeout?.toString() || "")
    setSelectedExample("")
    setDisabled(server?.config.disabled || false)
    setHeaders(
      server?.config.headers
        ? Object.entries(server.config.headers)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : ""
    )
    setOAuthConfig(server?.config.oauth || {})
  }, [server])

  // Reset all form state when dialog opens or closes (for Add mode where server prop stays undefined)
  // This ensures sensitive data (JSON, env vars, headers, OAuth secrets) is cleared after Cancel/close
  // and prevents stale values from flashing when the dialog reopens
  useEffect(() => {
    if (!server) {
      // Only reset for Add mode (server is undefined)
      // Edit mode is handled by the server dependency useEffect above
      setName("")
      setActiveTab('manual')
      setJsonInputText("")
      setIsValidatingJson(false) // Reset validation state to prevent UI getting stuck
      setTransport("stdio")
      setFullCommand("")
      setUrl("")
      setEnv("")
      setTimeout("")
      setSelectedExample("")
      setDisabled(false)
      setHeaders("")
      setOAuthConfig({})
    }
  }, [isOpen, server])

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Server name is required")
      return
    }

    // Validate based on transport type
    if (transport === "stdio") {
      if (!fullCommand.trim()) {
        toast.error("Command is required for stdio transport")
        return
      }
    } else if (transport === "websocket" || transport === "streamableHttp") {
      if (!url.trim()) {
        toast.error("URL is required for remote transport")
        return
      }
      // Basic URL validation
      try {
        new URL(url.trim())
      } catch (error) {
        toast.error("Invalid URL format")
        return
      }
    }

    const envObject: Record<string, string> = {}
    if (env.trim()) {
      try {
        env.split("\n").forEach((line) => {
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
    if (headers.trim()) {
      try {
        headers.split("\n").forEach((line) => {
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
    if (transport === "stdio" && fullCommand.trim()) {
      const parsed = parseShellCommand(fullCommand.trim())
      parsedCommand = parsed.command
      parsedArgs = parsed.args
    }

    const serverConfig: MCPServerConfig = {
      transport,
      ...(transport === "stdio" && {
        command: parsedCommand,
        args: parsedArgs,
      }),
      ...(transport !== "stdio" && {
        url: url.trim(),
      }),
      ...(Object.keys(envObject).length > 0 && { env: envObject }),
      ...(transport === "streamableHttp" && Object.keys(headersObject).length > 0 && { headers: headersObject }),
      ...(timeout && { timeout: parseInt(timeout) }),
      ...(disabled && { disabled }),
      ...(transport === "streamableHttp" && Object.keys(oauthConfig).length > 0 && { oauth: oauthConfig }),
    }

    onSave(name.trim(), serverConfig)
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
            variant={activeTab === 'manual' ? 'default' : 'outline'}
            onClick={() => setActiveTab('manual')}
            className="flex-1"
            size="sm"
          >
            Manual
          </Button>
          {/* Only show import tabs when adding a new server (not editing) */}
          {!server && onImportFromFile && (
            <Button
              variant={activeTab === 'file' ? 'default' : 'outline'}
              onClick={() => setActiveTab('file')}
              className="flex-1"
              size="sm"
            >
              <Upload className="mr-1 h-3 w-3" />
              From File
            </Button>
          )}
          {!server && onImportFromText && (
            <Button
              variant={activeTab === 'paste' ? 'default' : 'outline'}
              onClick={() => setActiveTab('paste')}
              className="flex-1"
              size="sm"
            >
              <FileText className="mr-1 h-3 w-3" />
              Paste JSON
            </Button>
          )}
          <Button
            variant={activeTab === 'examples' ? 'default' : 'outline'}
            onClick={() => setActiveTab('examples')}
            className="flex-1"
            size="sm"
          >
            Examples
          </Button>
        </div>

        {/* Manual Configuration Tab */}
        {activeTab === 'manual' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server-name">Server Name</Label>
              <Input
                id="server-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., google-maps"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transport">Transport Type</Label>
              <Select
                value={transport}
                onValueChange={(value: MCPTransportType) => setTransport(value)}
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

            {transport === "stdio" ? (
              <div className="space-y-2">
                <Label htmlFor="fullCommand">Command</Label>
                <Input
                  id="fullCommand"
                  value={fullCommand}
                  onChange={(e) => setFullCommand(e.target.value)}
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
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={
                    transport === "websocket"
                      ? "ws://localhost:8080"
                      : "http://localhost:8080"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {transport === "websocket"
                    ? "WebSocket URL (e.g., ws://localhost:8080 or wss://example.com/mcp)"
                    : "HTTP URL for streamable HTTP transport (e.g., http://localhost:8080/mcp)"}
                </p>
              </div>
            )}

            {/* Custom Headers - only shown for streamableHttp transport */}
            {transport === "streamableHttp" && (
              <div className="space-y-2">
                <Label htmlFor="headers">Custom HTTP Headers</Label>
                <Textarea
                  id="headers"
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
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
                value={env}
                onChange={(e) => setEnv(e.target.value)}
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
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                  placeholder="60000"
                />
              </div>

              <div className="flex items-center space-x-2 pt-6">
                <Switch
                  id="disabled"
                  checked={disabled}
                  onCheckedChange={setDisabled}
                />
                <Label htmlFor="disabled">Disabled</Label>
              </div>
            </div>

            {/* OAuth Configuration - automatically shown for streamableHttp transport */}
            {transport === "streamableHttp" && url && (
              <OAuthServerConfig
                serverName={name || "New Server"}
                serverUrl={url}
                oauthConfig={oauthConfig}
                onConfigChange={setOAuthConfig}
                onStartAuth={async () => {
                  if (!name) {
                    toast.error("Please save the server configuration first")
                    return
                  }
                  try {
                    await window.electronAPI.initiateOAuthFlow(name)
                    toast.success("OAuth authentication started. Please complete the flow in your browser.")
                  } catch (error) {
                    toast.error(`Failed to start OAuth flow: ${error instanceof Error ? error.message : String(error)}`)
                  }
                }}
                onRevokeAuth={async () => {
                  if (!name) return
                  try {
                    await window.electronAPI.revokeOAuthTokens(name)
                    toast.success("OAuth tokens revoked successfully")
                  } catch (error) {
                    toast.error(`Failed to revoke OAuth tokens: ${error instanceof Error ? error.message : String(error)}`)
                  }
                }}
                onTestConnection={async () => {
                  if (!name) {
                    toast.error("Please save the server configuration first")
                    return
                  }
                  try {
                    // Create server config for testing
                    const envObject: Record<string, string> = {}
                    if (env.trim()) {
                      env.split("\n").forEach((line) => {
                        const [key, ...valueParts] = line.split("=")
                        if (key && valueParts.length > 0) {
                          envObject[key.trim()] = valueParts.join("=").trim()
                        }
                      })
                    }

                    const headersObject: Record<string, string> = {}
                    if (headers.trim()) {
                      headers.split("\n").forEach((line) => {
                        const [key, ...valueParts] = line.split("=")
                        if (key && valueParts.length > 0) {
                          headersObject[key.trim()] = valueParts.join("=").trim()
                        }
                      })
                    }

                    const testServerConfig: MCPServerConfig = { transport }

                    if ((transport as string) === "stdio") {
                      const parsed = parseShellCommand(fullCommand.trim())
                      testServerConfig.command = parsed.command
                      testServerConfig.args = parsed.args
                    } else {
                      testServerConfig.url = url.trim()
                    }

                    if (Object.keys(envObject).length > 0) {
                      testServerConfig.env = envObject
                    }
                    if (transport === "streamableHttp" && Object.keys(headersObject).length > 0) {
                      testServerConfig.headers = headersObject
                    }
                    if (timeout) {
                      testServerConfig.timeout = parseInt(timeout)
                    }
                    if (disabled) {
                      testServerConfig.disabled = disabled
                    }
                    if (transport === "streamableHttp" && Object.keys(oauthConfig).length > 0) {
                      testServerConfig.oauth = oauthConfig
                    }

                    const result = await window.electronAPI.testMCPServer(name, testServerConfig)
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
        {activeTab === 'file' && onImportFromFile && (
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
        {activeTab === 'paste' && onImportFromText && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="json-text-dialog">Paste JSON Configuration</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    try {
                      const formatted = JSON.stringify(JSON.parse(jsonInputText), null, 2)
                      setJsonInputText(formatted)
                    } catch {
                      // Ignore formatting errors
                    }
                  }}
                  disabled={!jsonInputText.trim()}
                >
                  Format
                </Button>
              </div>
              <Textarea
                id="json-text-dialog"
                value={jsonInputText}
                onChange={(e) => setJsonInputText(e.target.value)}
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
                setIsValidatingJson(true)
                try {
                  const success = await onImportFromText(jsonInputText)
                  // Only clear input on successful import to preserve user input on errors
                  if (success) {
                    setJsonInputText("")
                  }
                } finally {
                  setIsValidatingJson(false)
                }
              }}
              disabled={isValidatingJson || !jsonInputText.trim()}
              className="w-full"
            >
              {isValidatingJson ? (
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
        {activeTab === 'examples' && (
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
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setName(example.name)
                          setTransport(example.config.transport)
                          // Combine command and args into fullCommand
                          const cmd = example.config.command || ""
                          const args = example.config.args?.join(" ") || ""
                          setFullCommand(args ? `${cmd} ${args}` : cmd)
                          setUrl(example.config.url || "")
                          setEnv(
                            example.config.env
                              ? Object.entries(example.config.env)
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join("\n")
                              : ""
                          )
                          setTimeout(example.config.timeout?.toString() || "")
                          setDisabled(example.config.disabled || false)
                          setActiveTab('manual')
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
                            setName(example.name)
                            setTransport(example.config.transport)
                            // Combine command and args into fullCommand
                            const cmd = example.config.command || ""
                            const args = example.config.args?.join(" ") || ""
                            setFullCommand(args ? `${cmd} ${args}` : cmd)
                            setUrl(example.config.url || "")
                            setEnv(
                              example.config.env
                                ? Object.entries(example.config.env)
                                    .map(([k, v]) => `${k}=${v}`)
                                    .join("\n")
                                : ""
                            )
                            setTimeout(example.config.timeout?.toString() || "")
                            setDisabled(example.config.disabled || false)
                            setOAuthConfig(example.config.oauth || {})
                            setActiveTab('manual')
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
        {/* Only show Add/Update Server button on manual and examples tabs */}
        {/* File and paste tabs have their own action buttons */}
        {(activeTab === 'manual' || activeTab === 'examples') && (
          <Button onClick={handleSave}>{server ? "Update" : "Add"} Server</Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}

// Example MCP server configurations
const MCP_EXAMPLES: Record<string, { name: string; config: MCPServerConfig }> = {
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
  "mem0": {
    name: "mem0",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@pinkpixel/mem0-mcp"],
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

export function MCPConfigManager({
  config,
  onConfigChange,
}: MCPConfigManagerProps) {
  const [editingServer, setEditingServer] = useState<{
    name: string
    config: MCPServerConfig
  } | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const [serverStatus, setServerStatus] = useState<
    Record<
      string,
      {
        connected: boolean
        toolCount: number
        error?: string
        runtimeEnabled?: boolean
        configDisabled?: boolean
      }
    >
  >({})
  const [initializationStatus, setInitializationStatus] = useState<{
    isInitializing: boolean
    progress: { current: number; total: number; currentServer?: string }
  }>({ isInitializing: false, progress: { current: 0, total: 0 } })
  const [oauthStatus, setOAuthStatus] = useState<Record<string, { configured: boolean; authenticated: boolean; tokenExpiry?: number; error?: string }>>({})
  const [serverLogs, setServerLogs] = useState<Record<string, ServerLogEntry[]>>({})
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  // Tool management state
  const [tools, setTools] = useState<DetailedTool[]>([])
  const [toolSearchQuery, setToolSearchQuery] = useState("")
  const [showDisabledTools, setShowDisabledTools] = useState(true)
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  // Define servers early so it can be used in hooks below
  const servers = config.mcpServers || {}

  // Prune stale entries from expandedServers when servers change
  useEffect(() => {
    const serverNames = new Set(Object.keys(servers))
    const prunedSet = new Set([...expandedServers].filter(name => serverNames.has(name)))
    if (prunedSet.size !== expandedServers.size) {
      setExpandedServers(prunedSet)
    }
  }, [servers])

  // Load OAuth status for all servers
  const refreshOAuthStatus = async (serverName?: string) => {
    try {
      if (serverName) {
        const status = await window.electronAPI.getOAuthStatus(serverName)
        setOAuthStatus(prev => ({ ...prev, [serverName]: status }))
      } else {
        // Load status for all servers
        const newStatus: Record<string, any> = {}
        for (const [name, config] of Object.entries(servers)) {
          if (config.transport === "streamableHttp" && config.url) {
            const status = await window.electronAPI.getOAuthStatus(name)
            newStatus[name] = status
          }
        }
        setOAuthStatus(newStatus)
      }
    } catch (error) {
      console.error('Failed to load OAuth status:', error)
    }
  }

  // Fetch logs for expanded servers
  const fetchLogsForServer = async (serverName: string) => {
    try {
      const logs = await tipcClient.getMcpServerLogs({ serverName })
      setServerLogs(prev => ({ ...prev, [serverName]: logs as ServerLogEntry[] }))
    } catch (error) {
      console.error(`Failed to fetch logs for ${serverName}:`, error)
    }
  }

  // Fetch server status and initialization status periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [status, initStatus] = await Promise.all([
          tipcClient.getMcpServerStatus({}),
          tipcClient.getMcpInitializationStatus({}),
        ])
        setServerStatus(status as any)
        setInitializationStatus(initStatus as any)
        await refreshOAuthStatus()

        // Fetch logs for expanded servers
        for (const serverName of expandedLogs) {
          await fetchLogsForServer(serverName)
        }
      } catch (error) {}
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 1000) // Update every second during initialization

    return () => clearInterval(interval)
  }, [servers, expandedLogs])

  // Fetch tools periodically
  useEffect(() => {
    const fetchTools = async () => {
      try {
        const toolList = await tipcClient.getMcpDetailedToolList({})
        setTools(toolList as DetailedTool[])
      } catch (error) {}
    }

    fetchTools()
    const interval = setInterval(fetchTools, 5000) // Update every 5 seconds

    return () => clearInterval(interval)
  }, [])

  // Group tools by server
  const toolsByServer = tools.reduce(
    (acc, tool) => {
      if (!acc[tool.serverName]) {
        acc[tool.serverName] = []
      }
      acc[tool.serverName].push(tool)
      return acc
    },
    {} as Record<string, DetailedTool[]>,
  )

  // Filter tools for a specific server
  const getFilteredToolsForServer = (serverName: string) => {
    const serverTools = toolsByServer[serverName] || []
    return serverTools.filter((tool) => {
      const matchesSearch =
        tool.name.toLowerCase().includes(toolSearchQuery.toLowerCase()) ||
        tool.description.toLowerCase().includes(toolSearchQuery.toLowerCase())
      const matchesVisibility = showDisabledTools || tool.enabled
      return matchesSearch && matchesVisibility
    })
  }

  const handleToolToggle = async (toolName: string, enabled: boolean) => {
    try {
      // Update local state immediately for better UX
      setTools((prevTools) =>
        prevTools.map((tool) =>
          tool.name === toolName ? { ...tool, enabled } : tool,
        ),
      )

      // Call the backend API
      const result = await tipcClient.setMcpToolEnabled({ toolName, enabled })

      if ((result as any).success) {
        toast.success(`Tool ${toolName} ${enabled ? "enabled" : "disabled"}`)
      } else {
        // Revert local state if backend call failed
        setTools((prevTools) =>
          prevTools.map((tool) =>
            tool.name === toolName ? { ...tool, enabled: !enabled } : tool,
          ),
        )
        toast.error(
          `Failed to ${enabled ? "enable" : "disable"} tool ${toolName}`,
        )
      }
    } catch (error: any) {
      // Revert local state on error
      setTools((prevTools) =>
        prevTools.map((tool) =>
          tool.name === toolName ? { ...tool, enabled: !enabled } : tool,
        ),
      )
      toast.error(`Error toggling tool: ${error.message}`)
    }
  }

  const handleToggleAllToolsForServer = async (serverName: string, enable: boolean) => {
    const serverTools = tools.filter((tool) => tool.serverName === serverName)
    if (serverTools.length === 0) return

    // Update local state immediately for better UX
    const updatedTools = tools.map((tool) => {
      if (tool.serverName === serverName) {
        return { ...tool, enabled: enable }
      }
      return tool
    })
    setTools(updatedTools)

    // Track promises for all backend calls
    const promises = serverTools.map((tool) =>
      tipcClient.setMcpToolEnabled({ toolName: tool.name, enabled: enable }),
    )

    try {
      const results = await Promise.allSettled(promises)
      const successful = results.filter((r) => r.status === "fulfilled").length
      const failed = results.length - successful

      if (failed === 0) {
        toast.success(
          `All ${serverTools.length} tools for ${serverName} ${enable ? "enabled" : "disabled"}`,
        )
      } else {
        // Revert local state for failed calls
        const failedTools = serverTools.filter(
          (_, index) => results[index].status === "rejected",
        )
        const revertedTools = tools.map((tool) => {
          if (tool.serverName === serverName && failedTools.includes(tool)) {
            return { ...tool, enabled: !enable }
          }
          return tool
        })
        setTools(revertedTools)

        toast.warning(
          `${successful}/${serverTools.length} tools ${enable ? "enabled" : "disabled"} for ${serverName} (${failed} failed)`,
        )
      }
    } catch (error: any) {
      // Revert all tools on error
      const revertedTools = tools.map((tool) => {
        if (tool.serverName === serverName) {
          return { ...tool, enabled: !enable }
        }
        return tool
      })
      setTools(revertedTools)
      toast.error(`Error toggling tools for ${serverName}: ${error.message}`)
    }
  }

  const toggleToolsExpansion = (serverName: string) => {
    setExpandedTools(prev => {
      const newSet = new Set(prev)
      if (newSet.has(serverName)) {
        newSet.delete(serverName)
      } else {
        newSet.add(serverName)
      }
      return newSet
    })
  }

  const handleAddServer = async (name: string, serverConfig: MCPServerConfig) => {
    const newConfig = {
      ...config,
      mcpServers: {
        ...servers,
        [name]: serverConfig,
      },
    }
    onConfigChange(newConfig)
    setShowAddDialog(false)

    // Auto-start the server after adding it (unless it's disabled)
    if (!serverConfig.disabled) {
      // Wait a bit for the config to be saved
      setTimeout(async () => {
        try {
          // Mark the server as runtime-enabled
          const runtimeResult = await tipcClient.setMcpServerRuntimeEnabled({
            serverName: name,
            enabled: true,
          })
          if (!(runtimeResult as any).success) {
            toast.error(`Failed to enable server: Server not found`)
            return
          }

          // Start the server
          const result = await tipcClient.restartMcpServer({ serverName: name })
          if ((result as any).success) {
            toast.success(`Server ${name} connected successfully`)
          } else {
            toast.error(`Failed to connect server: ${(result as any).error}`)
          }
        } catch (error) {
          toast.error(`Failed to connect server: ${error instanceof Error ? error.message : String(error)}`)
        }
      }, 500)
    }
  }

  const handleEditServer = (
    oldName: string,
    newName: string,
    serverConfig: MCPServerConfig,
  ) => {
    const newServers = { ...servers }
    if (oldName !== newName) {
      delete newServers[oldName]
    }
    newServers[newName] = serverConfig

    const newConfig = {
      ...config,
      mcpServers: newServers,
    }
    onConfigChange(newConfig)
    setEditingServer(null)
  }

  const handleDeleteServer = (name: string) => {
    const newServers = { ...servers }
    delete newServers[name]

    const newConfig = {
      ...config,
      mcpServers: newServers,
    }
    onConfigChange(newConfig)
  }

  const handleImportConfigFromFile = async () => {
    try {
      const importedConfig = await tipcClient.loadMcpConfigFile({})
      if (importedConfig) {
        // Add imported servers to config (duplicates will be replaced by imported versions)
        const newConfig = {
          ...config,
          mcpServers: {
            ...config.mcpServers,
            ...importedConfig.mcpServers,
          },
        }
        onConfigChange(newConfig)
        setShowAddDialog(false)
        toast.success(`Successfully imported ${Object.keys(importedConfig.mcpServers).length} server(s)`)
      }
    } catch (error) {
      toast.error(`Failed to import config: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleExportConfig = async () => {
    try {
      const success = await tipcClient.saveMcpConfigFile({ config })
      if (success) {
        toast.success("MCP configuration exported successfully")
      }
    } catch (error) {
      toast.error(`Failed to export config: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const formatJsonPreview = (jsonText: string): string => {
    try {
      if (!jsonText.trim()) return jsonText
      const parsed = JSON.parse(jsonText)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return jsonText
    }
  }

  const handleImportFromText = async (text: string): Promise<boolean> => {
    try {
      // Format JSON for consistency before validation (falls back to original text if parsing fails)
      // Note: formatJsonPreview returns the original text on parse errors, actual validation
      // is performed by validateMcpConfigText which will catch any JSON syntax errors
      const formattedJson = formatJsonPreview(text)

      const importedConfig = await tipcClient.validateMcpConfigText({ text: formattedJson })

      if (importedConfig) {
        // Add imported servers to config (duplicates will be replaced by imported versions)
        const newConfig = {
          ...config,
          mcpServers: {
            ...config.mcpServers,
            ...importedConfig.mcpServers,
          },
        }
        onConfigChange(newConfig)
        setShowAddDialog(false)
        toast.success(`Successfully imported ${Object.keys(importedConfig.mcpServers).length} server(s)`)
        return true
      }
      return false
    } catch (error) {
      toast.error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const handleAddExample = (exampleKey: string) => {
    const example = MCP_EXAMPLES[exampleKey]
    if (example) {
      handleAddServer(example.name, example.config)
      setShowExamples(false)
      toast.success(`Added ${example.name} server configuration`)
    }
  }

  const handleAddOAuthExample = (exampleKey: string) => {
    const example = getOAuthExample(exampleKey)
    if (example) {
      handleAddServer(example.name, example.config)
      setShowExamples(false)
      toast.success(`Added ${example.name} OAuth server configuration`)

      // Show setup instructions
      if (example.setupInstructions.length > 0) {
        toast.info(`Setup required: ${example.setupInstructions[0]}`, {
          duration: 5000,
        })
      }
    }
  }

  const handleRestartServer = async (serverName: string) => {
    try {
      const result = await tipcClient.restartMcpServer({ serverName })
      if ((result as any).success) {
        toast.success(`Server ${serverName} restarted successfully`)
      } else {
        toast.error(`Failed to restart server: ${(result as any).error}`)
      }
    } catch (error) {
      toast.error(`Failed to restart server: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleStopServer = async (serverName: string) => {
    try {
      // First mark the server as runtime-disabled so it stays stopped
      const runtimeResult = await tipcClient.setMcpServerRuntimeEnabled({
        serverName,
        enabled: false,
      })
      if (!(runtimeResult as any).success) {
        toast.error(`Failed to disable server: Server not found`)
        return
      }

      // Then stop the server
      const result = await tipcClient.stopMcpServer({ serverName })
      if ((result as any).success) {
        toast.success(`Server ${serverName} stopped successfully`)
      } else {
        toast.error(`Failed to stop server: ${(result as any).error}`)
      }
    } catch (error) {
      toast.error(`Failed to stop server: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleStartServer = async (serverName: string) => {
    try {
      // Mark the server as runtime-enabled so it can be initialized
      const runtimeResult = await tipcClient.setMcpServerRuntimeEnabled({
        serverName,
        enabled: true,
      })
      if (!(runtimeResult as any).success) {
        toast.error(`Failed to enable server: Server not found`)
        return
      }

      // Restart the server to initialize it
      const result = await tipcClient.restartMcpServer({ serverName })
      if ((result as any).success) {
        toast.success(`Server ${serverName} started successfully`)
      } else {
        toast.error(`Failed to start server: ${(result as any).error}`)
      }
    } catch (error) {
      toast.error(`Failed to start server: ${error.message}`)
    }
  }

  const toggleLogs = (serverName: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(serverName)) {
        newSet.delete(serverName)
      } else {
        newSet.add(serverName)
        // Fetch logs immediately when expanding
        fetchLogsForServer(serverName)
      }
      return newSet
    })
  }

  const toggleServerExpansion = (serverName: string) => {
    setExpandedServers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(serverName)) {
        newSet.delete(serverName)
      } else {
        newSet.add(serverName)
      }
      return newSet
    })
  }

  const toggleAllServers = (expand: boolean) => {
    if (expand) {
      setExpandedServers(new Set(Object.keys(servers)))
    } else {
      setExpandedServers(new Set())
    }
  }

  const handleClearLogs = async (serverName: string) => {
    try {
      await tipcClient.clearMcpServerLogs({ serverName })
      setServerLogs(prev => ({ ...prev, [serverName]: [] }))
      toast.success(`Logs cleared for ${serverName}`)
    } catch (error) {
      toast.error(`Failed to clear logs: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-medium">MCP Server Configuration</h3>
        </div>
        <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={handleExportConfig}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add Server
              </Button>
            </DialogTrigger>
            <ServerDialog
              onSave={handleAddServer}
              onCancel={() => setShowAddDialog(false)}
              onImportFromFile={handleImportConfigFromFile}
              onImportFromText={handleImportFromText}
              isOpen={showAddDialog}
            />
          </Dialog>
        </div>
      </div>

      {/* Loading spinner during initialization */}
      {initializationStatus.isInitializing && (
        <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
          <CardContent className="flex items-center justify-center py-6">
            <div className="flex items-center gap-3">
              <Spinner className="h-5 w-5" />
              <div className="text-sm">
                <div className="font-medium">Initializing MCP servers...</div>
                <div className="text-muted-foreground">
                  {initializationStatus.progress.currentServer && (
                    <>
                      Connecting to{" "}
                      {initializationStatus.progress.currentServer}
                    </>
                  )}
                  {initializationStatus.progress.total > 0 && (
                    <>
                      {" "}
                      ({initializationStatus.progress.current}/
                      {initializationStatus.progress.total})
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tool Search and Filter Controls */}
      {Object.entries(servers).length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tools..."
                value={toolSearchQuery}
                onChange={(e) => setToolSearchQuery(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDisabledTools(!showDisabledTools)}
              className="shrink-0"
            >
              {showDisabledTools ? (
                <EyeOff className="mr-2 h-4 w-4" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              {showDisabledTools ? "Hide Disabled" : "Show All"}
            </Button>
          </div>
          {(() => {
            const serverKeys = Object.keys(servers)
            const expandedCount = serverKeys.filter(key => expandedServers.has(key)).length
            const allExpanded = expandedCount >= serverKeys.length
            return (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleAllServers(!allExpanded)}
                className="text-muted-foreground shrink-0"
              >
                <ChevronsUpDown className="mr-2 h-4 w-4" />
                {allExpanded ? "Collapse All" : "Expand All"}
              </Button>
            )
          })()}
        </div>
      )}

      <div className="grid gap-2">
        {Object.entries(servers).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Server className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-center text-muted-foreground">
                No MCP servers configured. Add a server to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          Object.entries(servers).map(([name, serverConfig]) => (
            <Card key={name} className="overflow-hidden">
              {/* Collapsed Header Row - Always Visible */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expandedServers.has(name)}
                aria-label={`Toggle ${name} server details`}
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                onClick={() => toggleServerExpansion(name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleServerExpansion(name)
                  }
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {expandedServers.has(name) ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-medium truncate">{name}</span>
                  {serverConfig.disabled ? (
                    <Badge variant="secondary" className="shrink-0">Disabled</Badge>
                  ) : serverStatus[name]?.runtimeEnabled === false ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Square className="h-3 w-3 text-orange-500" />
                      <Badge
                        variant="outline"
                        className="border-orange-300 text-orange-600 text-xs"
                      >
                        Stopped
                      </Badge>
                    </div>
                  ) : (
                    <>
                      {serverStatus[name]?.connected ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <CheckCircle className="h-3 w-3 text-green-500" />
                          <Badge variant="default" className="text-xs">
                            {(toolsByServer[name] || []).filter((t) => t.enabled).length}/
                            {serverStatus[name].toolCount} enabled
                          </Badge>
                        </div>
                      ) : serverStatus[name]?.error ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <XCircle className="h-3 w-3 text-red-500" />
                          <Badge variant="destructive" className="text-xs">Error</Badge>
                        </div>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1">
                          <AlertCircle className="h-3 w-3 text-yellow-500" />
                          <Badge variant="outline" className="text-xs">Disconnected</Badge>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {/* Action buttons - stop propagation so clicks/keys don't toggle expansion */}
                <div
                  className="flex shrink-0 items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {!serverConfig.disabled && (
                    <>
                      {serverStatus[name]?.runtimeEnabled === false ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartServer(name)}
                          title="Start server"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRestartServer(name)}
                            title="Restart server"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStopServer(name)}
                            title="Stop server"
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditingServer({ name, config: serverConfig })
                    }
                    title="Edit server"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  {/* OAuth authorization controls */}
                  {serverConfig.transport === "streamableHttp" && serverConfig.url && (
                    <>
                      {oauthStatus[name]?.authenticated ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={async () => {
                            try {
                              await window.electronAPI.revokeOAuthTokens(name)
                              toast.success("OAuth authentication revoked")
                              refreshOAuthStatus()
                            } catch (error) {
                              toast.error(`Failed to revoke authentication: ${error instanceof Error ? error.message : String(error)}`)
                            }
                          }}
                          title="Revoke OAuth authentication"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      ) : oauthStatus[name]?.configured ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await window.electronAPI.initiateOAuthFlow(name)
                              toast.success("OAuth authentication started")
                              // Poll for completion
                              const checkCompletion = setInterval(async () => {
                                const status = await window.electronAPI.getOAuthStatus(name)
                                if (status.authenticated) {
                                  clearInterval(checkCompletion)
                                  refreshOAuthStatus()
                                  toast.success("OAuth authentication completed")
                                }
                              }, 2000)
                              setTimeout(() => clearInterval(checkCompletion), 60000)
                            } catch (error) {
                              toast.error(`Failed to start OAuth flow: ${error instanceof Error ? error.message : String(error)}`)
                            }
                          }}
                          title="Start OAuth authentication"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteServer(name)}
                    title="Delete server"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Expanded Details Section */}
              {expandedServers.has(name) && (
                <>
                  <CardContent className="pt-0 border-t">
                    <div className="space-y-3 py-3">
                      {/* Command/Transport Info */}
                      <div className="text-sm">
                        <span className="font-medium text-muted-foreground">
                          {serverConfig.transport === "stdio" || !serverConfig.transport ? "Command:" : "Transport:"}
                        </span>{" "}
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {serverConfig.transport === "stdio" || !serverConfig.transport
                            ? `${serverConfig.command || ""} ${serverConfig.args ? serverConfig.args.join(" ") : ""}`
                            : `${serverConfig.transport}: ${serverConfig.url || ""}`}
                        </code>
                      </div>

                      {/* Environment Variables */}
                      {serverConfig.env && Object.keys(serverConfig.env).length > 0 && (
                        <div className="text-sm">
                          <span className="font-medium text-muted-foreground">Environment:</span>{" "}
                          <span className="text-xs text-muted-foreground">
                            {Object.keys(serverConfig.env).join(", ")}
                          </span>
                        </div>
                      )}

                      {/* Timeout */}
                      {serverConfig.timeout && (
                        <div className="text-sm">
                          <span className="font-medium text-muted-foreground">Timeout:</span>{" "}
                          <span className="text-xs text-muted-foreground">{serverConfig.timeout}ms</span>
                        </div>
                      )}

                      {/* Error (if any) */}
                      {serverStatus[name]?.error && (
                        <div className="text-sm text-red-500">
                          <span className="font-medium">Error:</span> {serverStatus[name].error}
                        </div>
                      )}
                    </div>
                  </CardContent>

                  {/* Server Logs Section - only show for stdio servers */}
                  {(serverConfig.transport === "stdio" || !serverConfig.transport) && (
                    <CardContent className="pt-0 border-t">
                      <div className="space-y-2 py-2">
                        <div className="flex items-center justify-between">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleLogs(name)}
                            className="flex items-center gap-2 -ml-2"
                          >
                            <Terminal className="h-4 w-4" />
                            <span>Server Logs</span>
                            {expandedLogs.has(name) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                          {expandedLogs.has(name) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleClearLogs(name)}
                              title="Clear logs"
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        {expandedLogs.has(name) && (
                          <div className="bg-black/90 rounded-md p-3 max-h-64 overflow-y-auto font-mono text-xs">
                            {serverLogs[name]?.length > 0 ? (
                              <div className="space-y-1">
                                {serverLogs[name].map((log, idx) => (
                                  <div key={idx} className="text-green-400">
                                    <span className="text-gray-500">
                                      [{new Date(log.timestamp).toLocaleTimeString()}]
                                    </span>{' '}
                                    {log.message}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-gray-500 text-center py-4">
                                No logs available
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  )}

                  {/* Tools Section */}
                  {serverStatus[name]?.connected && (
                    <CardContent className="pt-0 border-t">
                      <div className="space-y-2 py-2">
                        <div className="flex items-center justify-between">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleToolsExpansion(name)}
                            className="flex items-center gap-2 -ml-2"
                          >
                            <Wrench className="h-4 w-4" />
                            <span>Tools</span>
                            <Badge variant="secondary" className="text-xs">
                              {(toolsByServer[name] || []).filter((t) => t.enabled).length}/
                              {(toolsByServer[name] || []).length}
                            </Badge>
                            {expandedTools.has(name) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                          {expandedTools.has(name) && (toolsByServer[name]?.length > 0) && (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleAllToolsForServer(name, true)}
                                className="h-7 px-2 text-xs"
                              >
                                <Power className="mr-1 h-3 w-3" />
                                All ON
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleAllToolsForServer(name, false)}
                                className="h-7 px-2 text-xs"
                              >
                                <PowerOff className="mr-1 h-3 w-3" />
                                All OFF
                              </Button>
                            </div>
                          )}
                        </div>

                        {expandedTools.has(name) && (
                          <div className="space-y-2">
                            {getFilteredToolsForServer(name).length === 0 ? (
                              <div className="text-sm text-muted-foreground text-center py-4">
                                {(toolsByServer[name] || []).length === 0
                                  ? "No tools available"
                                  : "No tools match your search"}
                              </div>
                            ) : (
                              getFilteredToolsForServer(name).map((tool) => (
                                <div
                                  key={tool.name}
                                  className="flex items-center justify-between rounded-lg border p-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="mb-1 flex items-center gap-2">
                                      <h4 className="truncate text-sm font-medium">
                                        {tool.name.includes(":")
                                          ? tool.name.split(":").slice(1).join(":")
                                          : tool.name}
                                      </h4>
                                      {!tool.enabled && (
                                        <Badge variant="outline" className="text-xs">
                                          Disabled
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="line-clamp-2 text-xs text-muted-foreground">
                                      {tool.description}
                                    </p>
                                  </div>
                                  <div className="ml-4 flex items-center gap-2">
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <Button variant="ghost" size="sm">
                                          <Eye className="h-4 w-4" />
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent className="max-w-2xl">
                                        <DialogHeader>
                                          <DialogTitle>{tool.name}</DialogTitle>
                                          <DialogDescription>
                                            {tool.description}
                                          </DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4">
                                          <div>
                                            <Label className="text-sm font-medium">
                                              Input Schema
                                            </Label>
                                            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                                              {JSON.stringify(tool.inputSchema, null, 2)}
                                            </pre>
                                          </div>
                                        </div>
                                      </DialogContent>
                                    </Dialog>
                                    <Switch
                                      checked={tool.enabled}
                                      onCheckedChange={(enabled) =>
                                        handleToolToggle(tool.name, enabled)
                                      }
                                    />
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  )}
                </>
              )}
            </Card>
          ))
        )}
      </div>

      {editingServer && (
        <Dialog open={true} onOpenChange={() => setEditingServer(null)}>
          <ServerDialog
            server={editingServer}
            onSave={(newName, config) =>
              handleEditServer(editingServer.name, newName, config)
            }
            onCancel={() => setEditingServer(null)}
          />
        </Dialog>
      )}
    </div>
  )
}
