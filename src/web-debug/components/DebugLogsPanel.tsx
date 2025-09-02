import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Copy, Download, Trash2, Filter } from 'lucide-react'
import { Button } from '../../renderer/src/components/ui/button'
import { Badge } from '../../renderer/src/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../renderer/src/components/ui/select'
import { Input } from '../../renderer/src/components/ui/input'
import { cn } from '../../renderer/src/lib/utils'
import { logger, LogEntry, LogLevel, LogCategory } from '../utils/logger'

interface DebugLogsPanelProps {
  className?: string
  defaultExpanded?: boolean
}

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  trace: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  debug: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  info: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  warn: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}

const CATEGORY_COLORS: Record<LogCategory, string> = {
  'agent': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  'mcp-client': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  'transport': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  'tool-call': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  'oauth/auth': 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  'network': 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  'ui': 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  'session': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
}

const LogEntryComponent: React.FC<{ entry: LogEntry; isExpanded: boolean; onToggle: () => void }> = ({
  entry,
  isExpanded,
  onToggle
}) => {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  })

  const hasDetails = entry.data || entry.error || entry.duration !== undefined

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <div
        className={cn(
          "flex items-start gap-2 p-2 text-xs hover:bg-muted/30 cursor-pointer",
          hasDetails && "select-none"
        )}
        onClick={hasDetails ? onToggle : undefined}
      >
        {hasDetails && (
          <div className="flex-shrink-0 mt-0.5">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
        )}

        <div className="flex-shrink-0 font-mono text-muted-foreground">
          {timestamp}
        </div>

        <Badge variant="outline" className={cn("text-xs px-1 py-0", LOG_LEVEL_COLORS[entry.level])}>
          {entry.level.toUpperCase()}
        </Badge>

        <Badge variant="outline" className={cn("text-xs px-1 py-0", CATEGORY_COLORS[entry.category])}>
          {entry.category}
        </Badge>

        <div className="flex-1 min-w-0">
          <div className="break-words">{entry.message}</div>

          {/* Context badges */}
          <div className="flex gap-1 mt-1">
            {entry.sessionId && (
              <Badge variant="secondary" className="text-xs px-1 py-0">
                session:{entry.sessionId.slice(-8)}
              </Badge>
            )}
            {entry.messageId && (
              <Badge variant="secondary" className="text-xs px-1 py-0">
                msg:{entry.messageId.slice(-8)}
              </Badge>
            )}
            {entry.toolCallId && (
              <Badge variant="secondary" className="text-xs px-1 py-0">
                tool:{entry.toolCallId.slice(-8)}
              </Badge>
            )}
            {entry.duration !== undefined && (
              <Badge variant="secondary" className="text-xs px-1 py-0">
                {entry.duration}ms
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {hasDetails && isExpanded && (
        <div className="px-4 pb-2 text-xs">
          {entry.data && (
            <div className="mb-2">
              <div className="text-muted-foreground mb-1">Data:</div>
              <pre className="bg-muted/50 p-2 rounded text-xs overflow-x-auto">
                {typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)}
              </pre>
            </div>
          )}

          {entry.error && (
            <div className="mb-2">
              <div className="text-muted-foreground mb-1">Error:</div>
              <pre className="bg-red-50 dark:bg-red-950 p-2 rounded text-xs overflow-x-auto text-red-800 dark:text-red-200">
                {entry.error.stack || entry.error.message || String(entry.error)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const DebugLogsPanel: React.FC<DebugLogsPanelProps> = ({
  className,
  defaultExpanded = false
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set())
  const [currentLevel, setCurrentLevel] = useState<LogLevel>(logger.getLevel())
  const [filterText, setFilterText] = useState('')
  const [filterCategory, setFilterCategory] = useState<LogCategory | 'all'>('all')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Subscribe to logger updates
  useEffect(() => {
    const unsubscribe = logger.addListener((entry) => {
      setEntries(prev => [...prev, entry])

      // Auto-scroll to bottom if enabled
      if (autoScroll && scrollRef.current) {
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }
        }, 10)
      }
    })

    // Load existing entries
    setEntries(logger.getEntries())

    return unsubscribe
  }, [autoScroll])

  // Handle scroll to detect manual scrolling
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10
      setAutoScroll(isAtBottom)
    }
  }

  const filteredEntries = entries.filter(entry => {
    if (filterCategory !== 'all' && entry.category !== filterCategory) return false
    if (filterText && !entry.message.toLowerCase().includes(filterText.toLowerCase())) return false
    return true
  })

  const handleLevelChange = (level: LogLevel) => {
    setCurrentLevel(level)
    logger.setLevel(level)
  }

  const handleCopyLogs = () => {
    const logsText = logger.exportLogs()
    navigator.clipboard.writeText(logsText)
  }

  const handleDownloadLogs = () => {
    const logsText = logger.exportLogs()
    const blob = new Blob([logsText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `speakmcp-debug-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleClearLogs = () => {
    logger.clearEntries()
    setEntries([])
    setExpandedEntries(new Set())
  }

  const toggleEntryExpansion = (index: number) => {
    setExpandedEntries(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }

  return (
    <div className={cn("border border-border rounded-lg", className)}>
      <div className="flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span className="font-medium">Debug Logs</span>
          <Badge variant="secondary" className="text-xs">
            {filteredEntries.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {currentLevel.toUpperCase()}
          </Badge>
        </div>
      </div>

      {isExpanded && (
        <div>
          {/* Controls */}
          <div className="border-t border-border p-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={currentLevel} onValueChange={handleLevelChange}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trace">TRACE</SelectItem>
                  <SelectItem value="debug">DEBUG</SelectItem>
                  <SelectItem value="info">INFO</SelectItem>
                  <SelectItem value="warn">WARN</SelectItem>
                  <SelectItem value="error">ERROR</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterCategory} onValueChange={(value) => setFilterCategory(value as LogCategory | 'all')}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="mcp-client">MCP Client</SelectItem>
                  <SelectItem value="transport">Transport</SelectItem>
                  <SelectItem value="tool-call">Tool Call</SelectItem>
                  <SelectItem value="oauth/auth">OAuth/Auth</SelectItem>
                  <SelectItem value="network">Network</SelectItem>
                  <SelectItem value="ui">UI</SelectItem>
                  <SelectItem value="session">Session</SelectItem>
                </SelectContent>
              </Select>

              <Input
                placeholder="Filter messages..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="flex-1 min-w-32"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleCopyLogs}>
                <Copy className="h-3 w-3 mr-1" />
                Copy All
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownloadLogs}>
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
              <Button size="sm" variant="outline" onClick={handleClearLogs}>
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </Button>

              <div className="flex-1" />

              {!autoScroll && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (scrollRef.current) {
                      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
                      setAutoScroll(true)
                    }
                  }}
                >
                  Scroll to Bottom
                </Button>
              )}
            </div>
          </div>

          {/* Log entries */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-96 overflow-y-auto border-t border-border"
          >
            {filteredEntries.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No log entries to display
              </div>
            ) : (
              filteredEntries.map((entry, index) => (
                <LogEntryComponent
                  key={`${entry.timestamp}-${index}`}
                  entry={entry}
                  isExpanded={expandedEntries.has(index)}
                  onToggle={() => toggleEntryExpansion(index)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
