import React, { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { Activity, ChevronDown, ChevronRight, X, Minimize2, Maximize2, Shield } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useAgentStore } from "@renderer/stores"
import { logUI, logStateChange, logExpand } from "@renderer/lib/debug"
import { useNavigate } from "react-router-dom"

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
    logExpand("ActiveAgentsSidebar", "init", { key: STORAGE_KEY, raw: stored, parsed: initial })
    return initial
  })

  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  const navigate = useNavigate()

  const { data, refetch } = useQuery<AgentSessionsResponse>({
    queryKey: ["agentSessions"],
    queryFn: async () => {
      return await tipcClient.getAgentSessions()
    },
    // No polling - we'll use push-based updates via rendererHandlers
  })

  // Listen for push-based session updates from main process
  useEffect(() => {
    const unlisten = rendererHandlers.agentSessionsUpdated.listen((updatedData) => {
      // Invalidate the query to trigger a refetch with the new data
      refetch()
    })
    return unlisten
  }, [refetch])

  const activeSessions = data?.activeSessions || []
  const recentSessions = data?.recentSessions || []
  const hasActiveSessions = activeSessions.length > 0
  const hasRecentSessions = recentSessions.length > 0
  const hasAnySessions = hasActiveSessions || hasRecentSessions

  // Persist expand state to localStorage whenever it changes
  useEffect(() => {
    logStateChange('ActiveAgentsSidebar', 'isExpanded', !isExpanded, isExpanded)
    logExpand("ActiveAgentsSidebar", "write", { key: STORAGE_KEY, value: isExpanded })
    try {
      const valueStr = String(isExpanded)
      localStorage.setItem(STORAGE_KEY, valueStr)
      const verify = localStorage.getItem(STORAGE_KEY)
      logExpand("ActiveAgentsSidebar", "verify", { key: STORAGE_KEY, wrote: valueStr, readBack: verify })
    } catch (e) {
      logExpand("ActiveAgentsSidebar", "error", { key: STORAGE_KEY, error: e instanceof Error ? e.message : String(e) })
    }
  }, [isExpanded])

  // Log when sessions change
  useEffect(() => {
    logUI('[ActiveAgentsSidebar] Sessions updated:', {
      count: activeSessions.length,
      sessions: activeSessions.map(s => ({ id: s.id, title: s.conversationTitle, snoozed: s.isSnoozed }))
    })
  }, [activeSessions.length])

  // Don't render anything if there are no sessions (active or recent)
  if (!hasAnySessions) {
    logUI('[ActiveAgentsSidebar] No sessions (active or recent), hiding sidebar')
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
      // If we just stopped the focused session, just unfocus; do not clear all progress
      if (focusedSessionId === sessionId) {
        setFocusedSessionId(null)
      }
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
        await tipcClient.setPanelMode({ mode: "agent" })

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
    logExpand("ActiveAgentsSidebar", "toggle", { from: isExpanded, to: newState, source: "user" })
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
            const sessionProgress = agentProgressById.get(session.id)
            const hasPendingApproval = !!sessionProgress?.pendingToolApproval
            return (
              <div
                key={session.id}
                onClick={() => handleSessionClick(session.id)}
                className={cn(
                  "group relative cursor-pointer rounded-md border px-2 py-1.5 text-xs transition-all",
                  hasPendingApproval
                    ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/20"
                    : isFocused
                    ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/20"
                    : "border-border/50 bg-card/50 hover:border-border hover:bg-card"
                )}
              >
                <div className="flex items-center gap-1.5">
                  {hasPendingApproval ? (
                    <Shield className="h-3 w-3 shrink-0 text-amber-500 animate-pulse" />
                  ) : (
                    <Activity className={cn(
                      "h-3 w-3 shrink-0",
                      session.isSnoozed ? "text-muted-foreground" : "animate-pulse text-blue-500"
                    )} />
                  )}
                  <p className={cn(
                    "flex-1 truncate font-medium",
                    hasPendingApproval ? "text-amber-700 dark:text-amber-300" :
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
                {hasPendingApproval ? (
                  <p className="mt-0.5 truncate pl-4 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                    ⚠ Approval required: {sessionProgress.pendingToolApproval?.toolName}
                  </p>
                ) : session.lastActivity && (
                  <p className="mt-0.5 truncate pl-4 text-[10px] text-muted-foreground">
                    {session.lastActivity}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {isExpanded && hasRecentSessions && (
        <div className="mt-2 space-y-1 pl-2">
          <div className="px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">Recent</div>
          {recentSessions.map((session) => {
            const statusLabel = session.status === "stopped" ? "Stopped" : session.status === "error" ? "Error" : "Completed"
            return (
              <div
                key={session.id}
                onClick={() => {
                  if (session.conversationId) {
                    logUI('[ActiveAgentsSidebar] Navigating to history for completed session:', session.conversationId)
                    navigate(`/history/${session.conversationId}`)
                  }
                }}
                className={cn(
                  "relative rounded-md border px-2 py-1.5 text-xs text-muted-foreground bg-card/30 transition-all",
                  session.conversationId && "cursor-pointer hover:bg-card/50 hover:border-border"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Activity className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <p className="flex-1 truncate">{session.conversationTitle}</p>
                  <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px]">{statusLabel}</span>
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

