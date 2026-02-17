import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip"
import { cn } from "@renderer/lib/utils"

interface ToolExecutionStatsProps {
  stats: {
    durationMs?: number
    totalTokens?: number
    model?: string
  }
  subagentId?: string
  compact?: boolean
  className?: string
}

/**
 * Format duration in milliseconds to a human-readable string.
 * Examples: 3062 -> "3.1s", 150 -> "150ms", 65000 -> "1m 5s"
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

/**
 * Format token count to a human-readable string.
 * Examples: 17000 -> "17k", 1500000 -> "1.5M", 500 -> "500"
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return `${tokens}`
}

/**
 * Truncate a subagent ID for display.
 * Example: "a6a4f4d8-1234-5678-abcd-ef1234567890" -> "agent:a6a4f4d"
 */
function truncateSubagentId(id: string): string {
  // If it looks like a UUID, truncate it
  if (id.length > 12 && id.includes("-")) {
    const shortId = id.split("-")[0].slice(0, 7)
    return `agent:${shortId}`
  }
  // If it's already short, return as-is
  if (id.length <= 12) {
    return id
  }
  // Otherwise truncate with ellipsis
  return `${id.slice(0, 10)}...`
}

/**
 * A component for displaying tool execution stats.
 * 
 * Visual (compact): `haiku • 3.1s • 17k tokens`
 * Visual (expanded): Full breakdown with model, duration, and token details
 */
export function ToolExecutionStats({
  stats,
  subagentId,
  compact = true,
  className,
}: ToolExecutionStatsProps) {
  const { durationMs, totalTokens, model } = stats

  // If no stats to display, return null
  if (!durationMs && !totalTokens && !model && !subagentId) {
    return null
  }

  // Build stats parts for display
  const parts: string[] = []
  if (model) parts.push(model)
  if (durationMs !== undefined) parts.push(formatDuration(durationMs))
  if (totalTokens !== undefined) parts.push(`${formatTokens(totalTokens)} tokens`)

  // Truncated subagent ID for display
  const displaySubagentId = subagentId ? truncateSubagentId(subagentId) : null

  if (compact) {
    // Compact mode: single line with dot separators
    const displayParts = [...parts]
    if (displaySubagentId) displayParts.unshift(displaySubagentId)

    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center text-[10px] text-muted-foreground font-mono cursor-help",
                className
              )}
            >
              {displayParts.join(" • ")}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="space-y-0.5">
              {subagentId && <p>Subagent: {subagentId}</p>}
              {model && <p>Model: {model}</p>}
              {durationMs !== undefined && <p>Duration: {formatDuration(durationMs)}</p>}
              {totalTokens !== undefined && <p>Tokens: {totalTokens.toLocaleString()}</p>}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Expanded mode: detailed breakdown
  return (
    <div className={cn("text-xs space-y-1", className)}>
      {displaySubagentId && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Subagent:</span>
          <span className="font-mono text-foreground">{displaySubagentId}</span>
          {subagentId && subagentId !== displaySubagentId && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={subagentId}>
              ({subagentId})
            </span>
          )}
        </div>
      )}
      {model && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Model:</span>
          <span className="font-mono text-foreground">{model}</span>
        </div>
      )}
      {durationMs !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Duration:</span>
          <span className="font-mono text-foreground">{formatDuration(durationMs)}</span>
          <span className="text-[10px] text-muted-foreground">({durationMs.toLocaleString()}ms)</span>
        </div>
      )}
      {totalTokens !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Tokens:</span>
          <span className="font-mono text-foreground">{totalTokens.toLocaleString()}</span>
        </div>
      )}
    </div>
  )
}

