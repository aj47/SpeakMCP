import { useState, useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Switch } from "@renderer/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@renderer/components/ui/tabs"
import { Trash2, Plus, Edit2, Save, X, Server, Sparkles, Brain, Settings2, ChevronDown, ChevronRight, Wrench } from "lucide-react"
import { Facehash } from "facehash"

// Curated palette of vivid colors to pick from deterministically
const AVATAR_PALETTE = [
  "#ef4444","#f97316","#eab308","#22c55e","#14b8a6",
  "#3b82f6","#8b5cf6","#ec4899","#06b6d4","#84cc16",
  "#f43f5e","#a855f7","#0ea5e9","#10b981","#f59e0b",
  "#e11d48","#7c3aed","#0891b2","#059669","#d97706",
]
function agentColors(seed: string): string[] {
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0
  return [0, 7, 13].map(offset => AVATAR_PALETTE[(h + offset) % AVATAR_PALETTE.length])
}
import { tipcClient } from "@renderer/lib/tipc-client"
import { ModelSelector } from "@renderer/components/model-selector"
import {
  AgentProfile, AgentProfileConnectionType, AgentProfileConnection,
  ProfileModelConfig, AgentProfileToolConfig, ProfileSkillsConfig, AgentSkill,
} from "../../../shared/types"

type ConnectionType = AgentProfileConnectionType

interface EditingAgent {
  id?: string
  displayName: string
  description: string
  systemPrompt: string
  guidelines: string
  connectionType: ConnectionType
  connectionCommand?: string
  connectionArgs?: string
  connectionBaseUrl?: string
  connectionCwd?: string
  enabled: boolean
  autoSpawn?: boolean
  modelConfig?: ProfileModelConfig
  toolConfig?: AgentProfileToolConfig
  skillsConfig?: ProfileSkillsConfig
  properties?: Record<string, string>
  avatarDataUrl?: string | null
}

type ServerInfo = { connected: boolean; toolCount: number; runtimeEnabled?: boolean; configDisabled?: boolean }

const AGENT_PRESETS: Record<string, Partial<EditingAgent>> = {
  auggie: {
    displayName: "Auggie (Augment Code)",
    description: "Augment Code's AI coding assistant with native ACP support",
    connectionType: "acp", connectionCommand: "auggie", connectionArgs: "--acp", enabled: true,
  },
  "claude-code": {
    displayName: "Claude Code",
    description: "Anthropic's Claude for coding tasks via ACP adapter",
    connectionType: "acp", connectionCommand: "claude-code-acp", connectionArgs: "", enabled: true,
  },
}

function emptyAgent(): EditingAgent {
  return {
    displayName: "", description: "", systemPrompt: "", guidelines: "",
    connectionType: "internal", enabled: true,
    modelConfig: undefined, toolConfig: undefined,
    skillsConfig: { enabledSkillIds: [] }, properties: {},
  }
}

export function SettingsAgents() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [editing, setEditing] = useState<EditingAgent | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [serverStatus, setServerStatus] = useState<Record<string, ServerInfo>>({})
  const [allTools, setAllTools] = useState<{name: string, description: string, serverName: string}[]>([])
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [newPropKey, setNewPropKey] = useState("")
  const [newPropValue, setNewPropValue] = useState("")
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState("")
  const avatarFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadAgents()
    tipcClient.getDefaultSystemPrompt().then(setDefaultSystemPrompt).catch(console.error)
  }, [])
  useEffect(() => { if (editing) { loadServers(); loadSkills(); loadAllTools() } }, [!!editing])

  // Auto-open edit form when navigated with ?edit=<agentId>
  useEffect(() => {
    const editId = searchParams.get("edit")
    if (editId && agents.length > 0 && editing?.id !== editId) {
      const agent = agents.find(a => a.id === editId)
      if (agent) {
        handleEdit(agent)
        // Clear the param so refreshing doesn't re-trigger
        setSearchParams({}, { replace: true })
      }
    }
  }, [searchParams, agents])

  const loadAgents = async () => {
    const all = await tipcClient.getAgentProfiles()
    setAgents(all)
  }
  const loadServers = async () => {
    try { const s = await tipcClient.getMcpServerStatus(); setServerStatus(s as Record<string, ServerInfo>) } catch {}
  }
  const loadAllTools = async () => {
    try {
      const list = await tipcClient.getMcpDetailedToolList()
      setAllTools(list)
    } catch {}
  }
  const loadSkills = async () => {
    try { const s = await tipcClient.getSkills(); setSkills(s) } catch {}
  }

  const handleCreate = () => { setIsCreating(true); setEditing(emptyAgent()) }

  const handleEdit = (agent: AgentProfile) => {
    setIsCreating(false)
    setEditing({
      id: agent.id, displayName: agent.displayName,
      description: agent.description ?? "", systemPrompt: agent.systemPrompt ?? "",
      guidelines: agent.guidelines ?? "", connectionType: agent.connection.type,
      connectionCommand: agent.connection.command,
      connectionArgs: agent.connection.args?.join(" "),
      connectionBaseUrl: agent.connection.baseUrl,
      connectionCwd: agent.connection.cwd,
      enabled: agent.enabled, autoSpawn: agent.autoSpawn,
      modelConfig: agent.modelConfig ? { ...agent.modelConfig } : undefined,
      toolConfig: agent.toolConfig ? { ...agent.toolConfig } : undefined,
      skillsConfig: agent.skillsConfig ? { ...agent.skillsConfig } : { enabledSkillIds: [] },
      properties: agent.properties ? { ...agent.properties } : {},
      avatarDataUrl: agent.avatarDataUrl ?? null,
    })
  }

  const handleSave = async () => {
    if (!editing) return
    const connection: AgentProfileConnection = {
      type: editing.connectionType, command: editing.connectionCommand,
      args: editing.connectionArgs?.split(" ").filter(Boolean),
      baseUrl: editing.connectionBaseUrl,
      cwd: editing.connectionCwd,
    }
    const data: any = {
      displayName: editing.displayName,
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
      avatarDataUrl: editing.avatarDataUrl ?? null,
    }
    if (isCreating) await tipcClient.createAgentProfile({ profile: data })
    else if (editing.id) await tipcClient.updateAgentProfile({ id: editing.id, updates: data })
    setEditing(null); setIsCreating(false); setNewPropKey(""); setNewPropValue(""); loadAgents()
    // Invalidate sidebar query so it reflects changes immediately
    queryClient.invalidateQueries({ queryKey: ["agentProfilesSidebar"] })
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this agent?")) return
    await tipcClient.deleteAgentProfile({ id }); loadAgents()
    queryClient.invalidateQueries({ queryKey: ["agentProfilesSidebar"] })
  }

  const handleCancel = () => { setEditing(null); setIsCreating(false); setNewPropKey(""); setNewPropValue("") }

  // Derived tool data
  const builtinTools = allTools.filter(t => t.serverName === "speakmcp-settings")
  const externalTools = allTools.filter(t => t.serverName !== "speakmcp-settings")
  const serverNames = Object.keys(serverStatus).filter(n => n !== "speakmcp-settings")
  const toolsByServer = (serverName: string) => externalTools.filter(t => t.serverName === serverName)

  // Tool config helpers
  const isServerEnabled = (serverName: string): boolean => {
    if (!editing?.toolConfig) return true
    if (editing.toolConfig.allServersDisabledByDefault) {
      return (editing.toolConfig.enabledServers || []).includes(serverName)
    }
    return !(editing.toolConfig.disabledServers || []).includes(serverName)
  }

  const isToolDisabled = (toolName: string): boolean => {
    return (editing?.toolConfig?.disabledTools || []).includes(toolName)
  }

  const isBuiltinToolEnabled = (toolName: string): boolean => {
    const list = editing?.toolConfig?.enabledBuiltinTools
    if (!list || list.length === 0) return true
    return list.includes(toolName)
  }

  const isSkillEnabled = (skillId: string): boolean => {
    return (editing?.skillsConfig?.enabledSkillIds || []).includes(skillId)
  }

  const toggleServer = (serverName: string) => {
    if (!editing) return
    const tc = { ...(editing.toolConfig || {}) } as AgentProfileToolConfig
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

  const toggleTool = (toolName: string) => {
    if (!editing) return
    const tc = { ...(editing.toolConfig || {}) } as AgentProfileToolConfig
    const disabled = [...(tc.disabledTools || [])]
    const idx = disabled.indexOf(toolName)
    if (idx >= 0) disabled.splice(idx, 1); else disabled.push(toolName)
    setEditing({ ...editing, toolConfig: { ...tc, disabledTools: disabled } })
  }

  const toggleBuiltinTool = (toolName: string) => {
    if (!editing) return
    const tc = { ...(editing.toolConfig || {}) } as AgentProfileToolConfig
    let currentList = [...(tc.enabledBuiltinTools || [])]
    if (currentList.length === 0) {
      currentList = builtinTools.map(t => t.name).filter(n => n !== toolName)
    } else {
      const idx = currentList.indexOf(toolName)
      if (idx >= 0) currentList.splice(idx, 1)
      else {
        currentList.push(toolName)
        if (currentList.length === builtinTools.length) currentList = []
      }
    }
    setEditing({ ...editing, toolConfig: { ...tc, enabledBuiltinTools: currentList.length > 0 ? currentList : undefined } })
  }

  const toggleSkill = (skillId: string) => {
    if (!editing) return
    const ids = [...(editing.skillsConfig?.enabledSkillIds || [])]
    const idx = ids.indexOf(skillId)
    if (idx >= 0) ids.splice(idx, 1); else ids.push(skillId)
    setEditing({ ...editing, skillsConfig: { ...editing.skillsConfig, enabledSkillIds: ids } })
  }

  // Section collapse helpers
  const isSectionCollapsed = (section: string) => collapsedSections.has(section)
  const toggleSection = (section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section); else next.add(section)
      return next
    })
  }
  const toggleExpandServer = (serverName: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev)
      if (next.has(serverName)) next.delete(serverName); else next.add(serverName)
      return next
    })
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

  // Avatar upload helper
  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !editing) return
    const reader = new FileReader()
    reader.onload = () => setEditing({ ...editing, avatarDataUrl: reader.result as string })
    reader.readAsDataURL(file)
    // Reset so the same file can be re-selected
    e.target.value = ""
  }

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      {!editing && (
        <div className="flex items-center justify-end mb-4">
          <Button className="gap-2" onClick={handleCreate}><Plus className="h-4 w-4" />Add Agent</Button>
        </div>
      )}
      {editing ? renderEditForm() : renderAgentList()}
    </div>
  )

  function renderAgentList() {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 pb-12">
        {agents.map(agent => (
          <Card key={agent.id} className={`overflow-hidden flex flex-col transition-all hover:shadow-md ${!agent.enabled ? "opacity-60 grayscale-[0.5]" : ""}`}>
            <CardHeader className="p-3 pb-2 flex flex-row items-start gap-3 flex-none relative">
              <div className="w-10 h-10 rounded-md shadow-sm flex items-center justify-center overflow-hidden shrink-0 bg-muted">
                {agent.avatarDataUrl
                  ? <img src={agent.avatarDataUrl} alt={agent.displayName} className="w-full h-full object-cover" />
                  : <Facehash name={agent.id} size={40} colors={agentColors(agent.id)} />
                }
              </div>
              <div className="flex flex-col min-w-0 flex-1 pr-14">
                <CardTitle className="text-sm font-semibold truncate leading-none mt-0.5">
                  {agent.displayName}
                </CardTitle>
                <CardDescription className="line-clamp-2 mt-1 text-[11px] leading-tight min-h-[1.75rem]">
                  {agent.description || agent.guidelines?.slice(0, 100) || "No description provided."}
                </CardDescription>
              </div>
              <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                {agent.isBuiltIn && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 shadow-sm font-medium">Built-in</Badge>}
                {agent.isDefault && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 shadow-sm font-medium">Default</Badge>}
                {!agent.enabled && <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 bg-background/50 shadow-sm font-medium">Disabled</Badge>}
              </div>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col justify-end pt-1 pb-2 px-3">
              <div className="flex gap-1 flex-wrap mb-2.5">
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-muted/30 font-normal">{agent.connection.type}</Badge>
                {agent.modelConfig?.mcpToolsProviderId && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 truncate max-w-[80px] bg-muted/30 font-normal" title={agent.modelConfig.mcpToolsProviderId}>{agent.modelConfig.mcpToolsProviderId}</Badge>
                )}
                {(agent.toolConfig?.enabledServers?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-muted/30 font-normal"><Server className="h-2.5 w-2.5 mr-0.5 text-muted-foreground" />{agent.toolConfig!.enabledServers!.length}</Badge>
                )}
                {(agent.skillsConfig?.enabledSkillIds?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-muted/30 font-normal"><Sparkles className="h-2.5 w-2.5 mr-0.5 text-muted-foreground" />{agent.skillsConfig!.enabledSkillIds!.length}</Badge>
                )}
                {agent.properties && Object.keys(agent.properties).length > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-muted/30 font-normal">{Object.keys(agent.properties).length} props</Badge>
                )}
              </div>
              <div className="flex items-center gap-1 pt-2 border-t mt-auto">
                <Button variant="ghost" size="sm" className="flex-1 h-6 text-[11px] text-muted-foreground hover:text-foreground px-0" onClick={() => handleEdit(agent)}>
                  <Edit2 className="h-3 w-3 mr-1" /> Edit
                </Button>
                {!agent.isBuiltIn && !agent.isDefault && (
                  <>
                    <div className="w-[1px] h-3 bg-border"></div>
                    <Button variant="ghost" size="sm" className="flex-1 h-6 text-[11px] text-destructive/80 hover:text-destructive hover:bg-destructive/10 px-0" onClick={() => handleDelete(agent.id)}>
                      <Trash2 className="h-3 w-3 mr-1" /> Delete
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {agents.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground border-2 border-dashed rounded-xl">
            No agents yet. Click &quot;Add Agent&quot; to create one.
          </div>
        )}
      </div>
    )
  }

  function renderEditForm() {
    if (!editing) return null
    const isInternal = editing.connectionType === "internal"

    return (
      <Card>
        <CardHeader>
          <CardTitle>{isCreating ? "Create Agent" : `Edit: ${editing.displayName}`}</CardTitle>
          <CardDescription>Configure agent identity, behavior, model, and capabilities.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="mb-4 flex-wrap h-auto gap-1">
              <TabsTrigger value="general" className="gap-1.5"><Settings2 className="h-3.5 w-3.5" />General</TabsTrigger>
              {isInternal && <TabsTrigger value="model" className="gap-1.5"><Brain className="h-3.5 w-3.5" />Model</TabsTrigger>}
              <TabsTrigger value="capabilities" className="gap-1.5"><Wrench className="h-3.5 w-3.5" />Capabilities</TabsTrigger>
              <TabsTrigger value="properties" className="gap-1.5">Properties</TabsTrigger>
            </TabsList>

            {/* ── General Tab ── */}
            <TabsContent value="general" className="space-y-4">
              {/* Avatar upload */}
              <div className="space-y-2">
                <Label>Avatar</Label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl border-2 border-border overflow-hidden flex items-center justify-center bg-muted/40 flex-shrink-0">
                    {editing.avatarDataUrl
                      ? <img src={editing.avatarDataUrl} alt="avatar" className="w-full h-full object-cover" />
                      : <Facehash name={editing.id || "new"} size={64} colors={agentColors(editing.id || "new")} />
                    }
                  </div>
                  <div className="flex flex-col gap-2">
                    <input ref={avatarFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
                    <Button type="button" variant="outline" size="sm" onClick={() => avatarFileInputRef.current?.click()}>
                      Upload photo
                    </Button>
                    {editing.avatarDataUrl && (
                      <Button type="button" variant="ghost" size="sm" className="text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setEditing({ ...editing, avatarDataUrl: null })}>
                        Remove photo
                      </Button>
                    )}
                  </div>
                </div>
              </div>
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
              <div className="space-y-2">
                <Label htmlFor="displayName">Name</Label>
                <Input id="displayName" value={editing.displayName} onChange={e => setEditing({ ...editing, displayName: e.target.value })} placeholder="My Agent" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="What this agent does..." />
                <p className="text-[11px] text-muted-foreground">Shown only in the UI. Not visible to the agent—use Guidelines for instructions.</p>
              </div>
              {isInternal && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="guidelines">Guidelines</Label>
                    <Textarea id="guidelines" value={editing.guidelines} onChange={e => setEditing({ ...editing, guidelines: e.target.value })} rows={4} placeholder="e.g. You are an expert in React. Always check types before writing code..." className="font-mono text-sm" />
                    <p className="text-xs text-muted-foreground">
                      Additional instructions for this agent. These are appended to the core tool-calling system prompt.
                    </p>
                  </div>
                  <div className="space-y-2 pt-2 border-t">
                    <div
                      className="flex items-center gap-2 cursor-pointer select-none"
                      onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                    >
                      {showSystemPrompt ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <Label className="cursor-pointer font-semibold">Base System Prompt (Advanced)</Label>
                    </div>
                    {showSystemPrompt && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground text-amber-600 dark:text-amber-500">
                            Not recommended to change. This replaces the core tool-calling instructions. Leave empty to use the default.
                          </p>
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setEditing({ ...editing, systemPrompt: "" })} disabled={!editing.systemPrompt}>
                            Reset to Default
                          </Button>
                        </div>
                        <Textarea
                          id="systemPrompt"
                          value={editing.systemPrompt || defaultSystemPrompt}
                          onChange={e => setEditing({ ...editing, systemPrompt: e.target.value })}
                          rows={8}
                          className={`font-mono text-xs resize-y min-h-[120px] max-h-[400px] ${!editing.systemPrompt ? "text-muted-foreground" : ""}`}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
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
                  <div className="space-y-2">
                    <Label htmlFor="cwd">Working Directory (optional)</Label>
                    <Input id="cwd" value={editing.connectionCwd ?? ""} onChange={e => setEditing({ ...editing, connectionCwd: e.target.value })} placeholder="e.g., /path/to/project or leave empty" />
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

            {/* ── Capabilities Tab ── */}
            <TabsContent value="capabilities" className="space-y-4">
              {/* ── Skills Section ── */}
              <div className="rounded-lg border">
                <button type="button" className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors" onClick={() => toggleSection("skills")}>
                  <div className="flex items-center gap-2">
                    {isSectionCollapsed("skills") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Skills</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">{skills.filter(s => isSkillEnabled(s.id)).length} of {skills.length} enabled</Badge>
                </button>
                {!isSectionCollapsed("skills") && (
                  <div className="border-t px-2 py-2 space-y-0.5">
                    {skills.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-3 text-center">No skills available.</p>
                    ) : skills.map(skill => (
                      <div key={skill.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/30">
                        <Switch checked={isSkillEnabled(skill.id)} onCheckedChange={() => toggleSkill(skill.id)} />
                        <div className="min-w-0">
                          <span className="text-sm truncate block">{skill.name}</span>
                          {skill.description && <span className="text-xs text-muted-foreground truncate block">{skill.description}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── MCP Servers Section ── */}
              <div className="rounded-lg border">
                <button type="button" className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors" onClick={() => toggleSection("mcp-servers")}>
                  <div className="flex items-center gap-2">
                    {isSectionCollapsed("mcp-servers") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">MCP Servers</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">{serverNames.filter(n => isServerEnabled(n)).length} of {serverNames.length} enabled</Badge>
                </button>
                {!isSectionCollapsed("mcp-servers") && (
                  <div className="border-t px-2 py-2 space-y-1">
                    {serverNames.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-3 text-center">No MCP servers configured.</p>
                    ) : serverNames.map(name => {
                      const info = serverStatus[name]
                      const serverToolList = toolsByServer(name)
                      const isExpanded = expandedServers.has(name)
                      const enabled = isServerEnabled(name)
                      return (
                        <div key={name} className="rounded-md border bg-card">
                          <div className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <Switch checked={enabled} onCheckedChange={() => toggleServer(name)} />
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`font-medium text-sm truncate ${!enabled ? "text-muted-foreground" : ""}`}>{name}</span>
                                {info?.connected
                                  ? <Badge variant="secondary" className="text-[10px] px-1.5">connected</Badge>
                                  : <Badge variant="outline" className="text-[10px] px-1.5">offline</Badge>
                                }
                              </div>
                            </div>
                            <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded" onClick={() => toggleExpandServer(name)}>
                              <span>{serverToolList.length} tools</span>
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                          {isExpanded && serverToolList.length > 0 && (
                            <div className="border-t mx-3 mb-2 pt-1 space-y-0.5">
                              {serverToolList.map(tool => {
                                const toolEnabled = enabled && !isToolDisabled(tool.name)
                                return (
                                  <div key={tool.name} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted/30">
                                    <Switch checked={toolEnabled} disabled={!enabled} onCheckedChange={() => toggleTool(tool.name)} />
                                    <div className="min-w-0">
                                      <span className={`text-sm truncate block ${!toolEnabled ? "text-muted-foreground" : ""}`}>{tool.name.replace(`${name}:`, "")}</span>
                                      {tool.description && <span className="text-xs text-muted-foreground truncate block">{tool.description}</span>}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── Built-in Tools Section ── */}
              <div className="rounded-lg border">
                <button type="button" className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors" onClick={() => toggleSection("builtin-tools")}>
                  <div className="flex items-center gap-2">
                    {isSectionCollapsed("builtin-tools") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Built-in Tools</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">{builtinTools.filter(t => isBuiltinToolEnabled(t.name)).length} of {builtinTools.length} enabled</Badge>
                </button>
                {!isSectionCollapsed("builtin-tools") && (
                  <div className="border-t px-2 py-2 space-y-0.5">
                    {builtinTools.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-3 text-center">No built-in tools available.</p>
                    ) : builtinTools.map(tool => {
                      const isEssential = tool.name === "speakmcp-settings:mark_work_complete"
                      const enabled = isEssential || isBuiltinToolEnabled(tool.name)
                      return (
                        <div key={tool.name} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/30">
                          <Switch checked={enabled} disabled={isEssential} onCheckedChange={() => toggleBuiltinTool(tool.name)} />
                          <div className="min-w-0">
                            <span className={`text-sm truncate flex items-center gap-2 ${!enabled ? "text-muted-foreground" : ""}`}>
                              {tool.name.replace("speakmcp-settings:", "")}
                              {isEssential && <Badge variant="outline" className="text-[10px] px-1.5">essential</Badge>}
                            </span>
                            {tool.description && <span className="text-xs text-muted-foreground truncate block">{tool.description}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
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

