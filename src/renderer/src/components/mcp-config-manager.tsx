import React, { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Switch } from "@renderer/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@renderer/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Badge } from "@renderer/components/ui/badge"
import { Trash2, Edit, Plus, Upload, Download, Server, CheckCircle, XCircle, AlertCircle, BookOpen, RotateCcw, Square, Play } from "lucide-react"
import { Spinner } from "@renderer/components/ui/spinner"
import { MCPConfig, MCPServerConfig, MCPTransportType } from "@shared/types"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"

interface MCPConfigManagerProps {
  config: MCPConfig
  onConfigChange: (config: MCPConfig) => void
}

interface ServerDialogProps {
  server?: { name: string; config: MCPServerConfig }
  onSave: (name: string, config: MCPServerConfig) => void
  onCancel: () => void
}

function ServerDialog({ server, onSave, onCancel }: ServerDialogProps) {
  const [name, setName] = useState(server?.name || "")
  const [transport, setTransport] = useState<MCPTransportType>(server?.config.transport || "stdio")
  const [command, setCommand] = useState(server?.config.command || "")
  const [args, setArgs] = useState(server?.config.args ? server.config.args.join(" ") : "")
  const [url, setUrl] = useState(server?.config.url || "")
  const [env, setEnv] = useState(
    server?.config.env ? Object.entries(server.config.env).map(([k, v]) => `${k}=${v}`).join("\n") : ""
  )
  const [timeout, setTimeout] = useState(server?.config.timeout?.toString() || "")
  const [disabled, setDisabled] = useState(server?.config.disabled || false)

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Server name is required")
      return
    }

    // Validate based on transport type
    if (transport === "stdio") {
      if (!command.trim()) {
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
        env.split("\n").forEach(line => {
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

    const serverConfig: MCPServerConfig = {
      transport,
      ...(transport === "stdio" && {
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
      }),
      ...(transport !== "stdio" && {
        url: url.trim(),
      }),
      ...(Object.keys(envObject).length > 0 && { env: envObject }),
      ...(timeout && { timeout: parseInt(timeout) }),
      ...(disabled && { disabled })
    }

    onSave(name.trim(), serverConfig)
  }

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{server ? "Edit Server" : "Add Server"}</DialogTitle>
        <DialogDescription>
          Configure an MCP server connection
        </DialogDescription>
      </DialogHeader>

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
          <Select value={transport} onValueChange={(value: MCPTransportType) => setTransport(value)}>
            <SelectTrigger>
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
          <>
            <div className="space-y-2">
              <Label htmlFor="command">Command</Label>
              <Input
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., npx"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="args">Arguments</Label>
              <Input
                id="args"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="e.g., -y @modelcontextprotocol/server-google-maps"
              />
              <p className="text-xs text-muted-foreground">
                Space-separated command arguments
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="url">Server URL</Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={transport === "websocket" ? "ws://localhost:8080" : "http://localhost:8080"}
            />
            <p className="text-xs text-muted-foreground">
              {transport === "websocket"
                ? "WebSocket URL (e.g., ws://localhost:8080 or wss://example.com/mcp)"
                : "HTTP URL for streamable HTTP transport (e.g., http://localhost:8080/mcp)"
              }
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
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave}>
          {server ? "Update" : "Add"} Server
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// Example MCP server configurations
const MCP_EXAMPLES = {
  "google-maps": {
    name: "google-maps",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-google-maps"],
      env: {
        GOOGLE_MAPS_API_KEY: "your-api-key-here"
      }
    }
  },
  "slack": {
    name: "slack",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: "xoxb-your-bot-token",
        SLACK_TEAM_ID: "T1234567890"
      }
    }
  },
  "filesystem": {
    name: "filesystem",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"],
      env: {}
    }
  },
  "github": {
    name: "github",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_your_token_here"
      }
    }
  },
  "postgres": {
    name: "postgres",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: {
        POSTGRES_CONNECTION_STRING: "postgresql://user:password@localhost:5432/database"
      }
    }
  },
  "remote-websocket": {
    name: "remote-websocket",
    config: {
      transport: "websocket" as MCPTransportType,
      url: "ws://localhost:8080",
      timeout: 10000
    }
  },
  "remote-http": {
    name: "remote-http",
    config: {
      transport: "streamableHttp" as MCPTransportType,
      url: "http://localhost:8080/mcp",
      timeout: 10000
    }
  }
}

export function MCPConfigManager({ config, onConfigChange }: MCPConfigManagerProps) {
  const [editingServer, setEditingServer] = useState<{ name: string; config: MCPServerConfig } | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const [serverStatus, setServerStatus] = useState<Record<string, { connected: boolean; toolCount: number; error?: string; runtimeEnabled?: boolean; configDisabled?: boolean }>>({})
  const [initializationStatus, setInitializationStatus] = useState<{ isInitializing: boolean; progress: { current: number; total: number; currentServer?: string } }>({ isInitializing: false, progress: { current: 0, total: 0 } })

  const servers = config.mcpServers || {}

  // Fetch server status and initialization status periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [status, initStatus] = await Promise.all([
          tipcClient.getMcpServerStatus(),
          tipcClient.getMcpInitializationStatus()
        ])
        setServerStatus(status)
        setInitializationStatus(initStatus)
      } catch (error) {
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 1000) // Update every second during initialization

    return () => clearInterval(interval)
  }, [servers])

  const handleAddServer = (name: string, serverConfig: MCPServerConfig) => {
    const newConfig = {
      ...config,
      mcpServers: {
        ...servers,
        [name]: serverConfig
      }
    }
    onConfigChange(newConfig)
    setShowAddDialog(false)
  }

  const handleEditServer = (oldName: string, newName: string, serverConfig: MCPServerConfig) => {
    const newServers = { ...servers }
    if (oldName !== newName) {
      delete newServers[oldName]
    }
    newServers[newName] = serverConfig

    const newConfig = {
      ...config,
      mcpServers: newServers
    }
    onConfigChange(newConfig)
    setEditingServer(null)
  }

  const handleDeleteServer = (name: string) => {
    const newServers = { ...servers }
    delete newServers[name]

    const newConfig = {
      ...config,
      mcpServers: newServers
    }
    onConfigChange(newConfig)
  }

  const handleImportConfig = async () => {
    try {
      const importedConfig = await tipcClient.loadMcpConfigFile()
      if (importedConfig) {
        onConfigChange(importedConfig)
        toast.success("MCP configuration imported successfully")
      }
    } catch (error) {
      toast.error(`Failed to import config: ${error.message}`)
    }
  }

  const handleExportConfig = async () => {
    try {
      const success = await tipcClient.saveMcpConfigFile({ config })
      if (success) {
        toast.success("MCP configuration exported successfully")
      }
    } catch (error) {
      toast.error(`Failed to export config: ${error.message}`)
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

  const handleRestartServer = async (serverName: string) => {
    try {
      const result = await tipcClient.restartMcpServer({ serverName })
      if (result.success) {
        toast.success(`Server ${serverName} restarted successfully`)
      } else {
        toast.error(`Failed to restart server: ${result.error}`)
      }
    } catch (error) {
      toast.error(`Failed to restart server: ${error.message}`)
    }
  }

  const handleStopServer = async (serverName: string) => {
    try {
      // First mark the server as runtime-disabled so it stays stopped
      const runtimeResult = await tipcClient.setMcpServerRuntimeEnabled({ serverName, enabled: false })
      if (!runtimeResult.success) {
        toast.error(`Failed to disable server: Server not found`)
        return
      }

      // Then stop the server
      const result = await tipcClient.stopMcpServer({ serverName })
      if (result.success) {
        toast.success(`Server ${serverName} stopped successfully`)
      } else {
        toast.error(`Failed to stop server: ${result.error}`)
      }
    } catch (error) {
      toast.error(`Failed to stop server: ${error.message}`)
    }
  }

  const handleStartServer = async (serverName: string) => {
    try {
      // Mark the server as runtime-enabled so it can be initialized
      const runtimeResult = await tipcClient.setMcpServerRuntimeEnabled({ serverName, enabled: true })
      if (!runtimeResult.success) {
        toast.error(`Failed to enable server: Server not found`)
        return
      }

      // Restart the server to initialize it
      const result = await tipcClient.restartMcpServer({ serverName })
      if (result.success) {
        toast.success(`Server ${serverName} started successfully`)
      } else {
        toast.error(`Failed to start server: ${result.error}`)
      }
    } catch (error) {
      toast.error(`Failed to start server: ${error.message}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-medium">MCP Server Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Manage Model Context Protocol server connections
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-start sm:justify-end">
          <Button variant="outline" size="sm" onClick={handleImportConfig}>
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportConfig}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Dialog open={showExamples} onOpenChange={setShowExamples}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <BookOpen className="h-4 w-4 mr-2" />
                Library
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>MCP Server Examples</DialogTitle>
                <DialogDescription>
                  Choose from popular MCP server configurations to get started quickly
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
                {Object.entries(MCP_EXAMPLES).map(([key, example]) => (
                  <Card key={key} className="cursor-pointer hover:bg-accent" onClick={() => handleAddExample(key)}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{example.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {example.config.transport === "stdio"
                          ? `${example.config.command} ${example.config.args ? example.config.args.join(" ") : ""}`
                          : `${example.config.transport}: ${example.config.url}`
                        }
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="text-xs text-muted-foreground">
                        {Object.keys(example.config.env || {}).length > 0 && (
                          <div>
                            <strong>Environment variables:</strong> {Object.keys(example.config.env).join(", ")}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowExamples(false)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Server
              </Button>
            </DialogTrigger>
            <ServerDialog
              onSave={handleAddServer}
              onCancel={() => setShowAddDialog(false)}
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
                    <>Connecting to {initializationStatus.progress.currentServer}</>
                  )}
                  {initializationStatus.progress.total > 0 && (
                    <> ({initializationStatus.progress.current}/{initializationStatus.progress.total})</>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {Object.entries(servers).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Server className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                No MCP servers configured. Add a server to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          Object.entries(servers).map(([name, serverConfig]) => (
            <Card key={name}>
              <CardHeader className="p-1 pl-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{name}</CardTitle>
                    {serverConfig.disabled ? (
                      <Badge variant="secondary">Disabled</Badge>
                    ) : serverStatus[name]?.runtimeEnabled === false ? (
                      <div className="flex items-center gap-2">
                        <Square className="h-4 w-4 text-orange-500" />
                      </div>
                    ) : (
                      <>
                        {serverStatus[name]?.connected ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <Badge variant="default">({serverStatus[name].toolCount} tools)</Badge>
                          </div>
                        ) : serverStatus[name]?.error ? (
                          <div className="flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-red-500" />
                            <Badge variant="destructive">Error</Badge>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-yellow-500" />
                            <Badge variant="outline">Disconnected</Badge>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex gap-1">
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
                      onClick={() => setEditingServer({ name, config: serverConfig })}
                      title="Edit server"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
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
              </CardHeader>
            </Card>
          ))
        )}
      </div>

      {editingServer && (
        <Dialog open={true} onOpenChange={() => setEditingServer(null)}>
          <ServerDialog
            server={editingServer}
            onSave={(newName, config) => handleEditServer(editingServer.name, newName, config)}
            onCancel={() => setEditingServer(null)}
          />
        </Dialog>
      )}
    </div>
  )
}
