import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip"
import { Badge } from "./ui/badge"
import { cn } from "@renderer/lib/utils"

interface ACPSessionBadgeProps {
  info: {
    agentTitle?: string
    agentVersion?: string
    currentModel?: string
    currentMode?: string
  }
  className?: string
}

/**
 * A compact badge component showing ACP session agent info.
 * Displays agent title/version and model/mode in a compact format.
 * 
 * Visual example: `[Claude Code v0.12.6] [Sonnet 4.5]`
 */
export function ACPSessionBadge({ info, className }: ACPSessionBadgeProps) {
  const { agentTitle, agentVersion, currentModel, currentMode } = info

  // Build agent label (e.g., "Claude Code v0.12.6")
  const agentLabel = agentTitle
    ? agentVersion
      ? `${agentTitle} v${agentVersion}`
      : agentTitle
    : null

  // Build model label (e.g., "Sonnet 4.5" or "claude-3-5-sonnet")
  const modelLabel = currentModel || null

  // If nothing to display, return null
  if (!agentLabel && !modelLabel) {
    return null
  }

  // Build tooltip content with all available info
  const tooltipLines: string[] = []
  if (agentTitle) tooltipLines.push(`Agent: ${agentTitle}`)
  if (agentVersion) tooltipLines.push(`Version: ${agentVersion}`)
  if (currentModel) tooltipLines.push(`Model: ${currentModel}`)
  if (currentMode) tooltipLines.push(`Mode: ${currentMode}`)

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex items-center gap-1.5 cursor-help",
              className
            )}
          >
            {agentLabel && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 font-medium"
              >
                {agentLabel}
              </Badge>
            )}
            {modelLabel && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 font-mono"
              >
                {modelLabel}
                {currentMode && (
                  <span className="ml-1 opacity-60">• {currentMode}</span>
                )}
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          <div className="space-y-0.5">
            {tooltipLines.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

