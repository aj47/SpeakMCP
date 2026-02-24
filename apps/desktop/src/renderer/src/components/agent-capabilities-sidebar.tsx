import React, { useState, useEffect, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { ChevronDown, ChevronRight, Sparkles, Server, Wrench } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { Switch } from "@renderer/components/ui/switch"
import { Badge } from "@renderer/components/ui/badge"
import type {
  AgentProfile, AgentProfileToolConfig, AgentSkill,
} from "../../../shared/types"

type ServerInfo = { connected: boolean; toolCount: number; runtimeEnabled?: boolean; configDisabled?: boolean }
type ToolInfo = { name: string; description: string; serverName: string }

const STORAGE_KEY = "agent-capabilities-sidebar-expanded"

export function AgentCapabilitiesSidebar() {
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored !== null ? stored === "true" : false
  })
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isExpanded))
  }, [isExpanded])

  const { data: agents = [] } = useQuery<AgentProfile[]>({
    queryKey: ["agentProfilesSidebar"],
    queryFn: () => tipcClient.getAgentProfiles(),
  })

  const { data: skills = [] } = useQuery<AgentSkill[]>({
    queryKey: ["skillsSidebar"],
    queryFn: () => tipcClient.getSkills(),
    enabled: expandedAgentId !== null,
  })

  const { data: serverStatus = {} } = useQuery<Record<string, ServerInfo>>({
    queryKey: ["serverStatusSidebar"],
    queryFn: () => tipcClient.getMcpServerStatus() as Promise<Record<string, ServerInfo>>,
    enabled: expandedAgentId !== null,
  })

  const { data: allTools = [] } = useQuery<ToolInfo[]>({
    queryKey: ["toolsSidebar"],
    queryFn: () => tipcClient.getMcpDetailedToolList() as Promise<ToolInfo[]>,
    enabled: expandedAgentId !== null,
  })

  const enabledAgents = agents.filter(a => a.enabled)
  const builtinTools = allTools.filter(t => t.serverName === "speakmcp-settings")
  const externalTools = allTools.filter(t => t.serverName !== "speakmcp-settings")
  const serverNames = Object.keys(serverStatus).filter(n => n !== "speakmcp-settings")

  const updateAgent = useCallback(async (id: string, updates: Partial<AgentProfile>) => {
    await tipcClient.updateAgentProfile({ id, updates })
    queryClient.invalidateQueries({ queryKey: ["agentProfilesSidebar"] })
  }, [queryClient])

  // ── Capability helpers (per agent) ──

  const isSkillEnabled = (agent: AgentProfile, skillId: string) =>
    (agent.skillsConfig?.enabledSkillIds || []).includes(skillId)

  const toggleSkill = (agent: AgentProfile, skillId: string) => {
    const ids = [...(agent.skillsConfig?.enabledSkillIds || [])]
    const idx = ids.indexOf(skillId)
    if (idx >= 0) ids.splice(idx, 1); else ids.push(skillId)
    updateAgent(agent.id, { skillsConfig: { ...agent.skillsConfig, enabledSkillIds: ids } })
  }

  const isServerEnabled = (agent: AgentProfile, serverName: string) => {
    const tc = agent.toolConfig
    if (!tc) return true
    if (tc.allServersDisabledByDefault) return (tc.enabledServers || []).includes(serverName)
    return !(tc.disabledServers || []).includes(serverName)
  }

  const toggleServer = (agent: AgentProfile, serverName: string) => {
    const tc = { ...(agent.toolConfig || {}) } as AgentProfileToolConfig
    if (tc.allServersDisabledByDefault) {
      const enabled = [...(tc.enabledServers || [])]
      const idx = enabled.indexOf(serverName)
      if (idx >= 0) enabled.splice(idx, 1); else enabled.push(serverName)
      updateAgent(agent.id, { toolConfig: { ...tc, enabledServers: enabled } })
    } else {
      const disabled = [...(tc.disabledServers || [])]
      const idx = disabled.indexOf(serverName)
      if (idx >= 0) disabled.splice(idx, 1); else disabled.push(serverName)
      updateAgent(agent.id, { toolConfig: { ...tc, disabledServers: disabled } })
    }
  }

  const isToolDisabled = (agent: AgentProfile, toolName: string) =>
    (agent.toolConfig?.disabledTools || []).includes(toolName)

  const toggleTool = (agent: AgentProfile, toolName: string) => {
    const tc = { ...(agent.toolConfig || {}) } as AgentProfileToolConfig
    const disabled = [...(tc.disabledTools || [])]
    const idx = disabled.indexOf(toolName)
    if (idx >= 0) disabled.splice(idx, 1); else disabled.push(toolName)
    updateAgent(agent.id, { toolConfig: { ...tc, disabledTools: disabled } })
  }

  const isBuiltinToolEnabled = (agent: AgentProfile, toolName: string) => {
    const list = agent.toolConfig?.enabledBuiltinTools
    if (!list || list.length === 0) return true
    return list.includes(toolName)
  }

  const toggleBuiltinTool = (agent: AgentProfile, toolName: string) => {
    const tc = { ...(agent.toolConfig || {}) } as AgentProfileToolConfig
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
    updateAgent(agent.id, { toolConfig: { ...tc, enabledBuiltinTools: currentList.length > 0 ? currentList : undefined } })
  }

  const toolsByServer = (serverName: string) => externalTools.filter(t => t.serverName === serverName)

  const toggleExpandServer = (serverName: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev)
      if (next.has(serverName)) next.delete(serverName); else next.add(serverName)
      return next
    })
  }

  const renderAgentCapabilities = (agent: AgentProfile) => {
    const sectionKey = (s: string) => `${agent.id}:${s}`
    const isSectionOpen = (s: string) => expandedSection === sectionKey(s)
    const toggleSectionOpen = (s: string) => setExpandedSection(prev => prev === sectionKey(s) ? null : sectionKey(s))

    const enabledSkillCount = skills.filter(s => isSkillEnabled(agent, s.id)).length
    const enabledServerCount = serverNames.filter(n => isServerEnabled(agent, n)).length
    const enabledBuiltinCount = builtinTools.filter(t => isBuiltinToolEnabled(agent, t.name)).length

    return (
      <div key={agent.id} className="space-y-0.5">
        {/* ── Skills ── */}
        <button
          onClick={() => toggleSectionOpen("skills")}
          className="flex items-center gap-1.5 w-full px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded transition-colors"
        >
          {isSectionOpen("skills") ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <Sparkles className="h-3 w-3 shrink-0" />
          <span className="truncate">Skills</span>
          <Badge variant="secondary" className="ml-auto text-[9px] px-1 py-0 h-3.5">{enabledSkillCount}/{skills.length}</Badge>
        </button>
        {isSectionOpen("skills") && (
          <div className="pl-5 space-y-0.5">
            {skills.length === 0 ? (
              <p className="text-[10px] text-muted-foreground py-1">No skills available</p>
            ) : skills.map(skill => (
              <div key={skill.id} className="flex items-center gap-2 py-0.5">
                <Switch className="scale-[0.6]" checked={isSkillEnabled(agent, skill.id)} onCheckedChange={() => toggleSkill(agent, skill.id)} />
                <span className="text-[11px] truncate" title={skill.description}>{skill.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── MCP Servers ── */}
        <button
          onClick={() => toggleSectionOpen("servers")}
          className="flex items-center gap-1.5 w-full px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded transition-colors"
        >
          {isSectionOpen("servers") ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <Server className="h-3 w-3 shrink-0" />
          <span className="truncate">MCP Servers</span>
          <Badge variant="secondary" className="ml-auto text-[9px] px-1 py-0 h-3.5">{enabledServerCount}/{serverNames.length}</Badge>
        </button>
        {isSectionOpen("servers") && (
          <div className="pl-5 space-y-0.5">
            {serverNames.length === 0 ? (
              <p className="text-[10px] text-muted-foreground py-1">No servers configured</p>
            ) : serverNames.map(name => {
              const serverToolList = toolsByServer(name)
              const isExp = expandedServers.has(name)
              return (
                <div key={name}>
                  <div className="flex items-center gap-2 py-0.5">
                    <Switch className="scale-[0.6]" checked={isServerEnabled(agent, name)} onCheckedChange={() => toggleServer(agent, name)} />
                    <span className="text-[11px] truncate flex-1">{name}</span>
                    {serverToolList.length > 0 && (
                      <button onClick={() => toggleExpandServer(name)} className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                        {serverToolList.length}t
                        {isExp ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                      </button>
                    )}
                  </div>
                  {isExp && serverToolList.map(tool => (
                    <div key={tool.name} className="flex items-center gap-2 py-0.5 pl-4">
                      <Switch
                        className="scale-[0.5]"
                        checked={isServerEnabled(agent, name) && !isToolDisabled(agent, tool.name)}
                        disabled={!isServerEnabled(agent, name)}
                        onCheckedChange={() => toggleTool(agent, tool.name)}
                      />
                      <span className="text-[10px] truncate" title={tool.description}>{tool.name.replace(`${name}:`, "")}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Built-in Tools ── */}
        <button
          onClick={() => toggleSectionOpen("builtin")}
          className="flex items-center gap-1.5 w-full px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded transition-colors"
        >
          {isSectionOpen("builtin") ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <Wrench className="h-3 w-3 shrink-0" />
          <span className="truncate">Built-in Tools</span>
          <Badge variant="secondary" className="ml-auto text-[9px] px-1 py-0 h-3.5">{enabledBuiltinCount}/{builtinTools.length}</Badge>
        </button>
        {isSectionOpen("builtin") && (
          <div className="pl-5 space-y-0.5">
            {builtinTools.length === 0 ? (
              <p className="text-[10px] text-muted-foreground py-1">No built-in tools available</p>
            ) : builtinTools.map(tool => {
              const isEssential = tool.name === "speakmcp-settings:mark_work_complete"
              return (
                <div key={tool.name} className="flex items-center gap-2 py-0.5">
                  <Switch
                    className="scale-[0.6]"
                    checked={isEssential || isBuiltinToolEnabled(agent, tool.name)}
                    disabled={isEssential}
                    onCheckedChange={() => toggleBuiltinTool(agent, tool.name)}
                  />
                  <span className="text-[10px] truncate" title={tool.description}>
                    {tool.name.replace("speakmcp-settings:", "")}
                    {isEssential && " ★"}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-2">
      <div
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-all duration-200",
          "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="shrink-0 cursor-pointer hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring rounded"
          aria-label={isExpanded ? "Collapse agents" : "Expand agents"}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1 min-w-0 focus:outline-none"
        >
          <span className="i-mingcute-group-line h-3.5 w-3.5"></span>
          <span>Agents</span>
          {enabledAgents.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground">{enabledAgents.length}</span>
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-1 space-y-0.5 pl-2">
          {enabledAgents.length === 0 ? (
            <p className="text-[11px] text-muted-foreground px-2 py-2">No enabled agents. Create agents in Settings → Agents.</p>
          ) : enabledAgents.map(agent => (
            <div key={agent.id}>
              <button
                onClick={() => setExpandedAgentId(prev => prev === agent.id ? null : agent.id)}
                className={cn(
                  "flex items-center gap-1.5 w-full rounded px-1.5 py-1 text-xs transition-all",
                  expandedAgentId === agent.id ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                )}
              >
                {expandedAgentId === agent.id ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <span className="truncate">{agent.displayName}</span>
                <Badge variant="outline" className="ml-auto text-[8px] px-1 py-0 h-3">{agent.connection.type}</Badge>
              </button>
              {expandedAgentId === agent.id && (
                <div className="pl-3 py-1">
                  {renderAgentCapabilities(agent)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

