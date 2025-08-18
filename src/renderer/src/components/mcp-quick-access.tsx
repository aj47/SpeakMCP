import React, { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Switch } from "@renderer/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip"
import {
  Server,
  CheckCircle,
  XCircle,
  AlertCircle,
  Power,
  PowerOff,
  RotateCcw,
  Settings,
  Zap,
} from "lucide-react"
import { Spinner } from "@renderer/components/ui/spinner"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

interface MCPQuickAccessProps {
  variant?: "compact" | "full"
  showTitle?: boolean
  className?: string
}

interface ServerStatus {
  connected: boolean
  toolCount: number
  runtimeEnabled: boolean
  configDisabled: boolean
}

export function MCPQuickAccess({ 
  variant = "full", 
  showTitle = true,
  className = "" 
}: MCPQuickAccessProps) {
  const queryClient = useQueryClient()
  const [isToggling, setIsToggling] = useState(false)

  // Query for config to get MCP enabled state
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const result = await tipcClient.getConfig()
      return result
    },
    refetchInterval: 2000, // Refresh every 2 seconds
  })

  // Query for server status
  const serverStatusQuery = useQuery({
    queryKey: ["mcp-server-status"],
    queryFn: async () => {
      const result = await tipcClient.getMcpServerStatus()
      return result
    },
    refetchInterval: 3000, // Refresh every 3 seconds
    enabled: !!(configQuery.data as any)?.mcpToolsEnabled,
  })

  const config = (configQuery.data as any) || {}
  const serverStatus = (serverStatusQuery.data as any) || {}
  const mcpEnabled = !!config.mcpToolsEnabled

  // Calculate summary stats
  const serverNames = Object.keys(serverStatus)
  const connectedServers = serverNames.filter(name => serverStatus[name]?.connected)
  const totalTools = Object.values(serverStatus).reduce((sum: number, status: any) => sum + (status?.toolCount || 0), 0)

  // Global MCP toggle mutation
  const toggleMcpMutation = useMutation({
    mutationFn: async () => {
      const result = await tipcClient.toggleMcpGlobally()
      return result
    },
    onSuccess: (result: any) => {
      if (result.success) {
        toast.success(result.message)
        queryClient.invalidateQueries({ queryKey: ["config"] })
        queryClient.invalidateQueries({ queryKey: ["mcp-server-status"] })
      } else {
        toast.error(result.message || "Failed to toggle MCP")
      }
    },
    onError: (error: any) => {
      toast.error(`Error toggling MCP: ${error.message}`)
    },
    onSettled: () => {
      setIsToggling(false)
    }
  })

  // Enable MCP mutation
  const enableMcpMutation = useMutation({
    mutationFn: async () => {
      const result = await tipcClient.enableMcpGlobally()
      return result
    },
    onSuccess: (result: any) => {
      if (result.success) {
        toast.success(result.message)
        queryClient.invalidateQueries({ queryKey: ["config"] })
        queryClient.invalidateQueries({ queryKey: ["mcp-server-status"] })
      } else {
        toast.error(result.message || "Failed to enable MCP")
      }
    },
    onError: (error: any) => {
      toast.error(`Error enabling MCP: ${error.message}`)
    }
  })

  // Disable MCP mutation
  const disableMcpMutation = useMutation({
    mutationFn: async () => {
      const result = await tipcClient.disableMcpGlobally()
      return result
    },
    onSuccess: (result: any) => {
      if (result.success) {
        toast.success(result.message)
        queryClient.invalidateQueries({ queryKey: ["config"] })
        queryClient.invalidateQueries({ queryKey: ["mcp-server-status"] })
      } else {
        toast.error(result.message || "Failed to disable MCP")
      }
    },
    onError: (error: any) => {
      toast.error(`Error disabling MCP: ${error.message}`)
    }
  })

  const handleToggle = async () => {
    setIsToggling(true)
    toggleMcpMutation.mutate()
  }

  const handleEnable = () => {
    enableMcpMutation.mutate()
  }

  const handleDisable = () => {
    disableMcpMutation.mutate()
  }

  const getStatusIcon = () => {
    if (!mcpEnabled) {
      return <PowerOff className="h-4 w-4 text-muted-foreground" />
    }
    if (connectedServers.length === 0) {
      return <AlertCircle className="h-4 w-4 text-yellow-500" />
    }
    if (connectedServers.length === serverNames.length) {
      return <CheckCircle className="h-4 w-4 text-green-500" />
    }
    return <AlertCircle className="h-4 w-4 text-yellow-500" />
  }

  const getStatusText = () => {
    if (!mcpEnabled) {
      return "MCP Disabled"
    }
    if (serverNames.length === 0) {
      return "No Servers Configured"
    }
    if (connectedServers.length === 0) {
      return "No Servers Connected"
    }
    if (connectedServers.length === serverNames.length) {
      return "All Servers Connected"
    }
    return `${connectedServers.length}/${serverNames.length} Servers Connected`
  }

  const getStatusBadgeVariant = () => {
    if (!mcpEnabled) return "secondary"
    if (connectedServers.length === 0) return "destructive"
    if (connectedServers.length === serverNames.length) return "default"
    return "secondary"
  }

  if (variant === "compact") {
    return (
      <TooltipProvider>
        <div className={`flex items-center gap-2 ${className}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1">
                {getStatusIcon()}
                <Badge variant={getStatusBadgeVariant()} className="text-xs">
                  {mcpEnabled ? `${totalTools} tools` : "OFF"}
                </Badge>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{getStatusText()}</p>
              {mcpEnabled && totalTools > 0 && (
                <p className="text-xs text-muted-foreground">
                  {totalTools} tools available across {serverNames.length} servers
                </p>
              )}
            </TooltipContent>
          </Tooltip>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            disabled={isToggling || toggleMcpMutation.isPending}
            className="h-6 w-6 p-0"
          >
            {isToggling || toggleMcpMutation.isPending ? (
              <Spinner className="h-3 w-3" />
            ) : mcpEnabled ? (
              <Power className="h-3 w-3" />
            ) : (
              <PowerOff className="h-3 w-3" />
            )}
          </Button>
        </div>
      </TooltipProvider>
    )
  }

  return (
    <Card className={className}>
      {showTitle && (
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-5 w-5" />
            MCP Quick Access
          </CardTitle>
          <CardDescription>
            Quickly toggle MCP tools and view server status
          </CardDescription>
        </CardHeader>
      )}
      
      <CardContent className="space-y-4">
        {/* Status Overview */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="font-medium">{getStatusText()}</span>
          </div>
          <Badge variant={getStatusBadgeVariant()}>
            {mcpEnabled ? "ENABLED" : "DISABLED"}
          </Badge>
        </div>

        {/* Stats */}
        {mcpEnabled && (
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{serverNames.length}</div>
              <div className="text-xs text-muted-foreground">Servers</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{connectedServers.length}</div>
              <div className="text-xs text-muted-foreground">Connected</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{totalTools}</div>
              <div className="text-xs text-muted-foreground">Tools</div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleToggle}
            disabled={isToggling || toggleMcpMutation.isPending}
            className="flex-1"
            variant={mcpEnabled ? "destructive" : "default"}
          >
            {isToggling || toggleMcpMutation.isPending ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : mcpEnabled ? (
              <PowerOff className="mr-2 h-4 w-4" />
            ) : (
              <Power className="mr-2 h-4 w-4" />
            )}
            {mcpEnabled ? "Disable MCP" : "Enable MCP"}
          </Button>
          
          {mcpEnabled && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      queryClient.invalidateQueries({ queryKey: ["mcp-server-status"] })
                      toast.success("Status refreshed")
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Refresh Status</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Server List (if enabled and servers exist) */}
        {mcpEnabled && serverNames.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Server Status</div>
            <div className="space-y-1">
              {serverNames.map((serverName) => {
                const status = serverStatus[serverName]
                return (
                  <div key={serverName} className="flex items-center justify-between text-sm">
                    <span className="truncate">{serverName}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {status?.toolCount || 0} tools
                      </Badge>
                      {status?.connected ? (
                        <CheckCircle className="h-3 w-3 text-green-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-red-500" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
