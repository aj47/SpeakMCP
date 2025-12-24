import { useState, useCallback, useEffect } from "react"
import { ControlGroup } from "@renderer/components/ui/control"
import { Input } from "@renderer/components/ui/input"
import { Button } from "@renderer/components/ui/button"
import { Switch } from "@renderer/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ACPAgentConfig } from "../../../shared/types"
import { Plus, Pencil, Trash2, Bot, Terminal, Globe, Play, Square, Loader2 } from "lucide-react"
import { toast } from "sonner"

// Preset configurations for common ACP agents
const AGENT_PRESETS: Record<string, Partial<ACPAgentConfig>> = {
  auggie: {
    name: "auggie",
    displayName: "Auggie (Augment Code)",
    description: "Augment Code's AI coding assistant with native ACP support",
    capabilities: ["coding", "debugging", "refactoring", "documentation"],
    connection: {
      type: "stdio",
      command: "auggie",
      args: ["--acp"],
    },
  },
  "claude-code": {
    name: "claude-code",
    displayName: "Claude Code",
    description: "Anthropic's Claude for coding tasks via ACP adapter",
    capabilities: ["coding", "debugging", "refactoring"],
    connection: {
      type: "stdio",
      command: "claude-code-acp",
      args: [],
      env: {},
    },
  },
}

function AgentDialog({
  open,
  onOpenChange,
  agent,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: ACPAgentConfig | null
  onSave: (agent: ACPAgentConfig) => void
}) {
  const [name, setName] = useState(agent?.name || "")
  const [displayName, setDisplayName] = useState(agent?.displayName || "")
  const [description, setDescription] = useState(agent?.description || "")
  const [capabilities, setCapabilities] = useState(agent?.capabilities?.join(", ") || "")
  // Internal agents can't be edited, so we only support stdio/remote here
  const [connectionType, setConnectionType] = useState<"stdio" | "remote">(
    (agent?.connection?.type === "internal" ? "stdio" : agent?.connection?.type) || "stdio"
  )
  const [command, setCommand] = useState(agent?.connection?.command || "")
  const [args, setArgs] = useState(agent?.connection?.args?.join(" ") || "")
  const [envVars, setEnvVars] = useState(
    agent?.connection?.env
      ? Object.entries(agent.connection.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : ""
  )
  const [baseUrl, setBaseUrl] = useState(agent?.connection?.baseUrl || "")
  const [autoSpawn, setAutoSpawn] = useState(agent?.autoSpawn || false)
  const [selectedPreset, setSelectedPreset] = useState<string>("")

  // Sync form state when dialog opens or agent changes
  useEffect(() => {
    if (open) {
      setName(agent?.name || "")
      setDisplayName(agent?.displayName || "")
      setDescription(agent?.description || "")
      setCapabilities(agent?.capabilities?.join(", ") || "")
      setConnectionType((agent?.connection?.type === "internal" ? "stdio" : agent?.connection?.type) || "stdio")
      setCommand(agent?.connection?.command || "")
      setArgs(agent?.connection?.args?.join(" ") || "")
      setEnvVars(
        agent?.connection?.env
          ? Object.entries(agent.connection.env)
              .map(([k, v]) => `${k}=${v}`)
              .join("\n")
          : ""
      )
      setBaseUrl(agent?.connection?.baseUrl || "")
      setAutoSpawn(agent?.autoSpawn || false)
      setSelectedPreset("")
    }
  }, [open, agent])

  const applyPreset = (presetKey: string) => {
    const preset = AGENT_PRESETS[presetKey]
    if (preset) {
      setName(preset.name || "")
      setDisplayName(preset.displayName || "")
      setDescription(preset.description || "")
      setCapabilities(preset.capabilities?.join(", ") || "")
      setConnectionType((preset.connection?.type === "internal" ? "stdio" : preset.connection?.type) || "stdio")
      setCommand(preset.connection?.command || "")
      setArgs(preset.connection?.args?.join(" ") || "")
      setEnvVars(
        preset.connection?.env
          ? Object.entries(preset.connection.env)
              .map(([k, v]) => `${k}=${v}`)
              .join("\n")
          : ""
      )
      setBaseUrl(preset.connection?.baseUrl || "")
    }
  }

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Agent name is required")
      return
    }
    if (!displayName.trim()) {
      toast.error("Display name is required")
      return
    }
    if (connectionType === "stdio" && !command.trim()) {
      toast.error("Command is required for stdio connection")
      return
    }
    if (connectionType === "remote" && !baseUrl.trim()) {
      toast.error("Base URL is required for remote connection")
      return
    }

    // Parse environment variables
    const envObject: Record<string, string> = {}
    if (envVars.trim()) {
      envVars.split("\n").forEach((line) => {
        const [key, ...valueParts] = line.split("=")
        if (key && valueParts.length > 0) {
          envObject[key.trim()] = valueParts.join("=").trim()
        }
      })
    }

    const agentConfig: ACPAgentConfig = {
      name: name.trim(),
      displayName: displayName.trim(),
      description: description.trim() || undefined,
      capabilities: capabilities
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      autoSpawn,
      enabled: agent?.enabled ?? true,
      connection: {
        type: connectionType,
        ...(connectionType === "stdio" && {
          command: command.trim(),
          args: args
            .split(" ")
            .map((a) => a.trim())
            .filter(Boolean),
          env: Object.keys(envObject).length > 0 ? envObject : undefined,
        }),
        ...(connectionType === "remote" && {
          baseUrl: baseUrl.trim(),
        }),
      },
    }

    onSave(agentConfig)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit ACP Agent" : "Add ACP Agent"}</DialogTitle>
          <DialogDescription>
            Configure an ACP-compatible agent like Auggie or Claude Code
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Preset selector */}
          {!agent && (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Quick Start from Preset</label>
              <Select value={selectedPreset} onValueChange={(v) => { setSelectedPreset(v); applyPreset(v) }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a preset..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auggie">Auggie (Augment Code)</SelectItem>
                  <SelectItem value="claude-code">Claude Code</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Basic info */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Name (unique identifier)</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., auggie, claude-code"
              disabled={!!agent}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Auggie (Augment Code)"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Capabilities (comma-separated)</label>
            <Input
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="coding, debugging, refactoring"
            />
          </div>

          {/* Connection type */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Connection Type</label>
            <Select value={connectionType} onValueChange={(v: "stdio" | "remote") => setConnectionType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    <span>Local Process (stdio)</span>
                  </div>
                </SelectItem>
                <SelectItem value="remote">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    <span>Remote Server (HTTP)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stdio connection fields */}
          {connectionType === "stdio" && (
            <>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Command</label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g., auggie, claude-code-acp"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Arguments (space-separated)</label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="e.g., --acp --model gpt-4"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Environment Variables (one per line, KEY=value)</label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={envVars}
                  onChange={(e) => setEnvVars(e.target.value)}
                  placeholder="ANTHROPIC_API_KEY=sk-..."
                />
              </div>
            </>
          )}

          {/* Remote connection fields */}
          {connectionType === "remote" && (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Base URL</label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:8080"
              />
            </div>
          )}

          {/* Auto-spawn toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Auto-spawn on startup</label>
              <p className="text-xs text-muted-foreground">
                Automatically start this agent when SpeakMCP launches
              </p>
            </div>
            <Switch checked={autoSpawn} onCheckedChange={setAutoSpawn} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Agent</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}



export function Component() {
  const queryClient = useQueryClient()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingAgent, setEditingAgent] = useState<ACPAgentConfig | null>(null)

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["acpAgents"],
    queryFn: () => tipcClient.getAcpAgents(),
  })

  // Fetch agent statuses (includes runtime status)
  const { data: agentStatuses = [] } = useQuery({
    queryKey: ["acpAgentStatuses"],
    queryFn: () => tipcClient.getAcpAgentStatuses(),
    refetchInterval: 2000, // Poll every 2 seconds for status updates
  })

  // Map of agent name to status
  const statusMap = new Map<string, { status: string; error?: string }>(
    agentStatuses.map((s: { config: ACPAgentConfig; status: string; error?: string }) => [
      s.config.name,
      { status: s.status, error: s.error },
    ])
  )

  const saveMutation = useMutation({
    mutationFn: (agent: ACPAgentConfig) => tipcClient.saveAcpAgent({ agent }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acpAgents"] })
      toast.success("Agent saved successfully")
    },
    onError: (error: Error) => {
      toast.error(`Failed to save agent: ${error.message}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (agentName: string) => tipcClient.deleteAcpAgent({ agentName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acpAgents"] })
      toast.success("Agent deleted")
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete agent: ${error.message}`)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ agentName, enabled }: { agentName: string; enabled: boolean }) =>
      tipcClient.toggleAcpAgentEnabled({ agentName, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acpAgents"] })
    },
  })

  const spawnMutation = useMutation({
    mutationFn: (agentName: string) => tipcClient.spawnAcpAgent({ agentName }),
    onSuccess: (result: { success: boolean; error?: string }, agentName: string) => {
      queryClient.invalidateQueries({ queryKey: ["acpAgentStatuses"] })
      if (result.success) {
        toast.success(`Agent ${agentName} started`)
      } else {
        toast.error(`Failed to start agent: ${result.error}`)
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to start agent: ${error.message}`)
    },
  })

  const stopMutation = useMutation({
    mutationFn: (agentName: string) => tipcClient.stopAcpAgent({ agentName }),
    onSuccess: (result: { success: boolean; error?: string }, agentName: string) => {
      queryClient.invalidateQueries({ queryKey: ["acpAgentStatuses"] })
      if (result.success) {
        toast.success(`Agent ${agentName} stopped`)
      } else {
        toast.error(`Failed to stop agent: ${result.error}`)
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to stop agent: ${error.message}`)
    },
  })

  const handleSaveAgent = useCallback(
    (agent: ACPAgentConfig) => {
      saveMutation.mutate(agent)
    },
    [saveMutation]
  )

  const handleDeleteAgent = useCallback(
    (agentName: string) => {
      if (confirm(`Are you sure you want to delete the agent "${agentName}"?`)) {
        deleteMutation.mutate(agentName)
      }
    },
    [deleteMutation]
  )

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="grid gap-4">
        <ControlGroup
          title="ACP Agents"
          endDescription={
            <div className="break-words whitespace-normal">
              Configure ACP (Agent Client Protocol) compatible agents like{" "}
              <a
                href="https://docs.augmentcode.com/cli/acp/agent"
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                Auggie
              </a>{" "}
              or{" "}
              <a
                href="https://www.npmjs.com/package/@zed-industries/claude-code-acp"
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                Claude Code ACP
              </a>
              . These agents can be delegated tasks from SpeakMCP.
            </div>
          }
        >
          <div className="px-3 py-2">
            <Button onClick={() => setShowAddDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Agent
            </Button>
          </div>

          {isLoading ? (
            <div className="px-3 py-4 text-center text-muted-foreground">Loading...</div>
          ) : agents.length === 0 ? (
            <div className="px-3 py-4 text-center text-muted-foreground">
              No ACP agents configured. Click "Add Agent" to get started.
            </div>
          ) : (
            <div className="divide-y">
              {agents.map((agent: ACPAgentConfig) => {
                const agentStatus = statusMap.get(agent.name) || { status: "stopped" }
                const isRunning = agentStatus.status === "ready"
                const isStarting = agentStatus.status === "starting"
                const hasError = agentStatus.status === "error"
                const isEnabled = agent.enabled !== false
                const isInternal = agent.isInternal === true

                return (
                  <div key={agent.name} className="px-3 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="relative">
                        <Bot className="h-5 w-5 text-muted-foreground shrink-0" />
                        {/* Status indicator dot - internal agents are always "ready" */}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background ${
                            isInternal && isEnabled
                              ? "bg-green-500"
                              : isRunning
                              ? "bg-green-500"
                              : isStarting
                              ? "bg-yellow-500"
                              : hasError
                              ? "bg-red-500"
                              : "bg-gray-400"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{agent.displayName}</span>
                          {isInternal && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600">
                              Built-in
                            </span>
                          )}
                          {!isInternal && (
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                isRunning
                                  ? "bg-green-500/20 text-green-600"
                                  : isStarting
                                  ? "bg-yellow-500/20 text-yellow-600"
                                  : hasError
                                  ? "bg-red-500/20 text-red-600"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {isRunning ? "Running" : isStarting ? "Starting" : hasError ? "Error" : "Stopped"}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {isInternal
                            ? "Spawns isolated sub-sessions for parallel tasks"
                            : agent.connection.type === "stdio"
                            ? `${agent.connection.command} ${agent.connection.args?.join(" ") || ""}`
                            : agent.connection.baseUrl}
                        </div>
                        {hasError && agentStatus.error && (
                          <div className="text-xs text-red-500 truncate">{agentStatus.error}</div>
                        )}
                        {agent.capabilities && agent.capabilities.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {agent.capabilities.slice(0, 3).map((cap) => (
                              <span
                                key={cap}
                                className="text-xs bg-muted px-1.5 py-0.5 rounded"
                              >
                                {cap}
                              </span>
                            ))}
                            {agent.capabilities.length > 3 && (
                              <span className="text-xs text-muted-foreground">
                                +{agent.capabilities.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Start/Stop button - not shown for internal agents */}
                      {!isInternal && isRunning ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => stopMutation.mutate(agent.name)}
                          disabled={stopMutation.isPending}
                          title="Stop agent"
                        >
                          {stopMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Square className="h-4 w-4 text-red-500" />
                          )}
                        </Button>
                      ) : !isInternal && isEnabled ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => spawnMutation.mutate(agent.name)}
                          disabled={spawnMutation.isPending || isStarting}
                          title="Start agent"
                        >
                          {spawnMutation.isPending || isStarting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4 text-green-500" />
                          )}
                        </Button>
                      ) : null}
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(enabled) =>
                          toggleMutation.mutate({ agentName: agent.name, enabled })
                        }
                      />
                      {/* Edit/Delete buttons - not shown for internal agents */}
                      {!isInternal && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingAgent(agent)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteAgent(agent.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ControlGroup>
      </div>

      {/* Add Agent Dialog */}
      <AgentDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        agent={null}
        onSave={handleSaveAgent}
      />

      {/* Edit Agent Dialog */}
      <AgentDialog
        open={!!editingAgent}
        onOpenChange={(open) => !open && setEditingAgent(null)}
        agent={editingAgent}
        onSave={handleSaveAgent}
      />
    </div>
  )
}
