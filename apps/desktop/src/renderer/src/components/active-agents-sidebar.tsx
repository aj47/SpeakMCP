import React, { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { ChevronDown, ChevronRight, X, Minimize2, Maximize2, CheckCircle2, Trash2, Clock, Loader2, Search, FolderOpen, AlertTriangle } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useAgentStore } from "@renderer/stores"
import { logUI, logStateChange, logExpand } from "@renderer/lib/debug"
import { useNavigate } from "react-router-dom"
import { useConversationHistoryQuery, useUnifiedConversationHistoryQuery, useDeleteConversationMutation, useDeleteAllConversationsMutation } from "@renderer/lib/queries"
import { Input } from "@renderer/components/ui/input"
import { Button } from "@renderer/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { toast } from "sonner"
import { ConversationHistoryItem, UnifiedConversationHistoryItem, ExternalSessionSource } from "@shared/types"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

// Enable relative time plugin for dayjs
dayjs.extend(relativeTime)

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
const PAST_SESSIONS_STORAGE_KEY = 'past-sessions-sidebar-expanded'
const INITIAL_PAST_SESSIONS = 10

export function ActiveAgentsSidebar() {
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const initial = stored !== null ? stored === 'true' : true
    logExpand("ActiveAgentsSidebar", "init", { key: STORAGE_KEY, raw: stored, parsed: initial })
    return initial
  })

  const [isPastSessionsExpanded, setIsPastSessionsExpanded] = useState(() => {
    const stored = localStorage.getItem(PAST_SESSIONS_STORAGE_KEY)
    return stored !== null ? stored === 'true' : true
  })

  const [pastSessionsCount, setPastSessionsCount] = useState(INITIAL_PAST_SESSIONS)
  const [searchQuery, setSearchQuery] = useState("")
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false)

  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const setScrollToSessionId = useAgentStore((s) => s.setScrollToSessionId)
  const setSessionSnoozed = useAgentStore((s) => s.setSessionSnoozed)
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  const navigate = useNavigate()

  const { data, refetch } = useQuery<AgentSessionsResponse>({
    queryKey: ["agentSessions"],
    queryFn: async () => {
      return await tipcClient.getAgentSessions()
    },
  })

  // Fetch unified conversation history (includes external sessions from Augment/Claude Code)
  const unifiedHistoryQuery = useUnifiedConversationHistoryQuery(200)
  const deleteConversationMutation = useDeleteConversationMutation()
  const deleteAllConversationsMutation = useDeleteAllConversationsMutation()

  // Get filtered past sessions (for total count)
  const filteredPastSessions = useMemo(() => {
    if (!unifiedHistoryQuery.data) return []
    return searchQuery.trim()
      ? unifiedHistoryQuery.data.filter(
          (session) =>
            session.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            session.preview.toLowerCase().includes(searchQuery.toLowerCase()) ||
            session.workspacePath?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : unifiedHistoryQuery.data
  }, [unifiedHistoryQuery.data, searchQuery])

  // Get visible past sessions with lazy loading
  const visiblePastSessions = useMemo(() => {
    return filteredPastSessions.slice(0, pastSessionsCount)
  }, [filteredPastSessions, pastSessionsCount])

  const hasMorePastSessions = filteredPastSessions.length > pastSessionsCount

  useEffect(() => {
    const unlisten = rendererHandlers.agentSessionsUpdated.listen((updatedData) => {
      refetch()
    })
    return unlisten
  }, [refetch])

  const activeSessions = data?.activeSessions || []
  const recentSessions = data?.recentSessions || []
  const hasActiveSessions = activeSessions.length > 0
  const hasRecentSessions = recentSessions.length > 0
  const hasAnySessions = hasActiveSessions || hasRecentSessions

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

  // Persist past sessions expanded state
  useEffect(() => {
    try {
      localStorage.setItem(PAST_SESSIONS_STORAGE_KEY, String(isPastSessionsExpanded))
    } catch (e) {
      console.error("Failed to save past sessions expanded state:", e)
    }
  }, [isPastSessionsExpanded])

  // Log when sessions change
  useEffect(() => {
    logUI('[ActiveAgentsSidebar] Sessions updated:', {
      count: activeSessions.length,
      sessions: activeSessions.map(s => ({ id: s.id, title: s.conversationTitle, snoozed: s.isSnoozed }))
    })
  }, [activeSessions.length])

  const handleSessionClick = (sessionId: string) => {
    logUI('[ActiveAgentsSidebar] Session clicked:', sessionId)
    // Navigate to sessions page and focus this session
    navigate('/')
    setFocusedSessionId(sessionId)
    // Trigger scroll to the session tile
    setScrollToSessionId(sessionId)
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

    if (isSnoozed) {
      // Unsnoozing: restore the session to foreground
      logUI('[ActiveAgentsSidebar] Unsnoozing session')

      // Update local store first so panel shows content immediately
      setSessionSnoozed(sessionId, false)

      // Focus the session
      setFocusedSessionId(sessionId)

      try {
        // Unsnooze the session in backend
        await tipcClient.unsnoozeAgentSession({ sessionId })
      } catch (error) {
        // Rollback local state only when the API call fails to keep UI and backend in sync
        setSessionSnoozed(sessionId, true)
        setFocusedSessionId(null)
        console.error("Failed to unsnooze session:", error)
        return
      }

      // UI updates after successful API call - don't rollback if these fail
      try {
        // Ensure the panel's own ConversationContext focuses the same session
        await tipcClient.focusAgentSession({ sessionId })

        // Resize to agent mode BEFORE showing the panel to avoid flashing to small size
        await tipcClient.setPanelMode({ mode: "agent" })

        // Show the panel (it's already sized correctly)
        await tipcClient.showPanelWindow({})

        logUI('[ActiveAgentsSidebar] Session unsnoozed, focused, panel shown and resized')
      } catch (error) {
        // Log UI errors but don't rollback - the backend state is already updated
        console.error("Failed to update UI after unsnooze:", error)
      }
    } else {
      // Snoozing: move session to background
      logUI('[ActiveAgentsSidebar] Snoozing session')
      // Update local store first
      setSessionSnoozed(sessionId, true)

      try {
        await tipcClient.snoozeAgentSession({ sessionId })
      } catch (error) {
        // Rollback local state only when the API call fails to keep UI and backend in sync
        setSessionSnoozed(sessionId, false)
        console.error("Failed to snooze session:", error)
        return
      }

      // UI updates after successful API call - don't rollback if these fail
      try {
        // Unfocus if this was the focused session
        if (focusedSessionId === sessionId) {
          setFocusedSessionId(null)
        }
        // Hide the panel window
        await tipcClient.hidePanelWindow({})
        logUI('[ActiveAgentsSidebar] Session snoozed, unfocused, and panel hidden')
      } catch (error) {
        // Log UI errors but don't rollback - the backend state is already updated
        console.error("Failed to update UI after snooze:", error)
      }
    }
  }

  const handleToggleExpand = () => {
    const newState = !isExpanded
    logExpand("ActiveAgentsSidebar", "toggle", { from: isExpanded, to: newState, source: "user" })
    setIsExpanded(newState)
  }

  const handleHeaderClick = () => {
    // Navigate to sessions view
    logUI('[ActiveAgentsSidebar] Header clicked, navigating to sessions')
    navigate('/')
    // Expand the list if not already expanded
    if (!isExpanded) {
      setIsExpanded(true)
    }
  }

  // Past sessions handlers
  const handlePastSessionClick = async (session: UnifiedConversationHistoryItem) => {
    logUI('[ActiveAgentsSidebar] Past session clicked:', session.id, 'source:', session.source)

    if (session.source === 'acp-remote') {
      // Native session - navigate to it
      navigate(`/${session.id}`)
    } else {
      // External session (Augment or Claude Code) - continue it
      try {
        toast.info(`Continuing ${session.source === 'augment' ? 'Augment' : 'Claude Code'} session...`)
        const result = await tipcClient.continueExternalSession({
          sessionId: session.id,
          source: session.source,
          workspacePath: session.workspacePath,
        })
        if (result.success) {
          toast.success(`Session continued in ${session.workspacePath || 'workspace'}`)
        } else {
          toast.error(result.error || 'Failed to continue session')
        }
      } catch (error) {
        console.error("Failed to continue external session:", error)
        toast.error("Failed to continue session")
      }
    }
  }

  const handleDeletePastSession = async (session: UnifiedConversationHistoryItem, e: React.MouseEvent) => {
    e.stopPropagation()
    // Only allow deleting native sessions
    if (session.source !== 'acp-remote') {
      toast.info("External sessions can only be deleted in their source application")
      return
    }
    try {
      await deleteConversationMutation.mutateAsync(session.id)
    } catch (error) {
      console.error("Failed to delete session:", error)
      toast.error("Failed to delete session")
    }
  }

  const handleLoadMorePastSessions = () => {
    setPastSessionsCount(prev => prev + INITIAL_PAST_SESSIONS)
  }

  const handleOpenHistoryFolder = async () => {
    try {
      await tipcClient.openConversationsFolder()
      toast.success("History folder opened")
    } catch (error) {
      toast.error("Failed to open history folder")
    }
  }

  const handleDeleteAllHistory = async () => {
    try {
      await deleteAllConversationsMutation.mutateAsync()
      toast.success("All history deleted")
      setShowDeleteAllDialog(false)
    } catch (error) {
      toast.error("Failed to delete history")
    }
  }

  // Format timestamp for display - use abbreviated relative time for recent, absolute for older
  const formatTimestamp = (timestamp: number): string => {
    const now = dayjs()
    const date = dayjs(timestamp)
    // Clamp to 0 to handle clock skew (when timestamp is slightly in the future)
    const diffSeconds = Math.max(0, now.diff(date, 'second'))
    const diffMinutes = Math.max(0, now.diff(date, 'minute'))
    const diffHours = Math.max(0, now.diff(date, 'hour'))

    if (diffHours < 24) {
      // Within 24 hours - show abbreviated relative time
      if (diffSeconds < 60) {
        return `${diffSeconds}s`
      } else if (diffMinutes < 60) {
        return `${diffMinutes}m`
      } else {
        return `${diffHours}h`
      }
    } else if (diffHours < 168) {
      // Within a week - show day and time
      return date.format("ddd h:mm A")
    } else {
      // Older - show date
      return date.format("MMM D")
    }
  }

  return (
    <div className="px-2 pb-2">
      <div
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-all duration-200",
          "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <button
          onClick={handleToggleExpand}
          className="shrink-0 cursor-pointer hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring rounded"
          aria-label={isExpanded ? "Collapse sessions" : "Expand sessions"}
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={handleHeaderClick}
          className="flex items-center gap-2 flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-ring rounded"
        >
          <span className="i-mingcute-grid-line h-3.5 w-3.5"></span>
          <span>Sessions</span>
          {activeSessions.length > 0 && (
            <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold text-white">
              {activeSessions.length}
            </span>
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-1 space-y-0.5 pl-2">
          {activeSessions.map((session) => {
            const isFocused = focusedSessionId === session.id
            const sessionProgress = agentProgressById.get(session.id)
            const hasPendingApproval = !!sessionProgress?.pendingToolApproval
            // Status colors: amber for pending approval, blue for active, gray for snoozed
            const statusDotColor = hasPendingApproval
              ? "bg-amber-500"
              : session.isSnoozed
              ? "bg-muted-foreground"
              : "bg-blue-500"
            return (
              <div
                key={session.id}
                onClick={() => handleSessionClick(session.id)}
                className={cn(
                  "group relative cursor-pointer rounded px-1.5 py-1 text-xs transition-all flex items-center gap-1.5",
                  hasPendingApproval
                    ? "bg-amber-500/10"
                    : isFocused
                    ? "bg-blue-500/10"
                    : "hover:bg-accent/50"
                )}
              >
                {/* Status dot */}
                <span className={cn(
                  "shrink-0 h-1.5 w-1.5 rounded-full",
                  statusDotColor,
                  !session.isSnoozed && !hasPendingApproval && "animate-pulse"
                )} />
                <p className={cn(
                  "flex-1 truncate",
                  hasPendingApproval ? "text-amber-700 dark:text-amber-300" :
                  session.isSnoozed ? "text-muted-foreground" : "text-foreground"
                )}>
                  {hasPendingApproval ? `⚠ ${session.conversationTitle}` : session.conversationTitle}
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
            )
          })}
        </div>
      )}

      {isExpanded && hasRecentSessions && (
        <div className="mt-1 space-y-0.5 pl-2">
          {recentSessions.map((session) => {
            // Status colors: red for error/stopped, gray for completed
            const statusDotColor = session.status === "error" || session.status === "stopped"
              ? "bg-red-500"
              : "bg-muted-foreground"
            return (
              <div
                key={session.id}
                onClick={() => {
                  if (session.conversationId) {
                    logUI('[ActiveAgentsSidebar] Navigating to sessions view for completed session:', session.conversationId)
                    // Navigate to sessions page with the conversation ID - will show in Past Sessions
                    navigate(`/${session.conversationId}`)
                  }
                }}
                className={cn(
                  "rounded px-1.5 py-1 text-xs text-muted-foreground transition-all flex items-center gap-1.5",
                  session.conversationId && "cursor-pointer hover:bg-accent/50"
                )}
              >
                {/* Status dot */}
                <span className={cn("shrink-0 h-1.5 w-1.5 rounded-full", statusDotColor)} />
                <p className="flex-1 truncate">{session.conversationTitle}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Past Sessions Section */}
      <div className="mt-3 pt-2">
        <div
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-all duration-200",
            "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          <button
            onClick={() => setIsPastSessionsExpanded(!isPastSessionsExpanded)}
            className="shrink-0 cursor-pointer hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring rounded"
            aria-label={isPastSessionsExpanded ? "Collapse past sessions" : "Expand past sessions"}
            aria-expanded={isPastSessionsExpanded}
          >
            {isPastSessionsExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setIsPastSessionsExpanded(!isPastSessionsExpanded)}
            className="flex items-center gap-2 flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-ring rounded"
            title="Past Sessions"
            aria-label={unifiedHistoryQuery.data && unifiedHistoryQuery.data.length > 0
              ? `Past Sessions (${unifiedHistoryQuery.data.length})`
              : "Past Sessions"}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Past</span>
            {unifiedHistoryQuery.data && unifiedHistoryQuery.data.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {unifiedHistoryQuery.data.length}
              </span>
            )}
          </button>
          {isPastSessionsExpanded && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={handleOpenHistoryFolder}
                className="p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                title="Open history folder"
              >
                <FolderOpen className="h-3 w-3" />
              </button>
              <button
                onClick={() => setShowDeleteAllDialog(true)}
                className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                title="Delete all history"
                disabled={!unifiedHistoryQuery.data?.length}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {isPastSessionsExpanded && (
          <div className="mt-1 space-y-0.5 pl-2">
            <div className="px-2 pb-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="h-7 pl-7 text-xs"
                />
              </div>
            </div>
            {unifiedHistoryQuery.isLoading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading sessions...</span>
              </div>
            ) : unifiedHistoryQuery.isError ? (
              <p className="px-2 py-2 text-xs text-destructive">Failed to load sessions</p>
            ) : visiblePastSessions.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No past sessions</p>
            ) : (
              <>
                {visiblePastSessions.map((session) => (
                  <div
                    key={`${session.source}-${session.id}`}
                    onClick={() => handlePastSessionClick(session)}
                    className={cn(
                      "group relative cursor-pointer rounded-md px-2 py-1.5 text-xs transition-all",
                      "hover:bg-accent/50"
                    )}
                    title={`${session.preview}\n${session.workspacePath ? `Workspace: ${session.workspacePath}\n` : ''}${dayjs(session.updatedAt).format("MMM D, h:mm A")}`}
                  >
                    <div className="flex items-center gap-1.5">
                      {/* Source badge */}
                      {session.source === 'augment' ? (
                        <span className="shrink-0 h-3 w-3 rounded text-[8px] font-bold flex items-center justify-center bg-purple-500/20 text-purple-400" title="Augment">A</span>
                      ) : session.source === 'claude-code' ? (
                        <span className="shrink-0 h-3 w-3 rounded text-[8px] font-bold flex items-center justify-center bg-orange-500/20 text-orange-400" title="Claude Code">C</span>
                      ) : (
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <p className="flex-1 truncate text-foreground">{session.title}</p>
                      {/* Time ago shown by default, replaced by delete button on hover */}
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums group-hover:hidden">
                        {formatTimestamp(session.updatedAt)}
                      </span>
                      {/* Only show delete button for native sessions */}
                      {session.source === 'acp-remote' && (
                        <button
                          onClick={(e) => handleDeletePastSession(session, e)}
                          disabled={deleteConversationMutation.isPending}
                          className={cn(
                            "shrink-0 rounded p-0.5 hidden transition-all hover:bg-destructive/20 hover:text-destructive group-hover:block"
                          )}
                          title="Delete session"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {hasMorePastSessions && (
                  <button
                    onClick={handleLoadMorePastSessions}
                    className="w-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md transition-colors"
                  >
                    Load more ({filteredPastSessions.length - pastSessionsCount} remaining)
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Delete All Confirmation Dialog */}
      <Dialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete All History
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all conversation history? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteAllDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAllHistory}
              disabled={deleteAllConversationsMutation.isPending}
            >
              {deleteAllConversationsMutation.isPending ? "Deleting..." : "Delete All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

