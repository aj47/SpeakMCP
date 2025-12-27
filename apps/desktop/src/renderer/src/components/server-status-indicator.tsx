import { useServerConnectionStore } from "@renderer/stores"
import { cn } from "@renderer/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip"

interface ServerStatusIndicatorProps {
  compact?: boolean
  className?: string
}

export function ServerStatusIndicator({ compact = false, className }: ServerStatusIndicatorProps) {
  const {
    mode,
    isConnected,
    isConnecting,
    wsStatus,
    healthStatus,
    lastError,
    remoteServerUrl,
  } = useServerConnectionStore()

  // Don't show anything in local mode
  if (mode === 'local') {
    return null
  }

  const getStatusColor = () => {
    if (isConnecting) return 'bg-yellow-500 animate-pulse'
    if (isConnected && wsStatus === 'connected') return 'bg-green-500'
    if (isConnected) return 'bg-blue-500'
    if (lastError) return 'bg-red-500'
    return 'bg-gray-400'
  }

  const getStatusText = () => {
    if (isConnecting) return 'Connecting to server...'
    if (isConnected && wsStatus === 'connected') return `Connected to ${remoteServerUrl} (WebSocket active)`
    if (isConnected) return `Connected to ${remoteServerUrl} (HTTP only)`
    if (lastError) return `Connection error: ${lastError}`
    return 'Disconnected from server'
  }

  const getHealthText = () => {
    if (!healthStatus) return ''
    return `Server: ${healthStatus.status}`
  }

  const indicator = (
    <div
      className={cn(
        "flex items-center gap-1.5",
        compact ? "px-1" : "px-2 py-1 rounded-md bg-muted/50",
        className
      )}
    >
      <span className={cn("w-2 h-2 rounded-full shrink-0", getStatusColor())} />
      {!compact && (
        <span className="text-xs text-muted-foreground truncate">
          {isConnected ? 'Remote' : 'Offline'}
        </span>
      )}
    </div>
  )

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {indicator}
        </TooltipTrigger>
        <TooltipContent side="right" align="center">
          <div className="text-sm space-y-1">
            <div>{getStatusText()}</div>
            {healthStatus && (
              <div className="text-xs text-muted-foreground">{getHealthText()}</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

