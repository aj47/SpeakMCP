import React, { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Activity, ChevronDown, ChevronRight, X, Minimize2, Maximize2 } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useConversation } from "@renderer/contexts/conversation-context"
import { logUI, logStateChange } from "@renderer/lib/debug"

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
  isSnoozed?: boolean
}

interface AgentSessionsResponse {
  activeSessions: AgentSession[]
  recentSessions: AgentSession[]
}

const STORAGE_KEY = 'active-agents-sidebar-expanded'

export function ActiveAgentsSidebar() {
  // Load initial expand state from localStorage, default to true
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const initial = stored !== null ? stored === 'true' : true
    logUI('[ActiveAgentsSidebar] Initial expand state:', initial, 'from localStorage:', stored)
    return initial
  })

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

  // Persist expand state to localStorage whenever it changes
  useEffect(() => {
    logStateChange('ActiveAgentsSidebar', 'isExpanded', !isExpanded, isExpanded)
    localStorage.setItem(STORAGE_KEY, String(isExpanded))
  }, [isExpanded])

  // Log when sessions change
  useEffect(() => {
    logUI('[ActiveAgentsSidebar] Sessions updated:', {
      count: activeSessions.length,
      sessions: activeSessions.map(s => ({ id: s.id, title: s.conversationTitle, snoozed: s.isSnoozed }))
    })
  }, [activeSessions.length])

  // Don't render anything if there are no active sessions
  if (!hasActiveSessions) {
    logUI('[ActiveAgentsSidebar] No active sessions, hiding sidebar')
    return null
  }

  const handleSessionClick = (sessionId: string) => {
    logUI('[ActiveAgentsSidebar] Session clicked:', sessionId)
    setFocusedSessionId(sessionId)
  }

  const handleStopSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent session focus when clicking stop
    logUI('[ActiveAgentsSidebar] Stopping session:', sessionId)
    try {
      await tipcClient.stopAgentSession({ sessionId })
    } catch (error) {
      console.error("Failed to stop session:", error)
    }
  }

  const handleToggleSnooze = async (sessionId: string, isSnoozed: boolean, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent session focus when clicking snooze
    logUI('🟢 [ActiveAgentsSidebar SIDEBAR] Minimize button clicked in SIDEBAR (not overlay):', {
      sessionId,
      sidebarSaysIsSnoozed: isSnoozed,
      action: isSnoozed ? 'unsnooze' : 'snooze',
      focusedSessionId,
      allSessions: activeSessions.map(s => ({ id: s.id, snoozed: s.isSnoozed }))
    })
    try {
      if (isSnoozed) {
        // Unsnoozing: restore the session to foreground
        logUI('[ActiveAgentsSidebar] Unsnoozing session')

        // IMPORTANT: Focus the session FIRST before showing panel
        // This ensures agentProgress is computed before the panel renders
        setFocusedSessionId(sessionId)

        // Unsnooze the session in backend
        await tipcClient.unsnoozeAgentSession({ sessionId })

        // Ensure the panel's own ConversationContext focuses the same session
        await tipcClient.focusAgentSession({ sessionId })

        // Resize to agent mode BEFORE showing the panel to avoid flashing to small size
        await tipcClient.resizePanelForAgentMode({})

        // Show the panel (it's already sized correctly)
        await tipcClient.showPanelWindow({})

        logUI('[ActiveAgentsSidebar] Session unsnoozed, focused, panel shown and resized')
      } else {
        // Snoozing: move session to background
        logUI('[ActiveAgentsSidebar] Snoozing session')
        await tipcClient.snoozeAgentSession({ sessionId })
        // Unfocus if this was the focused session
        if (focusedSessionId === sessionId) {
          setFocusedSessionId(null)
        }
        // Hide the panel window
        await tipcClient.hidePanelWindow({})
        logUI('[ActiveAgentsSidebar] Session snoozed, unfocused, and panel hidden')
      }
    } catch (error) {
      console.error("Failed to toggle snooze:", error)
    }
  }

  const handleToggleExpand = () => {
    const newState = !isExpanded
    logUI('[ActiveAgentsSidebar] Toggling expand:', { from: isExpanded, to: newState })
    setIsExpanded(newState)
  }

  return (
    <div className="px-2 pb-2">
      <button
        onClick={handleToggleExpand}
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
                  <Activity className={cn(
                    "h-3 w-3 shrink-0",
                    session.isSnoozed ? "text-muted-foreground" : "animate-pulse text-blue-500"
                  )} />
                  <p className={cn(
                    "flex-1 truncate font-medium",
                    session.isSnoozed ? "text-muted-foreground" : "text-foreground"
                  )}>
                    {session.conversationTitle}
                  </p>
                  <button
                    onClick={(e) => handleToggleSnooze(session.id, session.isSnoozed ?? false, e)}
                    className={cn(
                      "shrink-0 rounded p-0.5 opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:opacity-100",
                      isFocused && "opacity-100"
                    )}
                    title={session.isSnoozed ? "Restore - show progress UI" : "Minimize - run in background"}
                  >
                    {session.isSnoozed ? (
                      <Maximize2 className="h-3 w-3" />
                    ) : (
                      <Minimize2 className="h-3 w-3" />
                    )}
                  </button>
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

