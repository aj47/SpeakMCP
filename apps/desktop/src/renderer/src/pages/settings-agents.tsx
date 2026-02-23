import { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Switch } from "@renderer/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import { Trash2, Plus, Edit2, Save, X } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { AgentProfile, AgentProfileConnectionType, AgentProfileConnection, AgentProfileRole } from "../../../shared/types"

type ConnectionType = AgentProfileConnectionType

interface EditingProfile {
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
  role: AgentProfileRole
  isUserProfile: boolean
  isAgentTarget: boolean
  autoSpawn?: boolean
}

function getProfileRole(profile: AgentProfile): AgentProfileRole {
  if (profile.role) return profile.role
  if (profile.isUserProfile) return "user-profile"
  if (profile.isAgentTarget && ["acp", "stdio", "remote"].includes(profile.connection.type)) return "external-agent"
  if (profile.isAgentTarget) return "delegation-target"
  return "delegation-target"
}

const AGENT_PRESETS: Record<string, Partial<EditingProfile>> = {
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

function emptyProfileForRole(role: AgentProfileRole): EditingProfile {
  return {
    name: "", displayName: "", description: "", systemPrompt: "", guidelines: "",
    connectionType: role === "external-agent" ? "acp" : "internal",
    enabled: true, role,
    isUserProfile: role === "user-profile",
    isAgentTarget: role !== "user-profile",
  }
}

export function SettingsAgents() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [editing, setEditing] = useState<EditingProfile | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [activeTab, setActiveTab] = useState<string>("user-profiles")

  useEffect(() => { loadProfiles() }, [])
  const loadProfiles = async () => { setProfiles(await tipcClient.getAgentProfiles()) }

  const userProfiles = profiles.filter(p => getProfileRole(p) === "user-profile")
  const personas = profiles.filter(p => getProfileRole(p) === "delegation-target")
  const externalAgents = profiles.filter(p => getProfileRole(p) === "external-agent")

  const handleCreate = (role: AgentProfileRole) => {
    setIsCreating(true)
    setEditing(emptyProfileForRole(role))
  }

  const handleEdit = (profile: AgentProfile) => {
    setIsCreating(false)
    setEditing({
      id: profile.id, name: profile.name, displayName: profile.displayName,
      description: profile.description ?? "", systemPrompt: profile.systemPrompt ?? "",
      guidelines: profile.guidelines ?? "", connectionType: profile.connection.type,
      connectionCommand: profile.connection.command,
      connectionArgs: profile.connection.args?.join(" "),
      connectionBaseUrl: profile.connection.baseUrl,
      enabled: profile.enabled, role: getProfileRole(profile),
      isUserProfile: profile.isUserProfile ?? false,
      isAgentTarget: profile.isAgentTarget ?? false,
      autoSpawn: profile.autoSpawn,
    })
  }

  const handleSave = async () => {
    if (!editing) return
    const connection: AgentProfileConnection = {
      type: editing.connectionType, command: editing.connectionCommand,
      args: editing.connectionArgs?.split(" ").filter(Boolean),
      baseUrl: editing.connectionBaseUrl,
    }
    const profileData = {
      name: editing.name, displayName: editing.displayName,
      description: editing.description || undefined,
      systemPrompt: editing.systemPrompt || undefined,
      guidelines: editing.guidelines || undefined,
      connection, enabled: editing.enabled, role: editing.role,
      isUserProfile: editing.isUserProfile, isAgentTarget: editing.isAgentTarget,
      autoSpawn: editing.autoSpawn,
    }
    if (isCreating) await tipcClient.createAgentProfile({ profile: profileData })
    else if (editing.id) await tipcClient.updateAgentProfile({ id: editing.id, updates: profileData })
    setEditing(null); setIsCreating(false); loadProfiles()
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this?")) return
    await tipcClient.deleteAgentProfile({ id }); loadProfiles()
  }

  const handleCancel = () => { setEditing(null); setIsCreating(false) }

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Agents</h1>
        <p className="text-muted-foreground">Manage user profiles, agent personas, and external agents</p>
      </div>
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); handleCancel() }}>
        <TabsList className="mb-4">
          <TabsTrigger value="user-profiles">User Profiles ({userProfiles.length})</TabsTrigger>
          <TabsTrigger value="personas">Personas ({personas.length})</TabsTrigger>
          <TabsTrigger value="external">External Agents ({externalAgents.length})</TabsTrigger>
        </TabsList>
        {renderTabContent("user-profiles", userProfiles, "user-profile")}
        {renderTabContent("personas", personas, "delegation-target")}
        {renderTabContent("external", externalAgents, "external-agent")}
      </Tabs>
    </div>
  )

  function renderTabContent(tabValue: string, profileList: AgentProfile[], role: AgentProfileRole) {
    const labels = { "user-profile": "Profile", "delegation-target": "Persona", "external-agent": "External Agent" }
    const label = labels[role]
    return (
      <TabsContent value={tabValue}>
        <div className="flex justify-end mb-4">
          <Button className="gap-2" onClick={() => handleCreate(role)}><Plus className="h-4 w-4" />Add {label}</Button>
        </div>
        {editing && activeTab === tabValue ? renderEditForm(role) : renderProfileList(profileList, label)}
      </TabsContent>
    )
  }

  function renderProfileList(profileList: AgentProfile[], label: string) {
    return (
      <div className="space-y-3">
        {profileList.map(profile => (
          <Card key={profile.id} className={!profile.enabled ? "opacity-60" : ""}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {profile.displayName || profile.name}
                    {profile.isBuiltIn && <Badge variant="secondary">Built-in</Badge>}
                    {profile.isDefault && <Badge variant="secondary">Default</Badge>}
                    {!profile.enabled && <Badge variant="outline">Disabled</Badge>}
                  </CardTitle>
                  <CardDescription>{profile.description || profile.guidelines?.slice(0, 100)}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(profile)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  {!profile.isBuiltIn && !profile.isDefault && (
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(profile.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline">{profile.connection.type}</Badge>
                {profile.modelConfig?.mcpToolsProviderId && (
                  <Badge variant="outline">{profile.modelConfig.mcpToolsProviderId}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {profileList.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No {label.toLowerCase()}s yet. Click "Add {label}" to create one.
          </div>
        )}
      </div>
    )
  }

  function renderEditForm(role: AgentProfileRole) {
    if (!editing) return null
    const labels = { "user-profile": "Profile", "delegation-target": "Persona", "external-agent": "External Agent" }
    const label = labels[role]
    const showConnectionFields = role !== "user-profile"
    const showSystemPrompt = editing.connectionType === "internal"
    const showPresets = isCreating && role === "external-agent"

    return (
      <Card>
        <CardHeader><CardTitle>{isCreating ? `Create ${label}` : `Edit ${label}`}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {showPresets && (
            <div className="space-y-2 mb-4">
              <Label>Quick Setup (Optional)</Label>
              <div className="flex gap-2">
                {Object.entries(AGENT_PRESETS).map(([key, preset]) => (
                  <Button key={key} variant="outline" size="sm"
                    onClick={() => setEditing({ ...emptyProfileForRole("external-agent"), ...preset })}
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

          {showConnectionFields && (
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
          )}

          {(editing.connectionType === "acp" || editing.connectionType === "stdio") && showConnectionFields && (
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

          {editing.connectionType === "remote" && showConnectionFields && (
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
            {(editing.connectionType === "acp" || editing.connectionType === "stdio") && showConnectionFields && (
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

