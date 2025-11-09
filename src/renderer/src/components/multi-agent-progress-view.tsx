import React from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgress } from "@renderer/components/agent-progress"
import { AgentProgressUpdate } from "../../../shared/types"
import { useTheme } from "@renderer/contexts/theme-context"

import { useConversation } from "@renderer/contexts/conversation-context"

interface MultiAgentProgressViewProps {
  className?: string
  variant?: "default" | "overlay"
  showBackgroundSpinner?: boolean
}

/**
 * Component for displaying multiple agent progress panels with tabs.
 * Shows all active agent sessions and allows switching between them.
 */
export function MultiAgentProgressView({
  className,
  variant = "overlay",
  showBackgroundSpinner = true,
}: MultiAgentProgressViewProps) {
  const { isDark } = useTheme()
  const { agentProgressById, focusedSessionId, setFocusedSessionId } = useConversation()

  // Get all active sessions (non-snoozed)
  const activeSessions = Array.from(agentProgressById.entries())
    .filter(([_, progress]) => !progress.isSnoozed)
    .sort((a, b) => {
      // Sort by start time (newer first)
      const timeA = a[1].conversationHistory?.[0]?.timestamp || 0
      const timeB = b[1].conversationHistory?.[0]?.timestamp || 0
      return timeB - timeA
    })

  // If no active sessions, return null
  if (activeSessions.length === 0) {
    return null
  }

  // Get the focused session's progress
  const focusedProgress = focusedSessionId
    ? agentProgressById.get(focusedSessionId)
    : activeSessions[0]?.[1]

  // Helper to get session title
  const getSessionTitle = (progress: AgentProgressUpdate): string => {
    const userMessage = progress.conversationHistory?.find(m => m.role === "user")
    if (userMessage?.content) {
      return userMessage.content.length > 30
        ? userMessage.content.substring(0, 30) + "..."
        : userMessage.content
    }
    return `Session ${progress.sessionId.substring(0, 8)}`
  }



  return (
    <div className={cn(
      "relative flex h-full w-full flex-col",
      isDark ? "dark" : "",
      className
    )}>
      {/* Tab bar - only show if multiple sessions */}
      {activeSessions.length > 1 && (
        <div className="flex shrink-0 gap-1 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur-sm">
          {activeSessions.map(([sessionId, progress]) => {
            const isActive = sessionId === focusedSessionId ||
                           (!focusedSessionId && sessionId === activeSessions[0][0])

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

