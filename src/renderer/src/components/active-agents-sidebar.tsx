import React, { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Activity, ChevronDown, ChevronRight, X } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useConversation } from "@renderer/contexts/conversation-context"

interface AgentSession {
  id: string
  conversationId?: string
  conversationTitle?: string
  status: "active" | "completed" | "error" | "stopped"
  startTime: number
  endTime?: number
  currentIteration?: number
  maxIterations?: number
  lastActivity?: string
  errorMessage?: string
}

interface AgentSessionsResponse {
  activeSessions: AgentSession[]
  recentSessions: AgentSession[]
}

export function ActiveAgentsSidebar() {
  const [isExpanded, setIsExpanded] = useState(true)
  const { focusedSessionId, setFocusedSessionId } = useConversation()

  const { data } = useQuery<AgentSessionsResponse>({
    queryKey: ["agentSessions"],
    queryFn: async () => {
      return await tipcClient.getAgentSessions()
    },
    refetchInterval: 2000, // Refresh every 2 seconds
  })

  const activeSessions = data?.activeSessions || []
  const hasActiveSessions = activeSessions.length > 0

  // Don't render anything if there are no active sessions
  if (!hasActiveSessions) {
    return null
  }

  const handleSessionClick = (sessionId: string) => {
    setFocusedSessionId(sessionId)
  }

  const handleStopSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent session focus when clicking stop
    try {
      await tipcClient.stopAgentSession({ sessionId })
    } catch (error) {
      console.error("Failed to stop session:", error)
    }
  }

  return (
    <div className="px-2 pb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-all duration-200",
          "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Activity className="h-3.5 w-3.5" />
        <span>Active Agents</span>
        <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold text-white">
          {activeSessions.length}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-1 space-y-1 pl-2">
          {activeSessions.map((session) => {
            const isFocused = focusedSessionId === session.id
            return (
              <div
                key={session.id}
                onClick={() => handleSessionClick(session.id)}
                className={cn(
                  "group relative cursor-pointer rounded-md border px-2 py-1.5 text-xs transition-all",
                  isFocused
                    ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/20"
                    : "border-border/50 bg-card/50 hover:border-border hover:bg-card"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Activity className="h-3 w-3 animate-pulse text-blue-500 shrink-0" />
                  <p className="flex-1 truncate font-medium text-foreground">
                    {session.conversationTitle}
                  </p>
                  <button
                    onClick={(e) => handleStopSession(session.id, e)}
                    className={cn(
                      "shrink-0 rounded p-0.5 opacity-0 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100",
                      isFocused && "opacity-100"
                    )}
                    title="Stop this agent session"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {session.lastActivity && (
                  <p className="mt-0.5 truncate pl-4 text-[10px] text-muted-foreground">
                    {session.lastActivity}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

