import React, { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { ChevronDown, ChevronRight, X, Minimize2, Maximize2, CheckCircle2, Trash2, Clock, Loader2, Search, FolderOpen, AlertTriangle, Plus, Hash, MoreHorizontal, Pencil, FolderInput } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useAgentStore } from "@renderer/stores"
import { logUI, logStateChange, logExpand } from "@renderer/lib/debug"
import { useNavigate } from "react-router-dom"
import {
  useConversationHistoryQuery,
  useDeleteConversationMutation,
  useDeleteAllConversationsMutation,
  useChatGroupsQuery,
  useCreateChatGroupMutation,
  useUpdateChatGroupMutation,
  useDeleteChatGroupMutation,
  useSetConversationGroupMutation,
} from "@renderer/lib/queries"
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@renderer/components/ui/dropdown-menu"
import { toast } from "sonner"
import { ConversationHistoryItem } from "@shared/types"
import type { ChatGroup } from "@speakmcp/shared"
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

const GROUP_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
]

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

  // Group management state
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0])
  const [editingGroup, setEditingGroup] = useState<ChatGroup | null>(null)
  const [editGroupName, setEditGroupName] = useState("")
  const [editGroupColor, setEditGroupColor] = useState("")
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('sidebar-collapsed-groups')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })

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

  // Fetch conversation history for past sessions
  const conversationHistoryQuery = useConversationHistoryQuery()
  const deleteConversationMutation = useDeleteConversationMutation()
  const deleteAllConversationsMutation = useDeleteAllConversationsMutation()

  // Group queries
  const chatGroupsQuery = useChatGroupsQuery()
  const createGroupMutation = useCreateChatGroupMutation()
  const updateGroupMutation = useUpdateChatGroupMutation()
  const deleteGroupMutation = useDeleteChatGroupMutation()
  const setConversationGroupMutation = useSetConversationGroupMutation()

  // Get filtered past sessions (for total count)
  const filteredPastSessions = useMemo(() => {
    if (!conversationHistoryQuery.data) return []
    return searchQuery.trim()
      ? conversationHistoryQuery.data.filter(
          (session) =>
            session.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            session.preview.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : conversationHistoryQuery.data
  }, [conversationHistoryQuery.data, searchQuery])

  // Group past sessions by groupId
  const groupedSessions = useMemo(() => {
    const groups = chatGroupsQuery.data || []
    const ungrouped: ConversationHistoryItem[] = []
    const byGroup = new Map<string, ConversationHistoryItem[]>()

    // Initialize all groups with empty arrays
    for (const group of groups) {
      byGroup.set(group.id, [])
    }

    for (const session of filteredPastSessions) {
      if (session.groupId && byGroup.has(session.groupId)) {
        byGroup.get(session.groupId)!.push(session)
      } else {
        ungrouped.push(session)
      }
    }

    return { groups, ungrouped, byGroup }
  }, [filteredPastSessions, chatGroupsQuery.data])

  // Get visible ungrouped sessions with lazy loading
  const visibleUngroupedSessions = useMemo(() => {
    return groupedSessions.ungrouped.slice(0, pastSessionsCount)
  }, [groupedSessions.ungrouped, pastSessionsCount])

  const hasMoreUngroupedSessions = groupedSessions.ungrouped.length > pastSessionsCount

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

  // Persist collapsed groups
  useEffect(() => {
    try {
      localStorage.setItem('sidebar-collapsed-groups', JSON.stringify([...collapsedGroups]))
    } catch (e) {
      console.error("Failed to save collapsed groups:", e)
    }
  }, [collapsedGroups])

  // Log when sessions change
  useEffect(() => {
    logUI('[ActiveAgentsSidebar] Sessions updated:', {
      count: activeSessions.length,
      sessions: activeSessions.map(s => ({ id: s.id, title: s.conversationTitle, snoozed: s.isSnoozed }))
    })
  }, [activeSessions.length])

  const handleSessionClick = (sessionId: string) => {
    logUI('[ActiveAgentsSidebar] Session clicked:', sessionId)
    navigate('/')
    setFocusedSessionId(sessionId)
    setScrollToSessionId(sessionId)
  }

  const handleStopSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    logUI('[ActiveAgentsSidebar] Stopping session:', sessionId)
    try {
      await tipcClient.stopAgentSession({ sessionId })
      if (focusedSessionId === sessionId) {
        setFocusedSessionId(null)
      }
    } catch (error) {
      console.error("Failed to stop session:", error)
    }
  }

  const handleToggleSnooze = async (sessionId: string, isSnoozed: boolean, e: React.MouseEvent) => {
    e.stopPropagation()
    logUI('[ActiveAgentsSidebar SIDEBAR] Minimize button clicked in SIDEBAR (not overlay):', {
      sessionId,
      sidebarSaysIsSnoozed: isSnoozed,
      action: isSnoozed ? 'unsnooze' : 'snooze',
      focusedSessionId,
      allSessions: activeSessions.map(s => ({ id: s.id, snoozed: s.isSnoozed }))
    })

    if (isSnoozed) {
      logUI('[ActiveAgentsSidebar] Unsnoozing session')
      setSessionSnoozed(sessionId, false)
      setFocusedSessionId(sessionId)

      try {
        await tipcClient.unsnoozeAgentSession({ sessionId })
      } catch (error) {
        setSessionSnoozed(sessionId, true)
        setFocusedSessionId(null)
        console.error("Failed to unsnooze session:", error)
        return
      }

      try {
        await tipcClient.focusAgentSession({ sessionId })
        await tipcClient.setPanelMode({ mode: "agent" })
        await tipcClient.showPanelWindow({})
        logUI('[ActiveAgentsSidebar] Session unsnoozed, focused, panel shown and resized')
      } catch (error) {
        console.error("Failed to update UI after unsnooze:", error)
      }
    } else {
      logUI('[ActiveAgentsSidebar] Snoozing session')
      setSessionSnoozed(sessionId, true)

      try {
        await tipcClient.snoozeAgentSession({ sessionId })
      } catch (error) {
        setSessionSnoozed(sessionId, false)
        console.error("Failed to snooze session:", error)
        return
      }

      try {
        if (focusedSessionId === sessionId) {
          setFocusedSessionId(null)
        }
        await tipcClient.hidePanelWindow({})
        logUI('[ActiveAgentsSidebar] Session snoozed, unfocused, and panel hidden')
      } catch (error) {
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
    logUI('[ActiveAgentsSidebar] Header clicked, navigating to sessions')
    navigate('/')
    if (!isExpanded) {
      setIsExpanded(true)
    }
  }

  const handlePastSessionClick = (conversationId: string) => {
    logUI('[ActiveAgentsSidebar] Past session clicked:', conversationId)
    navigate(`/${conversationId}`)
  }

  const handleDeletePastSession = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await deleteConversationMutation.mutateAsync(conversationId)
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

  // Group handlers
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return
    try {
      await createGroupMutation.mutateAsync({ name: newGroupName.trim(), color: newGroupColor })
      setNewGroupName("")
      setNewGroupColor(GROUP_COLORS[0])
      setShowCreateGroupDialog(false)
      toast.success("Group created")
    } catch (error) {
      toast.error("Failed to create group")
    }
  }

  const handleUpdateGroup = async () => {
    if (!editingGroup || !editGroupName.trim()) return
    try {
      await updateGroupMutation.mutateAsync({
        groupId: editingGroup.id,
        name: editGroupName.trim(),
        color: editGroupColor,
      })
      setEditingGroup(null)
      toast.success("Group updated")
    } catch (error) {
      toast.error("Failed to update group")
    }
  }

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await deleteGroupMutation.mutateAsync(groupId)
      toast.success("Group deleted")
    } catch (error) {
      toast.error("Failed to delete group")
    }
  }

  const handleMoveToGroup = async (conversationId: string, groupId: string | undefined) => {
    try {
      await setConversationGroupMutation.mutateAsync({ conversationId, groupId })
    } catch (error) {
      toast.error("Failed to move session")
    }
  }

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  // Format timestamp for display
  const formatTimestamp = (timestamp: number): string => {
    const now = dayjs()
    const date = dayjs(timestamp)
    const diffSeconds = Math.max(0, now.diff(date, 'second'))
    const diffMinutes = Math.max(0, now.diff(date, 'minute'))
    const diffHours = Math.max(0, now.diff(date, 'hour'))

    if (diffHours < 24) {
      if (diffSeconds < 60) {
        return `${diffSeconds}s`
      } else if (diffMinutes < 60) {
        return `${diffMinutes}m`
      } else {
        return `${diffHours}h`
      }
    } else if (diffHours < 168) {
      return date.format("ddd h:mm A")
    } else {
      return date.format("MMM D")
    }
  }

  // Reusable past session row
  const PastSessionRow = ({ session }: { session: ConversationHistoryItem }) => {
    const groups = chatGroupsQuery.data || []
    return (
      <div
        onClick={() => handlePastSessionClick(session.id)}
        className={cn(
          "group/item relative cursor-pointer rounded-md px-2 py-1.5 text-xs transition-all",
          "hover:bg-accent/50"
        )}
        title={`${session.preview}\n${dayjs(session.updatedAt).format("MMM D, h:mm A")}`}
      >
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <p className="flex-1 truncate text-foreground">{session.title}</p>
          {/* Time ago shown by default, replaced by actions on hover */}
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums group-hover/item:hidden">
            {formatTimestamp(session.updatedAt)}
          </span>
          <div className="hidden items-center gap-0.5 group-hover/item:flex">
            {groups.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 rounded p-0.5 transition-all hover:bg-accent hover:text-foreground"
                    title="Move to group"
                  >
                    <FolderInput className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[140px]">
                  <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
                  {session.groupId && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        handleMoveToGroup(session.id, undefined)
                      }}
                      className="text-xs"
                    >
                      Ungrouped
                    </DropdownMenuItem>
                  )}
                  {groups.filter(g => g.id !== session.groupId).map((group) => (
                    <DropdownMenuItem
                      key={group.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleMoveToGroup(session.id, group.id)
                      }}
                      className="text-xs"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full mr-1.5 shrink-0"
                        style={{ backgroundColor: group.color || "#6b7280" }}
                      />
                      {group.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              onClick={(e) => handleDeletePastSession(session.id, e)}
              disabled={deleteConversationMutation.isPending}
              className="shrink-0 rounded p-0.5 transition-all hover:bg-destructive/20 hover:text-destructive"
              title="Delete session"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    )
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
            const statusDotColor = session.status === "error" || session.status === "stopped"
              ? "bg-red-500"
              : "bg-muted-foreground"
            return (
              <div
                key={session.id}
                onClick={() => {
                  if (session.conversationId) {
                    logUI('[ActiveAgentsSidebar] Navigating to sessions view for completed session:', session.conversationId)
                    navigate(`/${session.conversationId}`)
                  }
                }}
                className={cn(
                  "rounded px-1.5 py-1 text-xs text-muted-foreground transition-all flex items-center gap-1.5",
                  session.conversationId && "cursor-pointer hover:bg-accent/50"
                )}
              >
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
            aria-label={conversationHistoryQuery.data && conversationHistoryQuery.data.length > 0
              ? `Past Sessions (${conversationHistoryQuery.data.length})`
              : "Past Sessions"}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Past</span>
            {conversationHistoryQuery.data && conversationHistoryQuery.data.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {conversationHistoryQuery.data.length}
              </span>
            )}
          </button>
          {isPastSessionsExpanded && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setShowCreateGroupDialog(true)}
                className="p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                title="Create new group"
              >
                <Plus className="h-3 w-3" />
              </button>
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
                disabled={!conversationHistoryQuery.data?.length}
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
            {conversationHistoryQuery.isLoading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading sessions...</span>
              </div>
            ) : conversationHistoryQuery.isError ? (
              <p className="px-2 py-2 text-xs text-destructive">Failed to load sessions</p>
            ) : filteredPastSessions.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No past sessions</p>
            ) : (
              <>
                {/* Group sections */}
                {groupedSessions.groups.map((group) => {
                  const sessions = groupedSessions.byGroup.get(group.id) || []
                  const isCollapsed = collapsedGroups.has(group.id)
                  return (
                    <div key={group.id} className="mb-1">
                      {/* Group header */}
                      <div className="group/header flex items-center gap-1 px-1 py-1 rounded-md hover:bg-accent/30 transition-colors">
                        <button
                          onClick={() => toggleGroupCollapsed(group.id)}
                          className="shrink-0 flex items-center gap-1.5 flex-1 min-w-0 text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          )}
                          <Hash
                            className="h-3 w-3 shrink-0"
                            style={{ color: group.color || "#6b7280" }}
                          />
                          <span className="truncate">{group.name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {sessions.length}
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="shrink-0 rounded p-0.5 opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover/header:opacity-100"
                              title="Group options"
                            >
                              <MoreHorizontal className="h-3 w-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[120px]">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingGroup(group)
                                setEditGroupName(group.name)
                                setEditGroupColor(group.color || GROUP_COLORS[0])
                              }}
                              className="text-xs"
                            >
                              <Pencil className="h-3 w-3 mr-1.5" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDeleteGroup(group.id)}
                              className="text-xs text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3 w-3 mr-1.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {/* Group sessions */}
                      {!isCollapsed && (
                        <div className="pl-2">
                          {sessions.length === 0 ? (
                            <p className="px-2 py-1 text-[10px] text-muted-foreground italic">No sessions</p>
                          ) : (
                            sessions.map((session) => (
                              <PastSessionRow key={session.id} session={session} />
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Ungrouped sessions */}
                {visibleUngroupedSessions.map((session) => (
                  <PastSessionRow key={session.id} session={session} />
                ))}
                {hasMoreUngroupedSessions && (
                  <button
                    onClick={handleLoadMorePastSessions}
                    className="w-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md transition-colors"
                  >
                    Load more ({groupedSessions.ungrouped.length - pastSessionsCount} remaining)
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

      {/* Create Group Dialog */}
      <Dialog open={showCreateGroupDialog} onOpenChange={setShowCreateGroupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
            <DialogDescription>
              Create a new group to organize your conversations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="e.g. Work, Personal, Research..."
                className="mt-1"
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup() }}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <div className="flex gap-2 mt-1">
                {GROUP_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewGroupColor(color)}
                    className={cn(
                      "h-6 w-6 rounded-full transition-all",
                      newGroupColor === color && "ring-2 ring-offset-2 ring-offset-background ring-foreground"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateGroupDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateGroup}
              disabled={!newGroupName.trim() || createGroupMutation.isPending}
            >
              {createGroupMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={!!editingGroup} onOpenChange={(open) => { if (!open) setEditingGroup(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={editGroupName}
                onChange={(e) => setEditGroupName(e.target.value)}
                className="mt-1"
                onKeyDown={(e) => { if (e.key === "Enter") handleUpdateGroup() }}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <div className="flex gap-2 mt-1">
                {GROUP_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setEditGroupColor(color)}
                    className={cn(
                      "h-6 w-6 rounded-full transition-all",
                      editGroupColor === color && "ring-2 ring-offset-2 ring-offset-background ring-foreground"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGroup(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateGroup}
              disabled={!editGroupName.trim() || updateGroupMutation.isPending}
            >
              {updateGroupMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
