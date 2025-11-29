import React, { useState } from "react"
import { cn } from "@renderer/lib/utils"
import { Spinner } from "@renderer/components/ui/spinner"
import { AgentProgress } from "@renderer/components/agent-progress"
import { AgentProgressUpdate } from "../../../shared/types"
import { useTheme } from "@renderer/contexts/theme-context"
import { Button } from "@renderer/components/ui/button"
import { X, AlertTriangle } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"

interface AgentProcessingViewProps {
  agentProgress: AgentProgressUpdate | null
  isProcessing: boolean
  className?: string
  variant?: "default" | "overlay"
  showBackgroundSpinner?: boolean
}

/**
 * Unified component for displaying agent processing state.
 * Used by both text input and voice input modes to show consistent progress.
 */
export function AgentProcessingView({
  agentProgress,
  isProcessing,
  className,
  variant = "overlay",
  showBackgroundSpinner = true,
}: AgentProcessingViewProps) {
  const { isDark } = useTheme()
  const [showKillConfirmation, setShowKillConfirmation] = useState(false)
  const [isKilling, setIsKilling] = useState(false)

  if (!isProcessing && !agentProgress) {
    return null
  }

  // Kill switch handler for loading state
  const handleKillSwitch = async () => {
    if (isKilling) return // Prevent double-clicks

    setIsKilling(true)
    try {
      if (agentProgress?.sessionId) {
        // Stop only the focused session; let final progress update clean up UI
        await tipcClient.stopAgentSession({ sessionId: agentProgress.sessionId })
      } else {
        // No session progress yet (e.g., submitting input). Defer to parent to control UI.
        // Intentionally no global clear here to avoid wiping other sessions.
      }
      setShowKillConfirmation(false)
    } catch (error) {
      console.error("Failed to stop agent:", error)
    } finally {
      setIsKilling(false)
    }
  }

  const handleKillConfirmation = () => {
    setShowKillConfirmation(true)
  }

  const handleCancelKill = () => {
    setShowKillConfirmation(false)
  }

  return (
    <div className={cn(
      "relative flex h-full w-full",
      isDark ? "dark" : "",
      className
    )}>
      {agentProgress ? (
        <div className="absolute inset-0">
          <AgentProgress
            progress={agentProgress}
            variant={variant}
            className="w-full h-full"
          />
        </div>
      ) : (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-4">
          {/* Killswitch button in top-right corner */}
          <div className="absolute right-2 top-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
              onClick={handleKillConfirmation}
              disabled={isKilling}
              title="Stop agent execution"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          {/* Spinner and loading text */}
          <Spinner />
          <span className="text-sm text-muted-foreground">Processing...</span>

          {/* Help text showing keyboard shortcut */}
          <div className="text-xs text-muted-foreground">
            Press Ctrl+Shift+Escape or click the X button to stop
          </div>
        </div>
      )}

      {/* Show a subtle background spinner when agent progress is active */}
      {agentProgress && showBackgroundSpinner && (
        <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
          <Spinner />
        </div>
      )}

      {/* Kill Switch Confirmation Dialog - shown for loading state */}
      {!agentProgress && showKillConfirmation && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg p-4 max-w-sm mx-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <h3 className="text-sm font-medium">Stop Agent Execution</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Are you sure you want to stop this session? Other sessions will continue running.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelKill}
                disabled={isKilling}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleKillSwitch}
                disabled={isKilling}
              >
                {isKilling ? "Stopping..." : "Stop Agent"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
