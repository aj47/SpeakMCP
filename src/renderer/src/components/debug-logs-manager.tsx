import { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Switch } from "@renderer/components/ui/switch"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useConfigQuery } from "@renderer/lib/query-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Config, DebugLogEntry } from "@shared/types"
import { toast } from "sonner"
import {
  Download,
  Trash2,
  RefreshCw,
  Search,
  Settings,
  FileText,
  AlertCircle,
  Info,
  AlertTriangle,
  Bug,
} from "lucide-react"

interface DebugLogsManagerProps {
  config: Config
  onConfigChange: (updates: Partial<Config>) => void
}

export function DebugLogsManager({ config, onConfigChange }: DebugLogsManagerProps) {
  const [logs, setLogs] = useState<DebugLogEntry[]>([])
  const [filteredLogs, setFilteredLogs] = useState<DebugLogEntry[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [levelFilter, setLevelFilter] = useState<string>("all")
  const [componentFilter, setComponentFilter] = useState<string>("all")
  const [isLoading, setIsLoading] = useState(false)
  const [logStats, setLogStats] = useState<{
    totalSize: string
    fileCount: number
    oldestLog: string
    newestLog: string
  } | null>(null)

  const queryClient = useQueryClient()

  // Fetch logs on component mount and when filters change
  useEffect(() => {
    fetchLogs()
  }, [])

  useEffect(() => {
    filterLogs()
  }, [logs, searchQuery, levelFilter, componentFilter])

  const fetchLogs = async () => {
    setIsLoading(true)
    try {
      const recentLogs = await tipcClient.getDebugLogs({ count: 500 })
      const stats = await tipcClient.getDebugLogStats()
      setLogs(recentLogs)
      setLogStats(stats)
    } catch (error) {
      console.error("Failed to fetch debug logs:", error)
      toast.error("Failed to fetch debug logs")
    } finally {
      setIsLoading(false)
    }
  }

  const filterLogs = () => {
    let filtered = logs

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        log =>
          log.message.toLowerCase().includes(query) ||
          log.component.toLowerCase().includes(query) ||
          (log.details && JSON.stringify(log.details).toLowerCase().includes(query))
      )
    }

    // Filter by level
    if (levelFilter !== "all") {
      filtered = filtered.filter(log => log.level === levelFilter)
    }

    // Filter by component
    if (componentFilter !== "all") {
      filtered = filtered.filter(log => log.component === componentFilter)
    }

    setFilteredLogs(filtered)
  }

  const clearLogs = async () => {
    try {
      await tipcClient.clearDebugLogs()
      setLogs([])
      setFilteredLogs([])
      toast.success("Debug logs cleared")
      fetchLogs() // Refresh stats
    } catch (error) {
      console.error("Failed to clear debug logs:", error)
      toast.error("Failed to clear debug logs")
    }
  }

  const exportLogs = async () => {
    try {
      const result = await tipcClient.exportDebugLogs()
      toast.success(`Debug logs exported to: ${result.path}`)
    } catch (error) {
      console.error("Failed to export debug logs:", error)
      toast.error("Failed to export debug logs")
    }
  }

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case "info":
        return <Info className="h-4 w-4 text-blue-500" />
      case "debug":
        return <Bug className="h-4 w-4 text-gray-500" />
      default:
        return <FileText className="h-4 w-4" />
    }
  }

  const getLevelBadgeVariant = (level: string) => {
    switch (level) {
      case "error":
        return "destructive"
      case "warning":
        return "secondary"
      case "info":
        return "default"
      case "debug":
        return "outline"
      default:
        return "outline"
    }
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const uniqueComponents = Array.from(new Set(logs.map(log => log.component))).sort()

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Debug Logs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Configuration Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Configuration</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="debug-logging-enabled">Enable Debug Logging</Label>
                <Switch
                  id="debug-logging-enabled"
                  checked={config.debugLoggingEnabled || false}
                  onCheckedChange={(checked) =>
                    onConfigChange({ debugLoggingEnabled: checked })
                  }
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="debug-logging-level">Log Level</Label>
                <Select
                  value={config.debugLoggingLevel || "info"}
                  onValueChange={(value) =>
                    onConfigChange({ debugLoggingLevel: value as any })
                  }
                  disabled={!config.debugLoggingEnabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debug">Debug</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="debug-logging-max-file-size">Max File Size (MB)</Label>
                <Input
                  id="debug-logging-max-file-size"
                  type="number"
                  min="1"
                  max="100"
                  value={config.debugLoggingMaxFileSize || 10}
                  onChange={(e) =>
                    onConfigChange({ debugLoggingMaxFileSize: parseInt(e.target.value) })
                  }
                  disabled={!config.debugLoggingEnabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="debug-logging-max-files">Max Files to Keep</Label>
                <Input
                  id="debug-logging-max-files"
                  type="number"
                  min="1"
                  max="20"
                  value={config.debugLoggingMaxFiles || 5}
                  onChange={(e) =>
                    onConfigChange({ debugLoggingMaxFiles: parseInt(e.target.value) })
                  }
                  disabled={!config.debugLoggingEnabled}
                />
              </div>
            </div>
          </div>

          <div className="border-t my-4" />

          {/* Log Statistics */}
          {logStats && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Statistics</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Size:</span>
                  <div className="font-medium">{logStats.totalSize}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Files:</span>
                  <div className="font-medium">{logStats.fileCount}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Oldest:</span>
                  <div className="font-medium">{logStats.oldestLog}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Newest:</span>
                  <div className="font-medium">{logStats.newestLog}</div>
                </div>
              </div>
            </div>
          )}

          <div className="border-t my-4" />

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64"
              />
            </div>

            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <Select value={componentFilter} onValueChange={setComponentFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Components</SelectItem>
                {uniqueComponents.map(component => (
                  <SelectItem key={component} value={component}>
                    {component}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchLogs}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportLogs}
                disabled={!config.debugLoggingEnabled}
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearLogs}
                disabled={!config.debugLoggingEnabled}
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </Button>
            </div>
          </div>

          {/* Log Entries */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">
                Recent Logs ({filteredLogs.length} of {logs.length})
              </h4>
            </div>
            
            <ScrollArea className="h-96 w-full border rounded-md">
              <div className="p-4 space-y-2">
                {filteredLogs.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    {!config.debugLoggingEnabled
                      ? "Debug logging is disabled. Enable it to see logs."
                      : logs.length === 0
                      ? "No debug logs available."
                      : "No logs match your search criteria."}
                  </div>
                ) : (
                  filteredLogs.map((log, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card text-card-foreground hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {getLevelIcon(log.level)}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={getLevelBadgeVariant(log.level) as any}>
                            {log.level.toUpperCase()}
                          </Badge>
                          <Badge variant="outline">{log.component}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(log.timestamp)}
                          </span>
                        </div>
                        <div className="text-sm">{log.message}</div>
                        {log.details && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer hover:text-foreground">
                              Show details
                            </summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </details>
                        )}
                        {log.stack && log.level === "error" && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer hover:text-foreground">
                              Show stack trace
                            </summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                              {log.stack}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
