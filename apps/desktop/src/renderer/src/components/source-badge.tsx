import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip"
import { Badge } from "./ui/badge"
import { cn } from "@renderer/lib/utils"
import type { MessageSource } from '@speakmcp/shared'

interface SourceBadgeProps {
  source?: MessageSource
  className?: string
  showLabel?: boolean
  size?: 'sm' | 'md'
}

/**
 * Source configuration for display
 */
const SOURCE_CONFIG: Record<MessageSource, { label: string; color: string; icon: string }> = {
  native: { label: 'Native', color: 'bg-green-500/10 text-green-700 border-green-500/20', icon: '🟢' },
  augment: { label: 'Augment', color: 'bg-purple-500/10 text-purple-700 border-purple-500/20', icon: '🔮' },
  'claude-code': { label: 'Claude Code', color: 'bg-amber-500/10 text-amber-700 border-amber-500/20', icon: '💻' },
  mobile: { label: 'Mobile', color: 'bg-blue-500/10 text-blue-700 border-blue-500/20', icon: '📱' },
  api: { label: 'API', color: 'bg-gray-500/10 text-gray-700 border-gray-500/20', icon: '🔌' },
}

/**
 * A badge component showing the source/origin of a message or session.
 * Visual indicators for native vs external sessions (Augment, Claude Code, Mobile, API).
 */
export function SourceBadge({ source, className, showLabel = true, size = 'sm' }: SourceBadgeProps) {
  // If no source provided, default to native
  const sourceKey: MessageSource = source || 'native'
  const config = SOURCE_CONFIG[sourceKey]

  // If source is native and showLabel is true, we can optionally hide it
  // since native is the default/common case
  if (sourceKey === 'native' && !showLabel) {
    return null
  }

  const badgeColor = config.color
  const label = showLabel ? config.label : ''

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              'inline-flex items-center gap-1 cursor-help border',
              badgeColor,
              size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5',
              className
            )}
          >
            <span>{config.icon}</span>
            {label && <span className="font-medium">{label}</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <p>Session source: {config.label}</p>
          {sourceKey === 'native' && (
            <p className="text-muted-foreground mt-1">Created directly in SpeakMCP</p>
          )}
          {sourceKey === 'augment' && (
            <p className="text-muted-foreground mt-1">Synced from Augment</p>
          )}
          {sourceKey === 'claude-code' && (
            <p className="text-muted-foreground mt-1">Synced from Claude Code</p>
          )}
          {sourceKey === 'mobile' && (
            <p className="text-muted-foreground mt-1">Synced from mobile app</p>
          )}
          {sourceKey === 'api' && (
            <p className="text-muted-foreground mt-1">Accessed via API</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Get a human-readable description of a source
 */
export function getSourceDescription(source: MessageSource | undefined): string {
  if (!source || source === 'native') return 'Created directly in SpeakMCP'
  const config = SOURCE_CONFIG[source]
  return `Synced from ${config?.label || source}`
}
