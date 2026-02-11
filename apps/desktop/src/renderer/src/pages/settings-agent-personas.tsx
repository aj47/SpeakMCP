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
  workingDirectory?: string
  enabled: boolean
  role: AgentProfileRole
  isUserProfile: boolean
  isAgentTarget: boolean
  autoSpawn?: boolean
}

const emptyProfile: EditingProfile = {
  name: "",
  displayName: "",
  description: "",
  systemPrompt: "",
  guidelines: "",
  connectionType: "internal",
  workingDirectory: "",
  enabled: true,
  role: "delegation-target",
  isUserProfile: false,
  isAgentTarget: true,
}

/**
 * Helper to determine profile role from role field or legacy flags.
 */
function getProfileRole(profile: AgentProfile): AgentProfileRole {
  // Use role field if present
  if (profile.role) {
    return profile.role
  }
  // Fall back to legacy flags
  if (profile.isUserProfile) {
    return "user-profile"
  }
  // External agents have acp/stdio/remote connection types
  if (profile.isAgentTarget &&
      (profile.connection.type === "acp" ||
       profile.connection.type === "stdio" ||
       profile.connection.type === "remote")) {
    return "external-agent"
  }
  // Default to delegation-target if isAgentTarget is true
  if (profile.isAgentTarget) {
    return "delegation-target"
  }
  // Default fallback
  return "delegation-target"
}

export function SettingsAgentPersonas() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [editing, setEditing] = useState<EditingProfile | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    loadProfiles()
  }, [])

  const loadProfiles = async () => {
    const result = await tipcClient.getAgentProfiles()
    setProfiles(result)
  }

  // Filter profiles to only show agent personas (delegation targets)
  const agentPersonas = profiles.filter((p) => getProfileRole(p) === "delegation-target")

  const handleCreate = () => {
    setIsCreating(true)
    // Always create as delegation-target (agent persona)
    setEditing({
      ...emptyProfile,
      role: "delegation-target",
      isUserProfile: false,
      isAgentTarget: true,
      connectionType: "internal",
    })
  }

  const handleEdit = (profile: AgentProfile) => {
    setIsCreating(false)
    const role = getProfileRole(profile)
    setEditing({
      id: profile.id,
      name: profile.name,
      displayName: profile.displayName,
      description: profile.description ?? "",
      systemPrompt: profile.systemPrompt ?? "",
      guidelines: profile.guidelines ?? "",
      connectionType: profile.connection.type,
      connectionCommand: profile.connection.command,
      connectionArgs: profile.connection.args?.join(" "),
      connectionBaseUrl: profile.connection.baseUrl,
      workingDirectory: profile.workingDirectory,
      enabled: profile.enabled,
      role: role,
      isUserProfile: profile.isUserProfile ?? false,
      isAgentTarget: profile.isAgentTarget ?? false,
      autoSpawn: profile.autoSpawn,
    })
  }

  const handleSave = async () => {
    if (!editing) return

    const connection: AgentProfileConnection = {
      type: editing.connectionType,
      command: editing.connectionCommand,
      args: editing.connectionArgs?.split(" ").filter(Boolean),
      baseUrl: editing.connectionBaseUrl,
    }

    const profileData = {
      name: editing.name,
      displayName: editing.displayName,
      description: editing.description || undefined,
      systemPrompt: editing.systemPrompt || undefined,
      guidelines: editing.guidelines || undefined,
      connection,
      workingDirectory: editing.workingDirectory || undefined,
      enabled: editing.enabled,
      role: editing.role,
      isUserProfile: editing.isUserProfile,
      isAgentTarget: editing.isAgentTarget,
      autoSpawn: editing.autoSpawn,
    }

    if (isCreating) {
      await tipcClient.createAgentProfile({ profile: profileData })
    } else if (editing.id) {
      await tipcClient.updateAgentProfile({
        id: editing.id,
        updates: profileData
      })
    }

    setEditing(null)
    setIsCreating(false)
    loadProfiles()
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this profile?")) return
    await tipcClient.deleteAgentProfile({ id })
    loadProfiles()
  }

  const handleCancel = () => {
    setEditing(null)
    setIsCreating(false)
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
                <Button variant="ghost" size="icon" onClick={() => handleEdit(profile)}>
                  <Edit2 className="h-4 w-4" />
                </Button>
                {!profile.isBuiltIn && (
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
            </div>
          </CardContent>
        </Card>
      ))}
      {profileList.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No personas yet. Click "Add Persona" to create one.
        </div>
      )}
    </div>
  )

  const renderEditForm = () => {
    if (!editing) return null

    return (
      <Card>
        <CardHeader>
          <CardTitle>{isCreating ? "Create Persona" : "Edit Persona"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name (slug)</Label>
              <Input
                id="name"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="my-agent"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={editing.displayName}
                onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
                placeholder="My Agent"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="What this agent does..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="connectionType">Connection Type</Label>
            <Select
              value={editing.connectionType}
              onValueChange={(v: ConnectionType) => setEditing({ ...editing, connectionType: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
                <Input
                  id="command"
                  value={editing.connectionCommand ?? ""}
                  onChange={(e) => setEditing({ ...editing, connectionCommand: e.target.value })}
                  placeholder="e.g., claude-code-acp"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="args">Arguments (space-separated)</Label>
                <Input
                  id="args"
                  value={editing.connectionArgs ?? ""}
                  onChange={(e) => setEditing({ ...editing, connectionArgs: e.target.value })}
                  placeholder="e.g., --acp"
                />
              </div>
            </>
          )}

          {editing.connectionType === "remote" && (
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                value={editing.connectionBaseUrl ?? ""}
                onChange={(e) => setEditing({ ...editing, connectionBaseUrl: e.target.value })}
                placeholder="e.g., http://localhost:8000"
              />
            </div>
          )}

          {editing.connectionType === "internal" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="systemPrompt">System Prompt</Label>
                <Textarea
                  id="systemPrompt"
                  value={editing.systemPrompt}
                  onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                  rows={4}
                  placeholder="You are a helpful assistant..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guidelines">Guidelines</Label>
                <Textarea
                  id="guidelines"
                  value={editing.guidelines}
                  onChange={(e) => setEditing({ ...editing, guidelines: e.target.value })}
                  rows={3}
                  placeholder="Additional behavioral guidelines..."
                />
              </div>
            </>
          )}

          {/* Working Directory - shown for all connection types */}
          <div className="space-y-2">
            <Label htmlFor="workingDirectory">Working Directory</Label>
            <Input
              id="workingDirectory"
              value={editing.workingDirectory ?? ""}
              onChange={(e) => setEditing({ ...editing, workingDirectory: e.target.value })}
              placeholder="e.g., ~/projects/my-project (leave empty for app's CWD)"
            />
            <p className="text-sm text-muted-foreground">
              The directory the agent will use for file operations. Supports ~ for home directory.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={editing.enabled}
                onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
              />
              <Label htmlFor="enabled">Enabled</Label>
            </div>

            {(editing.connectionType === "acp" || editing.connectionType === "stdio") && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="autoSpawn"
                  checked={editing.autoSpawn ?? false}
                  onCheckedChange={(v) => setEditing({ ...editing, autoSpawn: v })}
                />
                <Label htmlFor="autoSpawn">Auto-spawn on startup</Label>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleCancel}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Agent Personas</h1>
          <p className="text-muted-foreground">
            Configure personas that can be delegated to for specialized tasks
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Persona
        </Button>
      </div>

      {editing ? renderEditForm() : renderProfileList(agentPersonas)}
    </div>
  )
}

export { SettingsAgentPersonas as Component }

