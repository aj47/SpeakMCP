import React, { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Activity, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@renderer/lib/utils"

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
          {activeSessions.map((session) => (
            <div
              key={session.id}
              className="rounded-md border border-border/50 bg-card/50 px-2 py-1.5 text-xs"
            >
              <div className="flex items-center gap-1.5">
                <Activity className="h-3 w-3 animate-pulse text-blue-500 shrink-0" />
                <p className="truncate font-medium text-foreground">
                  {session.conversationTitle}
                </p>
              </div>
              {session.lastActivity && (
                <p className="mt-0.5 truncate pl-4 text-[10px] text-muted-foreground">
                  {session.lastActivity}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

