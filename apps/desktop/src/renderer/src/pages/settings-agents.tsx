import { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Switch } from "@renderer/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@renderer/components/ui/tabs"
import { Trash2, Plus, Edit2, Save, X, Server, Sparkles, Brain, Settings2 } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { ModelSelector } from "@renderer/components/model-selector"
import {
  AgentProfile, AgentProfileConnectionType, AgentProfileConnection,
  ProfileModelConfig, AgentProfileToolConfig, ProfileSkillsConfig, AgentSkill,
} from "../../../shared/types"

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
  modelConfig?: ProfileModelConfig
  toolConfig?: AgentProfileToolConfig
  skillsConfig?: ProfileSkillsConfig
  properties?: Record<string, string>
}

type ServerInfo = { connected: boolean; toolCount: number; runtimeEnabled?: boolean; configDisabled?: boolean }

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
    modelConfig: undefined, toolConfig: undefined,
    skillsConfig: { enabledSkillIds: [] }, properties: {},
  }
}

export function SettingsAgents() {
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [editing, setEditing] = useState<EditingAgent | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [serverStatus, setServerStatus] = useState<Record<string, ServerInfo>>({})
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [newPropKey, setNewPropKey] = useState("")
  const [newPropValue, setNewPropValue] = useState("")

  useEffect(() => { loadAgents() }, [])
  useEffect(() => { if (editing) { loadServers(); loadSkills() } }, [!!editing])

  const loadAgents = async () => {
    const all = await tipcClient.getAgentProfiles()
    setAgents(all)
  }
  const loadServers = async () => {
    try { const s = await tipcClient.getMcpServerStatus(); setServerStatus(s as Record<string, ServerInfo>) } catch {}
  }
  const loadSkills = async () => {
    try { const s = await tipcClient.getSkills(); setSkills(s) } catch {}
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
      modelConfig: agent.modelConfig ? { ...agent.modelConfig } : undefined,
      toolConfig: agent.toolConfig ? { ...agent.toolConfig } : undefined,
      skillsConfig: agent.skillsConfig ? { ...agent.skillsConfig } : { enabledSkillIds: [] },
      properties: agent.properties ? { ...agent.properties } : {},
    })
  }

  const handleSave = async () => {
    if (!editing) return
    const connection: AgentProfileConnection = {
      type: editing.connectionType, command: editing.connectionCommand,
      args: editing.connectionArgs?.split(" ").filter(Boolean),
      baseUrl: editing.connectionBaseUrl,
    }
    const data: any = {
      name: editing.name, displayName: editing.displayName,
      description: editing.description || undefined,
      systemPrompt: editing.systemPrompt || undefined,
      guidelines: editing.guidelines || undefined,
      connection, enabled: editing.enabled,
      isUserProfile: false, isAgentTarget: true,
      autoSpawn: editing.autoSpawn,
      modelConfig: editing.modelConfig,
      toolConfig: editing.toolConfig,
      skillsConfig: editing.skillsConfig,
      properties: editing.properties && Object.keys(editing.properties).length > 0 ? editing.properties : undefined,
    }
    if (isCreating) await tipcClient.createAgentProfile({ profile: data })
    else if (editing.id) await tipcClient.updateAgentProfile({ id: editing.id, updates: data })
    setEditing(null); setIsCreating(false); setNewPropKey(""); setNewPropValue(""); loadAgents()
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this agent?")) return
    await tipcClient.deleteAgentProfile({ id }); loadAgents()
  }

  const handleCancel = () => { setEditing(null); setIsCreating(false); setNewPropKey(""); setNewPropValue("") }

  // Tool config helpers
  const isServerEnabled = (serverName: string): boolean => {
    if (!editing?.toolConfig) return true
    if (editing.toolConfig.allServersDisabledByDefault) {
      return (editing.toolConfig.enabledServers || []).includes(serverName)
    }
    return !(editing.toolConfig.disabledServers || []).includes(serverName)
  }

  const toggleServer = (serverName: string) => {
    if (!editing) return
    const tc = { ...editing.toolConfig } as AgentProfileToolConfig
    if (tc.allServersDisabledByDefault) {
      const enabled = [...(tc.enabledServers || [])]
      const idx = enabled.indexOf(serverName)
      if (idx >= 0) enabled.splice(idx, 1); else enabled.push(serverName)
      setEditing({ ...editing, toolConfig: { ...tc, enabledServers: enabled } })
    } else {
      const disabled = [...(tc.disabledServers || [])]
      const idx = disabled.indexOf(serverName)
      if (idx >= 0) disabled.splice(idx, 1); else disabled.push(serverName)
      setEditing({ ...editing, toolConfig: { ...tc, disabledServers: disabled } })
    }
  }

  // Skill config helpers
  const isSkillEnabled = (skillId: string): boolean => {
    return (editing?.skillsConfig?.enabledSkillIds || []).includes(skillId)
  }
  const toggleSkill = (skillId: string) => {
    if (!editing) return
    const ids = [...(editing.skillsConfig?.enabledSkillIds || [])]
    const idx = ids.indexOf(skillId)
    if (idx >= 0) ids.splice(idx, 1); else ids.push(skillId)
    setEditing({ ...editing, skillsConfig: { ...editing.skillsConfig, enabledSkillIds: ids } })
  }

  // Property helpers
  const addProperty = () => {
    if (!editing || !newPropKey.trim()) return
    setEditing({ ...editing, properties: { ...editing.properties, [newPropKey.trim()]: newPropValue } })
    setNewPropKey(""); setNewPropValue("")
  }
  const removeProperty = (key: string) => {
    if (!editing?.properties) return
    const { [key]: _, ...rest } = editing.properties
    setEditing({ ...editing, properties: rest })
  }

  // Model config helper
  const updateModelConfig = (updates: Partial<ProfileModelConfig>) => {
    if (!editing) return
    setEditing({ ...editing, modelConfig: { ...editing.modelConfig, ...updates } })
  }

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
                {(agent.toolConfig?.enabledServers?.length ?? 0) > 0 && (
                  <Badge variant="outline"><Server className="h-3 w-3 mr-1" />{agent.toolConfig!.enabledServers!.length} servers</Badge>
                )}
                {(agent.skillsConfig?.enabledSkillIds?.length ?? 0) > 0 && (
                  <Badge variant="outline"><Sparkles className="h-3 w-3 mr-1" />{agent.skillsConfig!.enabledSkillIds!.length} skills</Badge>
                )}
                {agent.properties && Object.keys(agent.properties).length > 0 && (
                  <Badge variant="outline">{Object.keys(agent.properties).length} props</Badge>
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
    const isInternal = editing.connectionType === "internal"
    const serverNames = Object.keys(serverStatus).filter(n => n !== "speakmcp-settings")

    return (
      <Card>
        <CardHeader>
          <CardTitle>{isCreating ? "Create Agent" : `Edit: ${editing.displayName || editing.name}`}</CardTitle>
          <CardDescription>Configure agent identity, behavior, model, tools, and skills.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="mb-4 flex-wrap h-auto gap-1">
              <TabsTrigger value="general" className="gap-1.5"><Settings2 className="h-3.5 w-3.5" />General</TabsTrigger>
              {isInternal && <TabsTrigger value="behavior" className="gap-1.5"><Brain className="h-3.5 w-3.5" />Behavior</TabsTrigger>}
              {isInternal && <TabsTrigger value="model" className="gap-1.5"><Brain className="h-3.5 w-3.5" />Model</TabsTrigger>}
              <TabsTrigger value="tools" className="gap-1.5"><Server className="h-3.5 w-3.5" />Tools</TabsTrigger>
              <TabsTrigger value="skills" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" />Skills</TabsTrigger>
              <TabsTrigger value="properties" className="gap-1.5">Properties</TabsTrigger>
            </TabsList>

            {/* ── General Tab ── */}
            <TabsContent value="general" className="space-y-4">
              {isCreating && (
                <div className="space-y-2">
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
              <div className="flex items-center gap-4 pt-2">
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
            </TabsContent>

            {/* ── Behavior Tab (internal only) ── */}
            {isInternal && (
              <TabsContent value="behavior" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Define the agent&apos;s system prompt and behavioral guidelines. These are injected into every conversation.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="systemPrompt">System Prompt</Label>
                  <Textarea id="systemPrompt" value={editing.systemPrompt} onChange={e => setEditing({ ...editing, systemPrompt: e.target.value })} rows={6} placeholder="You are a helpful assistant..." className="font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guidelines">Guidelines</Label>
                  <Textarea id="guidelines" value={editing.guidelines} onChange={e => setEditing({ ...editing, guidelines: e.target.value })} rows={4} placeholder="Additional behavioral guidelines..." className="font-mono text-sm" />
                </div>
              </TabsContent>
            )}

            {/* ── Model Tab (internal only) ── */}
            {isInternal && (
              <TabsContent value="model" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Choose which LLM provider and model this agent uses. Leave unset to use global defaults.
                </p>
                <div className="space-y-2">
                  <Label>LLM Provider</Label>
                  <Select
                    value={editing.modelConfig?.mcpToolsProviderId ?? "__global__"}
                    onValueChange={v => {
                      if (v === "__global__") {
                        setEditing({ ...editing, modelConfig: undefined })
                      } else {
                        updateModelConfig({ mcpToolsProviderId: v as "openai" | "groq" | "gemini" })
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__global__">Use global default</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="groq">Groq</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editing.modelConfig?.mcpToolsProviderId && (
                  <ModelSelector
                    providerId={editing.modelConfig.mcpToolsProviderId}
                    value={
                      editing.modelConfig.mcpToolsProviderId === "openai" ? editing.modelConfig.mcpToolsOpenaiModel :
                      editing.modelConfig.mcpToolsProviderId === "groq" ? editing.modelConfig.mcpToolsGroqModel :
                      editing.modelConfig.mcpToolsGeminiModel
                    }
                    onValueChange={model => {
                      const p = editing.modelConfig?.mcpToolsProviderId
                      if (p === "openai") updateModelConfig({ mcpToolsOpenaiModel: model })
                      else if (p === "groq") updateModelConfig({ mcpToolsGroqModel: model })
                      else if (p === "gemini") updateModelConfig({ mcpToolsGeminiModel: model })
                    }}
                    label="Agent Model"
                    placeholder="Select model for this agent"
                  />
                )}
              </TabsContent>
            )}

            {/* ── Tools Tab ── */}
            <TabsContent value="tools" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Control which MCP servers and their tools this agent can access.
              </p>
              <div className="flex items-center space-x-2 pb-2">
                <Switch
                  id="allServersDisabled"
                  checked={editing.toolConfig?.allServersDisabledByDefault ?? false}
                  onCheckedChange={v => setEditing({
                    ...editing,
                    toolConfig: { ...editing.toolConfig, allServersDisabledByDefault: v, enabledServers: v ? [] : undefined, disabledServers: v ? undefined : [] },
                  })}
                />
                <Label htmlFor="allServersDisabled" className="text-sm">
                  Disable all servers by default (opt-in mode)
                </Label>
              </div>
              {serverNames.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No MCP servers configured.</p>
              ) : (
                <div className="space-y-1">
                  {serverNames.map(name => {
                    const info = serverStatus[name]
                    return (
                      <div key={name} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-card">
                        <div className="flex items-center gap-3 min-w-0">
                          <Switch checked={isServerEnabled(name)} onCheckedChange={() => toggleServer(name)} />
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">{name}</span>
                            {info?.connected && <Badge variant="secondary" className="text-[10px] px-1.5">connected</Badge>}
                            {info && !info.connected && <Badge variant="outline" className="text-[10px] px-1.5">offline</Badge>}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {info?.toolCount ?? 0} tools
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── Skills Tab ── */}
            <TabsContent value="skills" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enable skills to inject their specialized instructions into this agent&apos;s system prompt.
              </p>
              {skills.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No skills available. Add skills in the Skills settings page.</p>
              ) : (
                <div className="space-y-1">
                  {skills.map(skill => (
                    <div key={skill.id} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-card">
                      <div className="flex items-center gap-3 min-w-0">
                        <Switch checked={isSkillEnabled(skill.id)} onCheckedChange={() => toggleSkill(skill.id)} />
                        <div className="min-w-0">
                          <span className="font-medium truncate block">{skill.name}</span>
                          {skill.description && <span className="text-xs text-muted-foreground truncate block">{skill.description}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Properties Tab ── */}
            <TabsContent value="properties" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Dynamic key-value properties that are exposed in the agent&apos;s system prompt as variables.
              </p>
              {editing.properties && Object.keys(editing.properties).length > 0 && (
                <div className="space-y-1">
                  {Object.entries(editing.properties).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card">
                      <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">{key}</code>
                      <span className="text-sm flex-1 truncate">{val}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeProperty(key)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <div className="space-y-1 flex-1">
                  <Label className="text-xs">Key</Label>
                  <Input value={newPropKey} onChange={e => setNewPropKey(e.target.value)} placeholder="e.g., language" className="h-8 text-sm" />
                </div>
                <div className="space-y-1 flex-1">
                  <Label className="text-xs">Value</Label>
                  <Input value={newPropValue} onChange={e => setNewPropValue(e.target.value)} placeholder="e.g., TypeScript" className="h-8 text-sm"
                    onKeyDown={e => { if (e.key === "Enter") addProperty() }}
                  />
                </div>
                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={addProperty} disabled={!newPropKey.trim()}>
                  <Plus className="h-3.5 w-3.5" />Add
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" className="gap-2" onClick={handleCancel}><X className="h-4 w-4" />Cancel</Button>
            <Button className="gap-2" onClick={handleSave}><Save className="h-4 w-4" />Save</Button>
          </div>
        </CardContent>
      </Card>
    )
  }
}

export { SettingsAgents as Component }

