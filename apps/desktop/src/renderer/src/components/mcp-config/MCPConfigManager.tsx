import React, { useState, useEffect, useRef } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Switch } from "@renderer/components/ui/switch"
import {
  Card,
  CardContent,
} from "@renderer/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog"
import { Badge } from "@renderer/components/ui/badge"
import {
  Trash2,
  Edit,
  Plus,
  Download,
  Server,
  CheckCircle,
  XCircle,
  AlertCircle,
  RotateCcw,
  Square,
  Play,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ChevronRight,
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
import { MCPConfig, MCPServerConfig, ServerLogEntry } from "@shared/types"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip"
import { ServerDialog } from "./ServerDialog"
import { ProfileProvider, useProfiles } from "./ProfileContext"
import { ServerConfigProvider, useServerConfig } from "./ServerConfigContext"
import { DetailedTool, BUILTIN_SERVER_NAME, RESERVED_SERVER_NAMES } from "./types"

interface MCPConfigManagerProps {
  config: MCPConfig
  onConfigChange: (config: MCPConfig) => void
  collapsedToolServers?: string[]
  collapsedServers?: string[]
  onCollapsedToolServersChange?: (servers: string[]) => void
  onCollapsedServersChange?: (servers: string[]) => void
}

// Inner component that uses the contexts
function MCPConfigManagerInner({
  collapsedToolServers,
  collapsedServers,
  onCollapsedToolServersChange,
  onCollapsedServersChange,
}: Omit<MCPConfigManagerProps, "config" | "onConfigChange">) {
  const { profiles, currentProfileId } = useProfiles()
  const {
    config,
    serverStatus,
    oauthStatus,
    serverLogs,
    onAddServer,
    onEditServer,
    onDeleteServer,
  } = useServerConfig()

  const [editingServer, setEditingServer] = useState<{
    name: string
    config: MCPServerConfig
  } | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [initializationStatus, setInitializationStatus] = useState<{
    isInitializing: boolean
    progress: { current: number; total: number; currentServer?: string }
  }>({ isInitializing: false, progress: { current: 0, total: 0 } })
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())

  const servers = config.mcpServers || {}

  // Initialize expandedServers from persisted expanded state
  const [expandedServers, setExpandedServers] = useState<Set<string>>(() => {
    const allServerNames = [...Object.keys(servers), BUILTIN_SERVER_NAME]
    if (collapsedServers === undefined) {
      return new Set<string>()
    }
    const collapsedSet = new Set(collapsedServers)
    return new Set(allServerNames.filter(name => !collapsedSet.has(name)))
  })

  // Tool management state
  const [tools, setTools] = useState<DetailedTool[]>([])
  const [toolSearchQuery, setToolSearchQuery] = useState("")
  const [showDisabledTools, setShowDisabledTools] = useState(true)
  const [expandedToolServers, setExpandedToolServers] = useState<Set<string>>(new Set())
  const [toolServersInitialized, setToolServersInitialized] = useState(false)

  const warnedReservedServersRef = useRef<Set<string>>(new Set())
  const [knownServers, setKnownServers] = useState<Set<string>>(() =>
    new Set([...Object.keys(servers), ...RESERVED_SERVER_NAMES])
  )
  const initialHydrationCompleteRef = useRef(
    collapsedServers !== undefined || Object.keys(servers).length > 0
  )

  // Track known tool server names to detect new servers
  const [knownToolServers, setKnownToolServers] = useState<Set<string>>(new Set())

  // Handle server changes
  useEffect(() => {
    const currentServerNames = new Set([...Object.keys(servers), ...RESERVED_SERVER_NAMES])
    const newServers = [...currentServerNames].filter(name => !knownServers.has(name))
    const prunedSet = new Set([...expandedServers].filter(name => currentServerNames.has(name)))

    if (prunedSet.size !== expandedServers.size) {
      setExpandedServers(prunedSet)
    }

    const wasEmptyOnMount = knownServers.size <= RESERVED_SERVER_NAMES.length &&
      [...knownServers].every(name => RESERVED_SERVER_NAMES.includes(name))

    if (wasEmptyOnMount && newServers.length > 0 && !initialHydrationCompleteRef.current) {
      initialHydrationCompleteRef.current = true
      setKnownServers(currentServerNames)
      return
    }

    if (collapsedServers !== undefined || Object.keys(servers).length > 0) {
      initialHydrationCompleteRef.current = true
    }

    if (newServers.length > 0 && collapsedServers !== undefined && onCollapsedServersChange && initialHydrationCompleteRef.current) {
      const updatedCollapsed = [...new Set([...collapsedServers, ...newServers])]
      onCollapsedServersChange(updatedCollapsed)
    }

    if (newServers.length > 0 || [...knownServers].some(name => !currentServerNames.has(name))) {
      setKnownServers(currentServerNames)
    }
  }, [servers, collapsedServers])

  // Warn about reserved server names
  useEffect(() => {
    const hiddenServers = Object.keys(servers).filter(
      (name) => RESERVED_SERVER_NAMES.some(
        (reserved) => name.trim().toLowerCase() === reserved.toLowerCase()
      )
    )
    for (const serverName of hiddenServers) {
      if (!warnedReservedServersRef.current.has(serverName)) {
        warnedReservedServersRef.current.add(serverName)
        toast.warning(`Server "${serverName}" uses a reserved name and has been hidden. Please rename or remove it from your MCP configuration.`)
      }
    }
  }, [servers])

  // Sync expandedServers when collapsedServers prop changes
  const prevCollapsedServersRef = useRef<string[] | undefined>(collapsedServers)
  useEffect(() => {
    const prevCollapsed = prevCollapsedServersRef.current
    const prevSet = new Set(prevCollapsed ?? [])
    const currentSet = new Set(collapsedServers ?? [])
    const wasUndefined = prevCollapsed === undefined
    const isUndefined = collapsedServers === undefined
    const collapsedChanged =
      wasUndefined !== isUndefined ||
      prevSet.size !== currentSet.size ||
      [...prevSet].some(s => !currentSet.has(s))

    if (collapsedChanged) {
      prevCollapsedServersRef.current = collapsedServers
      const currentServerNames = new Set([...Object.keys(servers), ...RESERVED_SERVER_NAMES])

      if (collapsedServers === undefined) {
        setExpandedServers(new Set<string>())
      } else {
        const collapsedSet = new Set(collapsedServers)
        const newExpanded = new Set([...currentServerNames].filter(name => !collapsedSet.has(name)))
        setExpandedServers(newExpanded)
      }
    }
  }, [collapsedServers, servers])

  // Fetch logs for expanded servers
  const fetchLogsForServer = async (serverName: string) => {
    try {
      const logs = await tipcClient.getMcpServerLogs({ serverName })
      // Note: logs are now managed via context, but we still need to trigger the fetch
    } catch (error) {
      console.error(`Failed to fetch logs for ${serverName}:`, error)
    }
  }

  // Fetch server status and initialization status periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const initStatus = await tipcClient.getMcpInitializationStatus({})
        setInitializationStatus(initStatus as any)

        for (const serverName of expandedLogs) {
          await fetchLogsForServer(serverName)
        }
      } catch (error) {}
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 1000)
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
    const interval = setInterval(fetchTools, 5000)
    return () => clearInterval(interval)
  }, [])

  // Initialize expandedToolServers when tools are first loaded
  useEffect(() => {
    if (tools.length > 0) {
      const allToolServerNames = [...new Set(tools.map(t => t.serverName))]
      const collapsedSet = new Set(collapsedToolServers ?? [])

      if (!toolServersInitialized) {
        const expanded = new Set(allToolServerNames.filter(name => !collapsedSet.has(name)))
        setExpandedToolServers(expanded)
        setKnownToolServers(new Set(allToolServerNames))
        setToolServersInitialized(true)
      } else {
        const newServers = allToolServerNames.filter(name => !knownToolServers.has(name))
        if (newServers.length > 0) {
          setExpandedToolServers(prev => {
            const updated = new Set(prev)
            newServers.forEach(name => updated.add(name))
            return updated
          })
          setKnownToolServers(prev => {
            const updated = new Set(prev)
            newServers.forEach(name => updated.add(name))
            return updated
          })
        }
      }
    }
  }, [tools, collapsedToolServers, toolServersInitialized, knownToolServers])

  // Sync expandedToolServers when collapsedToolServers prop changes
  const prevCollapsedToolServersRef = useRef<string[] | undefined>(collapsedToolServers)
  useEffect(() => {
    const prevCollapsed = prevCollapsedToolServersRef.current
    const prevSet = new Set(prevCollapsed ?? [])
    const currentSet = new Set(collapsedToolServers ?? [])
    const collapsedChanged =
      prevSet.size !== currentSet.size ||
      [...prevSet].some(s => !currentSet.has(s))

    if (collapsedChanged && toolServersInitialized) {
      prevCollapsedToolServersRef.current = collapsedToolServers
      const allToolServerNames = [...new Set(tools.map(t => t.serverName))]
      const collapsedSet = new Set(collapsedToolServers ?? [])
      const newExpanded = new Set(allToolServerNames.filter(name => !collapsedSet.has(name)))
      setExpandedToolServers(newExpanded)
    }
  }, [collapsedToolServers, tools, toolServersInitialized])

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
      setTools((prevTools) =>
        prevTools.map((tool) =>
          tool.name === toolName ? { ...tool, enabled } : tool,
        ),
      )

      const result = await tipcClient.setMcpToolEnabled({ toolName, enabled })

      if ((result as any).success) {
        toast.success(`Tool ${toolName} ${enabled ? "enabled" : "disabled"}`)
      } else {
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

    const updatedTools = tools.map((tool) => {
      if (tool.serverName === serverName) {
        return { ...tool, enabled: enable }
      }
      return tool
    })
    setTools(updatedTools)

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
    setExpandedToolServers(prev => {
      const allToolServerNames = [...new Set(tools.map(t => t.serverName))]
      const collapsedSet = new Set(collapsedToolServers ?? [])

      let newSet: Set<string>
      if (!toolServersInitialized && prev.size === 0) {
        newSet = new Set(allToolServerNames.filter(name => !collapsedSet.has(name)))
      } else {
        newSet = new Set(prev)
      }

      if (newSet.has(serverName)) {
        newSet.delete(serverName)
      } else {
        newSet.add(serverName)
      }

      if (onCollapsedToolServersChange) {
        const collapsed = allToolServerNames.filter(name => !newSet.has(name))
        onCollapsedToolServersChange(collapsed)
      }
      return newSet
    })
  }

  const handleAddServerWrapper = async (name: string, serverConfig: MCPServerConfig) => {
    onAddServer(name, serverConfig)
    setShowAddDialog(false)

    if (!serverConfig.disabled) {
      setTimeout(async () => {
        try {
          const runtimeResult = await tipcClient.setMcpServerRuntimeEnabled({
            serverName: name,
            enabled: true,
          })
          if (!(runtimeResult as any).success) {
            toast.error(`Failed to enable server: Server not found`)
            return
          }

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

  const handleEditServerWrapper = (
    oldName: string,
    newName: string,
    serverConfig: MCPServerConfig,
  ) => {
    onEditServer(oldName, newName, serverConfig)
    setEditingServer(null)
  }

  const handleImportConfigFromFile = async () => {
    try {
      const importedConfig = await tipcClient.loadMcpConfigFile({})
      if (importedConfig) {
        const filteredServers: Record<string, any> = {}
        const skippedNames: string[] = []
        for (const [serverName, serverConfig] of Object.entries(importedConfig.mcpServers)) {
          const normalizedName = serverName.trim().toLowerCase()
          if (RESERVED_SERVER_NAMES.some(reserved => reserved.toLowerCase() === normalizedName)) {
            skippedNames.push(serverName)
          } else {
            filteredServers[serverName] = serverConfig
          }
        }

        for (const skippedName of skippedNames) {
          toast.warning(`Skipped importing reserved server name: ${skippedName}`)
        }

        const importedCount = Object.keys(filteredServers).length
        if (importedCount === 0 && skippedNames.length > 0) {
          toast.error("No servers to import - all server names were reserved")
          return
        }

        for (const [name, serverConfig] of Object.entries(filteredServers)) {
          onAddServer(name, serverConfig as MCPServerConfig)
        }
        setShowAddDialog(false)
        toast.success(`Successfully imported ${importedCount} server(s)`)
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
      const formattedJson = formatJsonPreview(text)
      const importedConfig = await tipcClient.validateMcpConfigText({ text: formattedJson })

      if (importedConfig) {
        const filteredServers: Record<string, any> = {}
        const skippedNames: string[] = []
        for (const [serverName, serverConfig] of Object.entries(importedConfig.mcpServers)) {
          const normalizedName = serverName.trim().toLowerCase()
          if (RESERVED_SERVER_NAMES.some(reserved => reserved.toLowerCase() === normalizedName)) {
            skippedNames.push(serverName)
          } else {
            filteredServers[serverName] = serverConfig
          }
        }

        for (const skippedName of skippedNames) {
          toast.warning(`Skipped importing reserved server name: ${skippedName}`)
        }

        const importedCount = Object.keys(filteredServers).length
        if (importedCount === 0 && skippedNames.length > 0) {
          toast.error("No servers to import - all server names were reserved")
          return false
        }

        for (const [name, serverConfig] of Object.entries(filteredServers)) {
          onAddServer(name, serverConfig as MCPServerConfig)
        }
        setShowAddDialog(false)
        toast.success(`Successfully imported ${importedCount} server(s)`)
        return true
      }
      return false
    } catch (error) {
      toast.error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
      return false
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
      const runtimeResult = await tipcClient.setMcpServerRuntimeEnabled({
        serverName,
        enabled: false,
      })
      if (!(runtimeResult as any).success) {
        toast.error(`Failed to disable server: Server not found`)
        return
      }

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
      const runtimeResult = await tipcClient.setMcpServerRuntimeEnabled({
        serverName,
        enabled: true,
      })
      if (!(runtimeResult as any).success) {
        toast.error(`Failed to enable server: Server not found`)
        return
      }

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
        fetchLogsForServer(serverName)
      }
      return newSet
    })
  }

  const filteredUserServers = Object.fromEntries(
    Object.entries(servers).filter(
      ([name]) => !RESERVED_SERVER_NAMES.some(
        (reserved) => name.trim().toLowerCase() === reserved.toLowerCase()
      )
    )
  )
  const allServers: Record<string, MCPServerConfig | { isBuiltin: true }> = {
    ...filteredUserServers,
    [BUILTIN_SERVER_NAME]: { isBuiltin: true } as any,
  }

  const toggleServerExpansion = (serverName: string) => {
    setExpandedServers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(serverName)) {
        newSet.delete(serverName)
      } else {
        newSet.add(serverName)
      }

      if (onCollapsedServersChange) {
        const allServerNames = Object.keys(allServers)
        const collapsed = allServerNames.filter(name => !newSet.has(name))
        onCollapsedServersChange(collapsed)
      }
      return newSet
    })
  }

  const toggleAllServers = (expand: boolean) => {
    const allServerNames = Object.keys(allServers)
    if (expand) {
      setExpandedServers(new Set(allServerNames))
      if (onCollapsedServersChange) {
        onCollapsedServersChange([])
      }
    } else {
      setExpandedServers(new Set())
      if (onCollapsedServersChange) {
        onCollapsedServersChange(allServerNames)
      }
    }
  }

  const handleClearLogs = async (serverName: string) => {
    try {
      await tipcClient.clearMcpServerLogs({ serverName })
      toast.success(`Logs cleared for ${serverName}`)
    } catch (error) {
      toast.error(`Failed to clear logs: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const totalToolsCount = tools.length
  const enabledToolsCount = tools.filter((t) => t.enabled).length
  const disabledToolsCount = totalToolsCount - enabledToolsCount

  const [toolsSectionExpanded, setToolsSectionExpanded] = useState(true)
  const [serversSectionExpanded, setServersSectionExpanded] = useState(true)

  const getAllFilteredTools = () => {
    return tools.filter((tool) => {
      const matchesSearch =
        tool.name.toLowerCase().includes(toolSearchQuery.toLowerCase()) ||
        tool.description.toLowerCase().includes(toolSearchQuery.toLowerCase())
      const matchesVisibility = showDisabledTools || tool.enabled
      return matchesSearch && matchesVisibility
    })
  }

  const handleToggleAllTools = async (enable: boolean) => {
    const filteredTools = getAllFilteredTools()
    if (filteredTools.length === 0) return

    const originalStates = new Map<string, boolean>()
    filteredTools.forEach(tool => {
      originalStates.set(tool.name, tool.enabled)
    })

    const updatedTools = tools.map((tool) => {
      if (filteredTools.some(ft => ft.name === tool.name)) {
        return { ...tool, enabled: enable }
      }
      return tool
    })
    setTools(updatedTools)

    const promises = filteredTools.map((tool) =>
      tipcClient.setMcpToolEnabled({ toolName: tool.name, enabled: enable }),
    )

    try {
      const results = await Promise.allSettled(promises)
      const successful = results.filter(
        (r) => r.status === "fulfilled" && (r.value as any).success === true,
      ).length
      const failed = results.length - successful

      if (failed === 0) {
        toast.success(`All ${filteredTools.length} tools ${enable ? "enabled" : "disabled"}`)
      } else {
        const failedTools = filteredTools.filter(
          (_, index) =>
            results[index].status === "rejected" ||
            (results[index].status === "fulfilled" &&
              (results[index] as PromiseFulfilledResult<any>).value.success !== true),
        )
        const revertedTools = updatedTools.map((tool) => {
          if (failedTools.some(ft => ft.name === tool.name)) {
            return { ...tool, enabled: originalStates.get(tool.name) ?? tool.enabled }
          }
          return tool
        })
        setTools(revertedTools)

        toast.warning(
          `${successful}/${filteredTools.length} tools ${enable ? "enabled" : "disabled"} (${failed} failed)`,
        )
      }
    } catch (error: any) {
      const revertedTools = updatedTools.map((tool) => {
        if (filteredTools.some(ft => ft.name === tool.name)) {
          return { ...tool, enabled: originalStates.get(tool.name) ?? tool.enabled }
        }
        return tool
      })
      setTools(revertedTools)
      toast.error(`Error toggling tools: ${error.message}`)
    }
  }

  // Helper function to check if a tool is enabled for a profile
  const isToolEnabledForProfile = (toolName: string, serverName: string, profile: any): boolean => {
    const mcpConfig = profile.mcpServerConfig
    if (!mcpConfig) return true

    if (serverName === BUILTIN_SERVER_NAME) return true

    if (mcpConfig.allServersDisabledByDefault) {
      if (!mcpConfig.enabledServers?.includes(serverName)) {
        return false
      }
    } else {
      if (mcpConfig.disabledServers?.includes(serverName)) {
        return false
      }
    }

    if (mcpConfig.disabledTools?.includes(toolName)) {
      return false
    }

    return true
  }

  // Helper function to check if a server is enabled for a profile
  const isServerEnabledForProfile = (serverName: string, profile: any): boolean => {
    const mcpConfig = profile.mcpServerConfig
    if (!mcpConfig) return true

    if (serverName === BUILTIN_SERVER_NAME) return true

    if (mcpConfig.allServersDisabledByDefault) {
      return mcpConfig.enabledServers?.includes(serverName) ?? false
    } else {
      return !mcpConfig.disabledServers?.includes(serverName)
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium">MCP Tools & Servers</h3>
          {totalToolsCount > 0 && (
            <Badge variant="secondary" className="text-sm">
              {enabledToolsCount}/{totalToolsCount} tools enabled
            </Badge>
          )}
        </div>
      </div>

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

      {/* TOOLS SECTION */}
      <Card>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={toolsSectionExpanded}
          aria-label="Toggle tools section"
          className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          onClick={() => setToolsSectionExpanded(!toolsSectionExpanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setToolsSectionExpanded(!toolsSectionExpanded)
            }
          }}
        >
          <div className="flex items-center gap-2">
            {toolsSectionExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Wrench className="h-4 w-4" />
            <span className="font-medium">Tools</span>
            <Badge variant="secondary" className="text-xs">
              {enabledToolsCount}/{totalToolsCount} enabled
            </Badge>
          </div>
        </div>

        {toolsSectionExpanded && (
          <CardContent className="border-t pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
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
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleAllTools(true)}
                  className="shrink-0"
                >
                  <Power className="mr-1 h-3 w-3" />
                  All ON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleAllTools(false)}
                  className="shrink-0"
                >
                  <PowerOff className="mr-1 h-3 w-3" />
                  All OFF
                </Button>
              </div>
            </div>

            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto">
              {getAllFilteredTools().length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  {totalToolsCount === 0
                    ? "No tools available. Connect a server to see its tools."
                    : "No tools match your search"}
                </div>
              ) : (
                Object.entries(
                  getAllFilteredTools().reduce((acc, tool) => {
                    if (!acc[tool.serverName]) {
                      acc[tool.serverName] = []
                    }
                    acc[tool.serverName].push(tool)
                    return acc
                  }, {} as Record<string, DetailedTool[]>)
                ).map(([serverName, serverTools]) => {
                  const isExpanded = !toolServersInitialized
                    ? !(collapsedToolServers ?? []).includes(serverName)
                    : expandedToolServers.has(serverName)
                  return (
                  <div key={serverName} className="space-y-2">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      aria-label={`Toggle ${serverName} tools`}
                      className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 cursor-pointer hover:bg-muted/70 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                      onClick={() => toggleToolsExpansion(serverName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleToolsExpansion(serverName)
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform" />
                        )}
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{serverName}</span>
                        <Badge variant="secondary" className="text-xs">
                          {serverTools.filter(t => t.enabled).length}/{serverTools.length} enabled
                        </Badge>
                        <TooltipProvider delayDuration={0}>
                          <div className="flex items-center gap-0.5 ml-1">
                            {profiles.map((profile) => {
                              const isEnabled = isServerEnabledForProfile(serverName, profile)
                              const isCurrent = profile.id === currentProfileId
                              return (
                                <Tooltip key={profile.id}>
                                  <TooltipTrigger asChild>
                                    <div
                                      className={`h-2 w-2 rounded-full ${
                                        isEnabled
                                          ? isCurrent
                                            ? "bg-primary ring-1 ring-primary ring-offset-1"
                                            : "bg-green-500"
                                          : "bg-muted-foreground/30"
                                      }`}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    <span className="font-medium">{profile.name}</span>
                                    {isCurrent && " (current)"}
                                    : {isEnabled ? "enabled" : "disabled"}
                                  </TooltipContent>
                                </Tooltip>
                              )
                            })}
                          </div>
                        </TooltipProvider>
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleAllToolsForServer(serverName, true)}
                          className="h-6 px-2 text-xs"
                        >
                          <Power className="mr-1 h-3 w-3" />
                          ON
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleAllToolsForServer(serverName, false)}
                          className="h-6 px-2 text-xs"
                        >
                          <PowerOff className="mr-1 h-3 w-3" />
                          OFF
                        </Button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="space-y-2 pl-6 animate-in fade-in slide-in-from-top-1 duration-200">
                        {serverTools.map((tool) => (
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
                                  <Badge variant="secondary" className="text-xs shrink-0">
                                    Disabled
                                  </Badge>
                                )}
                                <TooltipProvider delayDuration={0}>
                                  <div className="flex items-center gap-0.5">
                                    {profiles.map((profile) => {
                                      const isEnabled = isToolEnabledForProfile(tool.name, tool.serverName, profile)
                                      const isCurrent = profile.id === currentProfileId
                                      return (
                                        <Tooltip key={profile.id}>
                                          <TooltipTrigger asChild>
                                            <div
                                              className={`h-2 w-2 rounded-full ${
                                                isEnabled
                                                  ? isCurrent
                                                    ? "bg-primary ring-1 ring-primary ring-offset-1"
                                                    : "bg-green-500"
                                                  : "bg-muted-foreground/30"
                                              }`}
                                            />
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="text-xs">
                                            <span className="font-medium">{profile.name}</span>
                                            {isCurrent && " (current)"}
                                            : {isEnabled ? "enabled" : "disabled"}
                                          </TooltipContent>
                                        </Tooltip>
                                      )
                                    })}
                                  </div>
                                </TooltipProvider>
                              </div>
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
                                        Server
                                      </Label>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {tool.serverName}
                                      </p>
                                    </div>
                                    <div>
                                      <Label className="text-sm font-medium">
                                        Input Schema
                                      </Label>
                                      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                                        {JSON.stringify(tool.inputSchema, null, 2)}
                                      </pre>
                                    </div>
                                  </div>
                                  <div>
                                    <Label className="text-sm font-medium">
                                      Profile Availability
                                    </Label>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {profiles.map((profile) => {
                                        const isEnabled = isToolEnabledForProfile(tool.name, tool.serverName, profile)
                                        const isCurrent = profile.id === currentProfileId
                                        return (
                                          <Badge
                                            key={profile.id}
                                            variant={isEnabled ? "default" : "secondary"}
                                            className={`text-xs ${isCurrent ? "ring-2 ring-primary ring-offset-1" : ""}`}
                                          >
                                            {isEnabled ? (
                                              <CheckCircle className="mr-1 h-3 w-3" />
                                            ) : (
                                              <XCircle className="mr-1 h-3 w-3" />
                                            )}
                                            {profile.name}
                                            {isCurrent && " (current)"}
                                          </Badge>
                                        )
                                      })}
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
                        ))}
                      </div>
                    )}
                  </div>
                )})
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* SERVERS SECTION */}
      <Card>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={serversSectionExpanded}
          aria-label="Toggle servers section"
          className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          onClick={() => setServersSectionExpanded(!serversSectionExpanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setServersSectionExpanded(!serversSectionExpanded)
            }
          }}
        >
          <div className="flex items-center gap-2">
            {serversSectionExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Server className="h-4 w-4" />
            <span className="font-medium">Servers</span>
            <Badge variant="secondary" className="text-xs">
              {Object.keys(allServers).length}
            </Badge>
          </div>
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
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
                onSave={handleAddServerWrapper}
                onCancel={() => setShowAddDialog(false)}
                onImportFromFile={handleImportConfigFromFile}
                onImportFromText={handleImportFromText}
                isOpen={showAddDialog}
              />
            </Dialog>
          </div>
        </div>

        {serversSectionExpanded && (
          <CardContent className="border-t pt-4">
            <div className="grid gap-2">
              {Object.entries(allServers).map(([name, serverConfigOrBuiltin]) => {
                const isBuiltin = name === BUILTIN_SERVER_NAME
                const serverConfig = isBuiltin ? null : (serverConfigOrBuiltin as MCPServerConfig)
                const status = serverStatus[name]
                const serverTools = toolsByServer[name] || []
                const enabledToolCount = serverTools.filter((t) => t.enabled).length

                return (
                  <Card key={name} className="overflow-hidden">
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
                        {isBuiltin ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            <Badge variant="outline" className="text-xs border-green-300 text-green-600">
                              Built-in
                            </Badge>
                            <Badge variant="default" className="text-xs">
                              {enabledToolCount}/{serverTools.length} tools
                            </Badge>
                          </div>
                        ) : serverConfig?.disabled ? (
                          <Badge variant="secondary" className="shrink-0">Disabled</Badge>
                        ) : status?.runtimeEnabled === false ? (
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
                            {status?.connected ? (
                              <div className="flex shrink-0 items-center gap-1">
                                <CheckCircle className="h-3 w-3 text-green-500" />
                                <Badge variant="default" className="text-xs">
                                  {serverTools.length > 0
                                    ? `${enabledToolCount}/${serverTools.length} tools`
                                    : `${status.toolCount} tools`}
                                </Badge>
                              </div>
                            ) : status?.error ? (
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
                      {!isBuiltin && serverConfig && (
                        <div
                          className="flex shrink-0 items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {!serverConfig.disabled && (
                            <>
                              {status?.runtimeEnabled === false ? (
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
                                      const checkCompletion = setInterval(async () => {
                                        const statusResult = await window.electronAPI.getOAuthStatus(name)
                                        if (statusResult.authenticated) {
                                          clearInterval(checkCompletion)
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
                            onClick={() => onDeleteServer(name)}
                            title="Delete server"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {expandedServers.has(name) && (
                      <>
                        <CardContent className="pt-0 border-t">
                          <div className="space-y-3 py-3">
                            {isBuiltin ? (
                              <div className="text-sm">
                                <span className="font-medium text-muted-foreground">Type:</span>{" "}
                                <span className="text-xs text-muted-foreground">
                                  Built-in SpeakMCP settings tools (always available)
                                </span>
                              </div>
                            ) : serverConfig && (
                              <>
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

                                {serverConfig.env && Object.keys(serverConfig.env).length > 0 && (
                                  <div className="text-sm">
                                    <span className="font-medium text-muted-foreground">Environment:</span>{" "}
                                    <span className="text-xs text-muted-foreground">
                                      {Object.keys(serverConfig.env).join(", ")}
                                    </span>
                                  </div>
                                )}

                                {serverConfig.timeout && (
                                  <div className="text-sm">
                                    <span className="font-medium text-muted-foreground">Timeout:</span>{" "}
                                    <span className="text-xs text-muted-foreground">{serverConfig.timeout}ms</span>
                                  </div>
                                )}

                                {status?.error && (
                                  <div className="text-sm text-red-500">
                                    <span className="font-medium">Error:</span> {status.error}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </CardContent>

                        {!isBuiltin && serverConfig && (serverConfig.transport === "stdio" || !serverConfig.transport) && (
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
                      </>
                    )}
                  </Card>
                )
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {editingServer && (
        <Dialog open={true} onOpenChange={() => setEditingServer(null)}>
          <ServerDialog
            server={editingServer}
            onSave={(newName, config) =>
              handleEditServerWrapper(editingServer.name, newName, config)
            }
            onCancel={() => setEditingServer(null)}
          />
        </Dialog>
      )}
    </div>
  )
}

// Main component that wraps with context providers
export function MCPConfigManager({
  config,
  onConfigChange,
  collapsedToolServers,
  collapsedServers,
  onCollapsedToolServersChange,
  onCollapsedServersChange,
}: MCPConfigManagerProps) {
  const [profiles, setProfiles] = useState<any[]>([])
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null)
  const [serverStatus, setServerStatus] = useState<Record<string, any>>({})
  const [oauthStatus, setOauthStatus] = useState<Record<string, any>>({})
  const [serverLogs, setServerLogs] = useState<Record<string, ServerLogEntry[]>>({})

  const servers = config.mcpServers || {}

  // Fetch profiles
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const [profileList, currentProfile] = await Promise.all([
          tipcClient.getProfiles(),
          tipcClient.getCurrentProfile(),
        ])
        setProfiles(profileList as any[])
        setCurrentProfileId((currentProfile as any)?.id ?? null)
      } catch (error) {}
    }

    fetchProfiles()
    const interval = setInterval(fetchProfiles, 5000)
    return () => clearInterval(interval)
  }, [])

  // Fetch server status and OAuth status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [status, oauth] = await Promise.all([
          tipcClient.getMcpServerStatus({}),
          Promise.all(
            Object.entries(servers)
              .filter(([_, config]) => config.transport === "streamableHttp" && config.url)
              .map(async ([name]) => {
                const oauthStatus = await window.electronAPI.getOAuthStatus(name)
                return [name, oauthStatus]
              })
          ).then(results => Object.fromEntries(results))
        ])
        setServerStatus(status as any)
        setOauthStatus(oauth)
      } catch (error) {}
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 1000)
    return () => clearInterval(interval)
  }, [servers])

  const handleAddServer = (name: string, serverConfig: MCPServerConfig) => {
    const newConfig = {
      ...config,
      mcpServers: {
        ...servers,
        [name]: serverConfig,
      },
    }
    onConfigChange(newConfig)
  }

  const handleEditServer = (oldName: string, newName: string, serverConfig: MCPServerConfig) => {
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

  return (
    <ProfileProvider profiles={profiles} currentProfileId={currentProfileId}>
      <ServerConfigProvider
        config={config}
        serverStatus={serverStatus}
        oauthStatus={oauthStatus}
        serverLogs={serverLogs}
        onConfigChange={onConfigChange}
        onAddServer={handleAddServer}
        onEditServer={handleEditServer}
        onDeleteServer={handleDeleteServer}
      >
        <MCPConfigManagerInner
          collapsedToolServers={collapsedToolServers}
          collapsedServers={collapsedServers}
          onCollapsedToolServersChange={onCollapsedToolServersChange}
          onCollapsedServersChange={onCollapsedServersChange}
        />
      </ServerConfigProvider>
    </ProfileProvider>
  )
}
