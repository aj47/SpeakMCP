import { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Switch } from "@renderer/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Trash2, Plus, Edit2, Save, X } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { AgentProfile, AgentProfileConnectionType, AgentProfileConnection } from "../../../shared/types"

type ConnectionType = AgentProfileConnectionType

interface EditingAgent {
  id?: string
  name: string
  displayName: string
  description: string
  systemPrompt: string
  guidelines: string
  connectionType: ConnectionType
  connectionCommand?: string
  connectionArgs?: string
  connectionBaseUrl?: string
  enabled: boolean
  autoSpawn?: boolean
}

const AGENT_PRESETS: Record<string, Partial<EditingAgent>> = {
  auggie: {
    name: "auggie", displayName: "Auggie (Augment Code)",
    description: "Augment Code's AI coding assistant with native ACP support",
    connectionType: "acp", connectionCommand: "auggie", connectionArgs: "--acp", enabled: true,
  },
  "claude-code": {
    name: "claude-code", displayName: "Claude Code",
    description: "Anthropic's Claude for coding tasks via ACP adapter",
    connectionType: "acp", connectionCommand: "claude-code-acp", connectionArgs: "", enabled: true,
  },
}

function emptyAgent(): EditingAgent {
  return {
    name: "", displayName: "", description: "", systemPrompt: "", guidelines: "",
    connectionType: "internal", enabled: true,
  }
}

export function SettingsAgents() {
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [editing, setEditing] = useState<EditingAgent | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => { loadAgents() }, [])
  const loadAgents = async () => {
    const all = await tipcClient.getAgentProfiles()
    // Filter out user profiles — agents only (delegation targets + external)
    setAgents(all.filter(p => !p.isUserProfile))
  }

  const handleCreate = () => { setIsCreating(true); setEditing(emptyAgent()) }

  const handleEdit = (agent: AgentProfile) => {
    setIsCreating(false)
    setEditing({
      id: agent.id, name: agent.name, displayName: agent.displayName,
      description: agent.description ?? "", systemPrompt: agent.systemPrompt ?? "",
      guidelines: agent.guidelines ?? "", connectionType: agent.connection.type,
      connectionCommand: agent.connection.command,
      connectionArgs: agent.connection.args?.join(" "),
      connectionBaseUrl: agent.connection.baseUrl,
      enabled: agent.enabled, autoSpawn: agent.autoSpawn,
    })
  }

  const handleSave = async () => {
    if (!editing) return
    const connection: AgentProfileConnection = {
      type: editing.connectionType, command: editing.connectionCommand,
      args: editing.connectionArgs?.split(" ").filter(Boolean),
      baseUrl: editing.connectionBaseUrl,
    }
    const data = {
      name: editing.name, displayName: editing.displayName,
      description: editing.description || undefined,
      systemPrompt: editing.systemPrompt || undefined,
      guidelines: editing.guidelines || undefined,
      connection, enabled: editing.enabled,
      isUserProfile: false, isAgentTarget: true,
      autoSpawn: editing.autoSpawn,
    }
    if (isCreating) await tipcClient.createAgentProfile({ profile: data })
    else if (editing.id) await tipcClient.updateAgentProfile({ id: editing.id, updates: data })
    setEditing(null); setIsCreating(false); loadAgents()
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this agent?")) return
    await tipcClient.deleteAgentProfile({ id }); loadAgents()
  }

  const handleCancel = () => { setEditing(null); setIsCreating(false) }

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-muted-foreground">Manage agents that can be delegated tasks. Internal agents use built-in LLM, external agents connect via ACP/stdio/remote.</p>
        </div>
        {!editing && <Button className="gap-2" onClick={handleCreate}><Plus className="h-4 w-4" />Add Agent</Button>}
      </div>
      {editing ? renderEditForm() : renderAgentList()}
    </div>
  )

  function renderAgentList() {
    return (
      <div className="space-y-3">
        {agents.map(agent => (
          <Card key={agent.id} className={!agent.enabled ? "opacity-60" : ""}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {agent.displayName || agent.name}
                    {agent.isBuiltIn && <Badge variant="secondary">Built-in</Badge>}
                    {agent.isDefault && <Badge variant="secondary">Default</Badge>}
                    {!agent.enabled && <Badge variant="outline">Disabled</Badge>}
                  </CardTitle>
                  <CardDescription>{agent.description || agent.guidelines?.slice(0, 100)}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(agent)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  {!agent.isBuiltIn && !agent.isDefault && (
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(agent.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline">{agent.connection.type}</Badge>
                {agent.modelConfig?.mcpToolsProviderId && (
                  <Badge variant="outline">{agent.modelConfig.mcpToolsProviderId}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {agents.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No agents yet. Click &quot;Add Agent&quot; to create one.
          </div>
        )}
      </div>
    )
  }

  function renderEditForm() {
    if (!editing) return null
    const showSystemPrompt = editing.connectionType === "internal"

    return (
      <Card>
        <CardHeader><CardTitle>{isCreating ? "Create Agent" : "Edit Agent"}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {isCreating && (
            <div className="space-y-2 mb-4">
              <Label>Quick Setup (Optional)</Label>
              <div className="flex gap-2">
                {Object.entries(AGENT_PRESETS).map(([key, preset]) => (
                  <Button key={key} variant="outline" size="sm"
                    onClick={() => setEditing({ ...emptyAgent(), ...preset })}
                  >{preset.displayName}</Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Click a preset to auto-fill, or configure manually below.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name (slug)</Label>
              <Input id="name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="my-agent" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input id="displayName" value={editing.displayName} onChange={e => setEditing({ ...editing, displayName: e.target.value })} placeholder="My Agent" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="What this agent does..." />
          </div>

          <div className="space-y-2">
            <Label htmlFor="connectionType">Connection Type</Label>
            <Select value={editing.connectionType} onValueChange={(v: ConnectionType) => setEditing({ ...editing, connectionType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Internal (built-in agent)</SelectItem>
                <SelectItem value="acp">ACP (external agent)</SelectItem>
                <SelectItem value="stdio">Stdio (process spawn)</SelectItem>
                <SelectItem value="remote">Remote (HTTP endpoint)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(editing.connectionType === "acp" || editing.connectionType === "stdio") && (
            <>
              <div className="space-y-2">
                <Label htmlFor="command">Command</Label>
                <Input id="command" value={editing.connectionCommand ?? ""} onChange={e => setEditing({ ...editing, connectionCommand: e.target.value })} placeholder="e.g., claude-code-acp" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="args">Arguments (space-separated)</Label>
                <Input id="args" value={editing.connectionArgs ?? ""} onChange={e => setEditing({ ...editing, connectionArgs: e.target.value })} placeholder="e.g., --acp" />
              </div>
            </>
          )}

          {editing.connectionType === "remote" && (
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input id="baseUrl" value={editing.connectionBaseUrl ?? ""} onChange={e => setEditing({ ...editing, connectionBaseUrl: e.target.value })} placeholder="e.g., http://localhost:8000" />
            </div>
          )}

          {showSystemPrompt && (
            <>
              <div className="space-y-2">
                <Label htmlFor="systemPrompt">System Prompt</Label>
                <Textarea id="systemPrompt" value={editing.systemPrompt} onChange={e => setEditing({ ...editing, systemPrompt: e.target.value })} rows={4} placeholder="You are a helpful assistant..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guidelines">Guidelines</Label>
                <Textarea id="guidelines" value={editing.guidelines} onChange={e => setEditing({ ...editing, guidelines: e.target.value })} rows={3} placeholder="Additional behavioral guidelines..." />
              </div>
            </>
          )}

          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch id="enabled" checked={editing.enabled} onCheckedChange={v => setEditing({ ...editing, enabled: v })} />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
            {(editing.connectionType === "acp" || editing.connectionType === "stdio") && (
              <div className="flex items-center space-x-2">
                <Switch id="autoSpawn" checked={editing.autoSpawn ?? false} onCheckedChange={v => setEditing({ ...editing, autoSpawn: v })} />
                <Label htmlFor="autoSpawn">Auto-spawn on startup</Label>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" className="gap-2" onClick={handleCancel}><X className="h-4 w-4" />Cancel</Button>
            <Button className="gap-2" onClick={handleSave}><Save className="h-4 w-4" />Save</Button>
          </div>
        </CardContent>
      </Card>
    )
  }
}

export { SettingsAgents as Component }

