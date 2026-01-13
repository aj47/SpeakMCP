import { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Switch } from "@renderer/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Trash2, Plus, Edit2, Save, X } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { AgentProfile, AgentProfileConnectionType, AgentProfileConnection, AgentProfileRole } from "../../../shared/types"

type ConnectionType = AgentProfileConnectionType

interface EditingProfile {
  id?: string
  name: string
  displayName: string
  description: string
  capabilities: string[]
  connectionType: ConnectionType
  connectionCommand?: string
  connectionArgs?: string
  connectionBaseUrl?: string
  enabled: boolean
  role: AgentProfileRole
  autoSpawn?: boolean
}

const emptyProfile: EditingProfile = {
  name: "", displayName: "", description: "", capabilities: [],
  connectionType: "acp", enabled: true, role: "external-agent",
}

const AGENT_PRESETS: Record<string, Partial<EditingProfile>> = {
  auggie: {
    name: "auggie", displayName: "Auggie (Augment Code)",
    description: "Augment Code's AI coding assistant with native ACP support",
    capabilities: ["coding", "debugging", "refactoring", "documentation"],
    connectionType: "acp", connectionCommand: "auggie", connectionArgs: "--acp", enabled: true,
  },
  "claude-code": {
    name: "claude-code", displayName: "Claude Code",
    description: "Anthropic's Claude for coding tasks via ACP adapter",
    capabilities: ["coding", "debugging", "refactoring"],
    connectionType: "acp", connectionCommand: "claude-code-acp", connectionArgs: "", enabled: true,
  },
}

function isExternalAgent(profile: AgentProfile): boolean {
  if (profile.role === "external-agent") return true
  return profile.isAgentTarget === true && ["acp", "stdio", "remote"].includes(profile.connection.type)
}

export function SettingsExternalAgents() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [editing, setEditing] = useState<EditingProfile | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => { loadProfiles() }, [])
  const loadProfiles = async () => { setProfiles(await tipcClient.getAgentProfiles()) }
  const externalAgents = profiles.filter(isExternalAgent)

  const handleCreate = () => { setIsCreating(true); setEditing({ ...emptyProfile }) }
  const handleCancel = () => { setEditing(null); setIsCreating(false) }
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this external agent?")) return
    await tipcClient.deleteAgentProfile({ id }); loadProfiles()
  }
  const handleEdit = (profile: AgentProfile) => {
    setIsCreating(false)
    setEditing({
      id: profile.id, name: profile.name, displayName: profile.displayName,
      description: profile.description ?? "", capabilities: profile.capabilities ?? [],
      connectionType: profile.connection.type, connectionCommand: profile.connection.command,
      connectionArgs: profile.connection.args?.join(" "), connectionBaseUrl: profile.connection.baseUrl,
      enabled: profile.enabled, role: "external-agent", autoSpawn: profile.autoSpawn,
    })
  }
  const handleSave = async () => {
    if (!editing) return
    const connection: AgentProfileConnection = {
      type: editing.connectionType, command: editing.connectionCommand,
      args: editing.connectionArgs?.split(" ").filter(Boolean), baseUrl: editing.connectionBaseUrl,
    }
    const profileData = {
      name: editing.name, displayName: editing.displayName,
      description: editing.description || undefined,
      capabilities: editing.capabilities.length > 0 ? editing.capabilities : undefined,
      connection, enabled: editing.enabled, role: "external-agent" as const,
      isUserProfile: false, isAgentTarget: true, autoSpawn: editing.autoSpawn,
    }
    if (isCreating) await tipcClient.createAgentProfile({ profile: profileData })
    else if (editing.id) await tipcClient.updateAgentProfile({ id: editing.id, updates: profileData })
    setEditing(null); setIsCreating(false); loadProfiles()
  }

  const renderProfileList = (profileList: AgentProfile[]) => (
    <div className="space-y-4">
      {profileList.map((profile) => (
        <Card key={profile.id} className={!profile.enabled ? "opacity-60" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  {profile.displayName}
                  {profile.isBuiltIn && <Badge variant="secondary">Built-in</Badge>}
                  {!profile.enabled && <Badge variant="outline">Disabled</Badge>}
                </CardTitle>
                <CardDescription>{profile.description}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => handleEdit(profile)}><Edit2 className="h-4 w-4" /></Button>
                {!profile.isBuiltIn && (
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(profile.id)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline">{profile.connection.type}</Badge>
              {profile.capabilities?.map((cap) => <Badge key={cap} variant="secondary">{cap}</Badge>)}
            </div>
          </CardContent>
        </Card>
      ))}
      {profileList.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No external agents configured. Click "Add External Agent" to connect one.
        </div>
      )}
    </div>
  )

  const renderEditForm = () => {
    if (!editing) return null
    return (
      <Card>
        <CardHeader><CardTitle>{isCreating ? "Add External Agent" : "Edit External Agent"}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {isCreating && (
            <div className="space-y-2 mb-4">
              <Label>Quick Setup (Optional)</Label>
              <div className="flex gap-2">
                {Object.entries(AGENT_PRESETS).map(([key, preset]) => (
                  <Button key={key} variant="outline" size="sm" onClick={() => setEditing({ ...emptyProfile, ...preset })}>{preset.displayName}</Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Click a preset to auto-fill the form, or configure manually below.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name (slug)</Label>
              <Input id="name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="my-agent" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input id="displayName" value={editing.displayName} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} placeholder="My Agent" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="What this agent does..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="connectionType">Connection Type</Label>
            <Select value={editing.connectionType} onValueChange={(v: ConnectionType) => setEditing({ ...editing, connectionType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="acp">ACP (Agent Communication Protocol)</SelectItem>
                <SelectItem value="stdio">Stdio (process spawn)</SelectItem>
                <SelectItem value="remote">Remote (HTTP endpoint)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(editing.connectionType === "acp" || editing.connectionType === "stdio") && (
            <>
              <div className="space-y-2">
                <Label htmlFor="command">Command</Label>
                <Input id="command" value={editing.connectionCommand ?? ""} onChange={(e) => setEditing({ ...editing, connectionCommand: e.target.value })} placeholder="e.g., claude-code-acp" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="args">Arguments (space-separated)</Label>
                <Input id="args" value={editing.connectionArgs ?? ""} onChange={(e) => setEditing({ ...editing, connectionArgs: e.target.value })} placeholder="e.g., --acp" />
              </div>
            </>
          )}
          {editing.connectionType === "remote" && (
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input id="baseUrl" value={editing.connectionBaseUrl ?? ""} onChange={(e) => setEditing({ ...editing, connectionBaseUrl: e.target.value })} placeholder="e.g., http://localhost:8000" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="capabilities">Capabilities (comma-separated)</Label>
            <Input id="capabilities" value={editing.capabilities.join(", ")} onChange={(e) => setEditing({ ...editing, capabilities: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="e.g., coding, research" />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch id="enabled" checked={editing.enabled} onCheckedChange={(v) => setEditing({ ...editing, enabled: v })} />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
            {(editing.connectionType === "acp" || editing.connectionType === "stdio") && (
              <div className="flex items-center space-x-2">
                <Switch id="autoSpawn" checked={editing.autoSpawn ?? false} onCheckedChange={(v) => setEditing({ ...editing, autoSpawn: v })} />
                <Label htmlFor="autoSpawn">Auto-spawn on startup</Label>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleCancel}><X className="h-4 w-4 mr-2" />Cancel</Button>
            <Button onClick={handleSave}><Save className="h-4 w-4 mr-2" />Save</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">External Agents</h1>
          <p className="text-muted-foreground">Configure external AI agents (ACP, Stdio, Remote) for delegation</p>
        </div>
        <Button onClick={handleCreate}><Plus className="h-4 w-4 mr-2" />Add External Agent</Button>
      </div>
      {editing ? renderEditForm() : renderProfileList(externalAgents)}
    </div>
  )
}

export { SettingsExternalAgents as Component }
