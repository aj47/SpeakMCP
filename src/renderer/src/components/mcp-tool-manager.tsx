import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Switch } from "@renderer/components/ui/switch"
import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@renderer/components/ui/dialog"

import { Search, ChevronDown, ChevronRight, Settings, Eye, EyeOff } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"

interface DetailedTool {
  name: string
  description: string
  serverName: string
  enabled: boolean
  inputSchema: any
}

interface MCPToolManagerProps {
  onToolToggle?: (toolName: string, enabled: boolean) => void
}

export function MCPToolManager({ onToolToggle }: MCPToolManagerProps) {
  const [tools, setTools] = useState<DetailedTool[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedServer, setSelectedServer] = useState<string>("all")
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const [showDisabledTools, setShowDisabledTools] = useState(true)

  // Fetch tools periodically
  useEffect(() => {
    const fetchTools = async () => {
      try {
        const toolList = await tipcClient.getMcpDetailedToolList()
        setTools(toolList)
      } catch (error) {
        console.error("Failed to fetch tool list:", error)
      }
    }

    fetchTools()
    const interval = setInterval(fetchTools, 5000) // Update every 5 seconds

    return () => clearInterval(interval)
  }, [])

  // Group tools by server
  const toolsByServer = tools.reduce((acc, tool) => {
    if (!acc[tool.serverName]) {
      acc[tool.serverName] = []
    }
    acc[tool.serverName].push(tool)
    return acc
  }, {} as Record<string, DetailedTool[]>)

  // Filter tools based on search and server selection
  const filteredToolsByServer = Object.entries(toolsByServer).reduce((acc, [serverName, serverTools]) => {
    if (selectedServer !== "all" && serverName !== selectedServer) {
      return acc
    }

    const filteredTools = serverTools.filter(tool => {
      const matchesSearch = tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           tool.description.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesVisibility = showDisabledTools || tool.enabled
      return matchesSearch && matchesVisibility
    })

    if (filteredTools.length > 0) {
      acc[serverName] = filteredTools
    }

    return acc
  }, {} as Record<string, DetailedTool[]>)

  const handleToolToggle = async (toolName: string, enabled: boolean) => {
    try {
      // Update local state immediately for better UX
      setTools(prevTools =>
        prevTools.map(tool =>
          tool.name === toolName ? { ...tool, enabled } : tool
        )
      )

      // Call the backend API
      const result = await tipcClient.setMcpToolEnabled({ toolName, enabled })

      if (result.success) {
        // Call the callback if provided
        if (onToolToggle) {
          onToolToggle(toolName, enabled)
        }
        toast.success(`Tool ${toolName} ${enabled ? 'enabled' : 'disabled'}`)
      } else {
        // Revert local state if backend call failed
        setTools(prevTools =>
          prevTools.map(tool =>
            tool.name === toolName ? { ...tool, enabled: !enabled } : tool
          )
        )
        toast.error(`Failed to ${enabled ? 'enable' : 'disable'} tool ${toolName}`)
      }
    } catch (error) {
      // Revert local state on error
      setTools(prevTools =>
        prevTools.map(tool =>
          tool.name === toolName ? { ...tool, enabled: !enabled } : tool
        )
      )
      toast.error(`Error toggling tool: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const toggleServerExpansion = (serverName: string) => {
    setExpandedServers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(serverName)) {
        newSet.delete(serverName)
      } else {
        newSet.add(serverName)
      }
      return newSet
    })
  }

  const serverNames = Object.keys(toolsByServer)
  const totalTools = tools.length
  const enabledTools = tools.filter(tool => tool.enabled).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">MCP Tool Management</h3>
          <p className="text-sm text-muted-foreground">
            View and manage individual MCP tools ({enabledTools}/{totalTools} enabled)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDisabledTools(!showDisabledTools)}
          >
            {showDisabledTools ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {showDisabledTools ? "Hide Disabled" : "Show All"}
          </Button>
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="flex gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        <div className="w-48">
          <select
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
          >
            <option value="all">All Servers</option>
            {serverNames.map(serverName => (
              <option key={serverName} value={serverName}>
                {serverName} ({toolsByServer[serverName].length})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tools List */}
      <div className="space-y-4">
        {Object.keys(filteredToolsByServer).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Settings className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                {tools.length === 0 ? "No tools available. Configure MCP servers to see tools." : "No tools match your search criteria."}
              </p>
            </CardContent>
          </Card>
        ) : (
          Object.entries(filteredToolsByServer).map(([serverName, serverTools]) => (
            <Card key={serverName}>
              <CardHeader
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => toggleServerExpansion(serverName)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {expandedServers.has(serverName) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <CardTitle className="text-base">{serverName}</CardTitle>
                    <Badge variant="secondary">
                      {serverTools.filter(t => t.enabled).length}/{serverTools.length} enabled
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              {expandedServers.has(serverName) && (
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    {serverTools.map(tool => (
                      <div key={tool.name} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-sm truncate">
                              {tool.name.includes(':') ? tool.name.split(':').slice(1).join(':') : tool.name}
                            </h4>
                            {!tool.enabled && <Badge variant="outline" className="text-xs">Disabled</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {tool.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>{tool.name}</DialogTitle>
                                <DialogDescription>{tool.description}</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div>
                                  <Label className="text-sm font-medium">Input Schema</Label>
                                  <pre className="mt-2 p-3 bg-muted rounded-md text-xs overflow-auto max-h-64">
                                    {JSON.stringify(tool.inputSchema, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                          <Switch
                            checked={tool.enabled}
                            onCheckedChange={(enabled) => handleToolToggle(tool.name, enabled)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
