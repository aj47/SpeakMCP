import React from "react"
import { cn } from "@renderer/lib/utils"
import { Spinner } from "@renderer/components/ui/spinner"
import { AgentProgress } from "@renderer/components/agent-progress"
import { AgentProgressUpdate } from "../../../shared/types"

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
  if (!isProcessing && !agentProgress) {
    return null
  }

  return (
    <div className={cn("relative flex h-full w-full", className)}>
      {agentProgress ? (
        <div className="absolute inset-0">
          <AgentProgress
            progress={agentProgress}
            variant={variant}
            className="w-full h-full"
          />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Spinner />
        </div>
      )}

      {/* Show a subtle background spinner when agent progress is active */}
      {agentProgress && showBackgroundSpinner && (
        <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
          <Spinner />
        </div>
      )}
    </div>
  )
}
