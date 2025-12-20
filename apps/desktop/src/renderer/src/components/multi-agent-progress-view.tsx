import React, { useMemo } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgress } from "@renderer/components/agent-progress"
import { AgentProgressUpdate } from "../../../shared/types"
import { useTheme } from "@renderer/contexts/theme-context"
import { useAgentStore } from "@renderer/stores"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Minimize2 } from "lucide-react"
import { Button } from "./ui/button"

interface MultiAgentProgressViewProps {
  className?: string
  variant?: "default" | "overlay"
  showBackgroundSpinner?: boolean
}

export function MultiAgentProgressView({
  className,
  variant = "overlay",
  showBackgroundSpinner = true,
}: MultiAgentProgressViewProps) {
  const { isDark } = useTheme()
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)

  const activeSessions = useMemo(() => {
    return Array.from(agentProgressById?.entries() ?? [])
      .filter(([_, progress]) => progress && !progress.isSnoozed)
      .sort((a, b) => {
        const timeA = a[1].conversationHistory?.[0]?.timestamp || 0
        const timeB = b[1].conversationHistory?.[0]?.timestamp || 0
        return timeB - timeA
      })
  }, [agentProgressById])

  if (activeSessions.length === 0) {
    return null
  }

  const displaySessionId = (
    focusedSessionId && agentProgressById?.get(focusedSessionId) && !agentProgressById.get(focusedSessionId)!.isSnoozed
  ) ? focusedSessionId : (activeSessions[0]?.[0] || null)

  const focusedProgress = displaySessionId ? agentProgressById?.get(displaySessionId) : undefined

  const getSessionTitle = (progress: AgentProgressUpdate): string => {
    if (progress.conversationTitle) {
      return progress.conversationTitle
    }

    const startIndex = typeof progress.sessionStartIndex === "number" ? progress.sessionStartIndex : 0
    const sessionHistory = progress.conversationHistory?.slice(startIndex) || []
    const userMessage = sessionHistory.find(m => m.role === "user")
    if (userMessage?.content) {
      return userMessage.content.length > 30
        ? userMessage.content.substring(0, 30) + "..."
        : userMessage.content
    }
    return `Session ${progress.sessionId.substring(0, 8)}`
  }

  const handleHidePanel = async () => {
    await tipcClient.hidePanelWindow({})
  }



  return (
    <div className={cn(
      "relative flex h-full w-full flex-col",
      isDark ? "dark" : "",
      className
    )}>
      {/* Tab bar - only show if multiple sessions */}
      {activeSessions.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur-sm">
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {activeSessions.map(([sessionId, progress]) => {
              const isActive = sessionId === (displaySessionId || focusedSessionId)

              return (
                <button
                  key={sessionId}
                  onClick={() => setFocusedSessionId(sessionId)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all",
                    "hover:bg-accent/50",
                    isActive
                      ? "bg-accent text-accent-foreground shadow-sm"
                      : "text-muted-foreground"
                  )}
                  title={getSessionTitle(progress)}
                >
                  <span className="max-w-[120px] truncate">
                    {getSessionTitle(progress)}
                  </span>
                </button>
              )
            })}
          </div>
          {/* Hide panel button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={handleHidePanel}
            title="Hide panel - sessions continue in background"
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Active session progress panel */}
      <div className="relative flex-1 overflow-hidden">
        {focusedProgress && (
          <AgentProgress
            progress={focusedProgress}
            variant={variant}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  )
}

