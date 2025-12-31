import React, { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useQueryClient, useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useAgentStore } from "@renderer/stores"
import { SessionGrid, SessionTileWrapper } from "@renderer/components/session-grid"
import { clearAllPersistedSizes } from "@renderer/hooks/use-resizable"
import { AgentProgress } from "@renderer/components/agent-progress"
import { MessageCircle, Mic, Plus, Calendar, Trash2, Search, ChevronDown, FolderOpen, CheckCircle2, LayoutGrid, Kanban, RotateCcw } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Card, CardContent } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { useConversationHistoryQuery, useDeleteConversationMutation, useDeleteAllConversationsMutation } from "@renderer/lib/queries"
import { ConversationHistoryItem, AgentProgressUpdate } from "@shared/types"
import { cn } from "@renderer/lib/utils"
import { toast } from "sonner"
import { SessionsKanban } from "@renderer/components/sessions-kanban"
import { SessionViewMode } from "@renderer/stores"
import dayjs from "dayjs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { PredefinedPromptsMenu } from "@renderer/components/predefined-prompts-menu"

function EmptyState({ onTextClick, onVoiceClick, onSelectPrompt }: { onTextClick: () => void; onVoiceClick: () => void; onSelectPrompt: (content: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <MessageCircle className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No Active Sessions</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        Start a new agent session using text or voice input. Your sessions will appear here as tiles.
      </p>
      <div className="flex gap-3 items-center">
        <Button onClick={onTextClick} className="gap-2">
          <Plus className="h-4 w-4" />
          Start with Text
        </Button>
        <Button variant="secondary" onClick={onVoiceClick} className="gap-2">
          <Mic className="h-4 w-4" />
          Start with Voice
        </Button>
        <PredefinedPromptsMenu
          onSelectPrompt={onSelectPrompt}
        />
      </div>
    </div>
  )
}

const INITIAL_PAST_SESSIONS = 10
const LOAD_MORE_INCREMENT = 10

export function Component() {
  const queryClient = useQueryClient()
  const { id: routeHistoryItemId } = useParams<{ id: string }>()
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const scrollToSessionId = useAgentStore((s) => s.scrollToSessionId)
  const setScrollToSessionId = useAgentStore((s) => s.setScrollToSessionId)
  const viewMode = useAgentStore((s) => s.viewMode)
  const setViewMode = useAgentStore((s) => s.setViewMode)

  const [sessionOrder, setSessionOrder] = useState<string[]>([])
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null)
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null)
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>({})
  const [pastSessionsExpanded, setPastSessionsExpanded] = useState(true)
  const [pastSessionsCount, setPastSessionsCount] = useState(INITIAL_PAST_SESSIONS)
  const [searchQuery, setSearchQuery] = useState("")
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false)
  const [tileResetKey, setTileResetKey] = useState(0)
  const deleteConversationMutation = useDeleteConversationMutation()
  const deleteAllConversationsMutation = useDeleteAllConversationsMutation()

  const sessionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const handleCollapsedChange = useCallback((sessionId: string, collapsed: boolean) => {
    setCollapsedSessions(prev => ({ ...prev, [sessionId]: collapsed }))
  }, [])

  const allProgressEntries = React.useMemo(() => {
    const entries = Array.from(agentProgressById.entries())
      .filter(([_, progress]) => progress !== null)

    if (sessionOrder.length > 0) {
      return entries.sort((a, b) => {
        const aIndex = sessionOrder.indexOf(a[0])
        const bIndex = sessionOrder.indexOf(b[0])
        // New sessions (not in order list) should appear first (at top)
        if (aIndex === -1 && bIndex === -1) {
          // Both are new - sort by timestamp (newest first)
          return (b[1]?.steps?.[0]?.timestamp ?? 0) - (a[1]?.steps?.[0]?.timestamp ?? 0)
        }
        if (aIndex === -1) return -1  // a is new, put it first
        if (bIndex === -1) return 1   // b is new, put it first
        return aIndex - bIndex
      })
    }

    // Default sort: active sessions first, then by start time (newest first)
    return entries.sort((a, b) => {
      const aComplete = a[1]?.isComplete ?? false
      const bComplete = b[1]?.isComplete ?? false
      if (aComplete !== bComplete) return aComplete ? 1 : -1
      return (b[1]?.steps?.[0]?.timestamp ?? 0) - (a[1]?.steps?.[0]?.timestamp ?? 0)
    })
  }, [agentProgressById, sessionOrder])

  // Sync session order when new sessions appear
  useEffect(() => {
    const currentIds = Array.from(agentProgressById.keys())
    const newIds = currentIds.filter(id => !sessionOrder.includes(id))

    if (newIds.length > 0) {
      // Add new sessions to the beginning of the order
      setSessionOrder(prev => [...newIds, ...prev.filter(id => currentIds.includes(id))])
    } else {
      // Remove sessions that no longer exist
      const validOrder = sessionOrder.filter(id => currentIds.includes(id))
      if (validOrder.length !== sessionOrder.length) {
        setSessionOrder(validOrder)
      }
    }
  }, [agentProgressById])

  // State for pending conversation continuation (user selected a conversation to continue)
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null)

  // Fetch all conversations from history
  const conversationHistoryQuery = useConversationHistoryQuery()

  // Filter and group past sessions for display
  const filteredHistory = useMemo(() => {
    if (!conversationHistoryQuery.data) return []
    return conversationHistoryQuery.data.filter(
      (historyItem) =>
        historyItem.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        historyItem.preview.toLowerCase().includes(searchQuery.toLowerCase()),
    )
  }, [conversationHistoryQuery.data, searchQuery])

  // Group history by date for display
  const groupedHistory = useMemo(() => {
    const groups = new Map<string, ConversationHistoryItem[]>()
    const today = dayjs().format("YYYY-MM-DD")
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD")

    // Take only the number we want to show (lazy loading)
    const visibleItems = filteredHistory.slice(0, pastSessionsCount)

    for (const historyItem of visibleItems) {
      const date = dayjs(historyItem.updatedAt).format("YYYY-MM-DD")
      let groupKey: string

      if (date === today) {
        groupKey = "Today"
      } else if (date === yesterday) {
        groupKey = "Yesterday"
      } else {
        groupKey = dayjs(historyItem.updatedAt).format("MMM D, YYYY")
      }

      const items = groups.get(groupKey) || []
      items.push(historyItem)
      groups.set(groupKey, items)
    }

    return Array.from(groups.entries()).map(([date, items]) => ({
      date,
      items: items.sort((a, b) => b.updatedAt - a.updatedAt),
    }))
  }, [filteredHistory, pastSessionsCount])

  // Check if there are more items to load
  const hasMorePastSessions = filteredHistory.length > pastSessionsCount

  // Handle route parameter for deep-linking to specific session
  // When navigating to /:id, focus the active session tile or create a new tile for past sessions
  useEffect(() => {
    if (routeHistoryItemId) {
      // Check if this ID matches an active session - if so, focus it
      const activeSession = Array.from(agentProgressById.entries()).find(
        ([_, progress]) => progress?.conversationId === routeHistoryItemId
      )
      if (activeSession) {
        setFocusedSessionId(activeSession[0])
        // Scroll to the session tile
        setTimeout(() => {
          sessionRefs.current[activeSession[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
      } else {
        // It's a past session - create a new tile by setting pendingConversationId
        setPendingConversationId(routeHistoryItemId)
      }
      // Clear the route param from URL without causing a remount
      // Using window.history.replaceState instead of navigate() to avoid clearing local state
      window.history.replaceState(null, "", "/")
    }
  }, [routeHistoryItemId, agentProgressById, setFocusedSessionId])

  // Handle scroll-to-session requests from sidebar navigation
  useEffect(() => {
    if (scrollToSessionId) {
      const targetSessionId = scrollToSessionId
      // Use a small delay to ensure the DOM has rendered the tile
      setTimeout(() => {
        sessionRefs.current[targetSessionId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // Clear the scroll request after attempting scroll to avoid race conditions
        setScrollToSessionId(null)
      }, 100)
    }
  }, [scrollToSessionId, setScrollToSessionId])

  // Load the pending conversation data when one is selected
  const pendingConversationQuery = useQuery({
    queryKey: ["conversation", pendingConversationId],
    queryFn: async () => {
      if (!pendingConversationId) return null
      return tipcClient.loadConversation({ conversationId: pendingConversationId })
    },
    enabled: !!pendingConversationId,
  })

  // Create a synthetic AgentProgressUpdate for the pending conversation
  // This allows us to reuse the AgentProgress component with the same UI
  const pendingSessionId = pendingConversationId ? `pending-${pendingConversationId}` : null
  const pendingProgress: AgentProgressUpdate | null = useMemo(() => {
    if (!pendingConversationId || !pendingConversationQuery.data) return null
    const conv = pendingConversationQuery.data
    return {
      sessionId: `pending-${pendingConversationId}`,
      conversationId: pendingConversationId,
      conversationTitle: conv.title || "Continue Conversation",
      currentIteration: 0,
      maxIterations: 10,
      steps: [],
      isComplete: true, // Mark as complete so it shows the follow-up input
      conversationHistory: conv.messages.map(m => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolResults: m.toolResults,
        timestamp: m.timestamp,
      })),
    }
  }, [pendingConversationId, pendingConversationQuery.data])

  // Handle continuing a conversation - check for existing active session first
  // If found, focus it; otherwise create a pending tile
  // LLM inference will only happen when user sends an actual message
  const handleContinueConversation = (conversationId: string) => {
    // Check if there's already an active session for this conversationId
    const existingSession = Array.from(agentProgressById.entries()).find(
      ([_, progress]) => progress?.conversationId === conversationId
    )
    if (existingSession) {
      // Focus the existing session tile instead of creating a duplicate
      setFocusedSessionId(existingSession[0])
      // Scroll to the session tile
      setTimeout(() => {
        sessionRefs.current[existingSession[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    } else {
      // No active session exists, create a pending tile
      setPendingConversationId(conversationId)
    }
  }

  // Handle dismissing the pending continuation
  const handleDismissPendingContinuation = () => {
    setPendingConversationId(null)
  }

  // Auto-dismiss pending tile when a real session starts for the same conversationId
  // This ensures smooth transition from "pending" state to "active" session
  useEffect(() => {
    if (!pendingConversationId) return

    // Check if any real session exists for this conversationId
    const hasRealSession = Array.from(agentProgressById.entries()).some(
      ([sessionId, progress]) =>
        !sessionId.startsWith("pending-") && progress?.conversationId === pendingConversationId
    )

    if (hasRealSession) {
      // A real session has started for this conversation, dismiss the pending tile
      setPendingConversationId(null)
    }
  }, [pendingConversationId, agentProgressById])

  // Handle text click - open panel with text input
  const handleTextClick = async () => {
    await tipcClient.showPanelWindowWithTextInput({})
  }

  // Handle voice start - trigger MCP recording
  const handleVoiceStart = async () => {
    await tipcClient.showPanelWindow({})
    await tipcClient.triggerMcpRecording({})
  }

  // Handle predefined prompt selection - open panel with text input pre-filled
  const handleSelectPrompt = async (content: string) => {
    await tipcClient.showPanelWindowWithTextInput({ initialText: content })
  }

  const handleFocusSession = async (sessionId: string) => {
    setFocusedSessionId(sessionId)
    // Also show the panel window with this session focused
    try {
      await tipcClient.focusAgentSession({ sessionId })
      await tipcClient.setPanelMode({ mode: "agent" })
      await tipcClient.showPanelWindow({})
    } catch (error) {
      console.error("Failed to show panel window:", error)
    }
  }

  const handleDismissSession = async (sessionId: string) => {
    await tipcClient.clearAgentSessionProgress({ sessionId })
    queryClient.invalidateQueries({ queryKey: ["agentSessions"] })
  }

  // Drag and drop handlers
  const handleDragStart = useCallback((sessionId: string, _index: number) => {
    setDraggedSessionId(sessionId)
  }, [])

  const handleDragOver = useCallback((targetIndex: number) => {
    setDragTargetIndex(targetIndex)
  }, [])

  const handleDragEnd = useCallback(() => {
    if (draggedSessionId && dragTargetIndex !== null) {
      // Reorder the sessions
      setSessionOrder(prev => {
        const currentOrder = prev.length > 0 ? prev : allProgressEntries.map(([id]) => id)
        const draggedIndex = currentOrder.indexOf(draggedSessionId)

        if (draggedIndex === -1 || draggedIndex === dragTargetIndex) {
          return currentOrder
        }

        const newOrder = [...currentOrder]
        newOrder.splice(draggedIndex, 1)
        newOrder.splice(dragTargetIndex, 0, draggedSessionId)
        return newOrder
      })
    }
    setDraggedSessionId(null)
    setDragTargetIndex(null)
  }, [draggedSessionId, dragTargetIndex, allProgressEntries])

  // Past sessions handlers
  const handleLoadMore = useCallback(() => {
    setPastSessionsCount(prev => prev + LOAD_MORE_INCREMENT)
  }, [])

  const handleDeleteHistoryItem = async (historyItemId: string) => {
    try {
      await deleteConversationMutation.mutateAsync(historyItemId)
      toast.success("Session deleted")
    } catch (error) {
      toast.error("Failed to delete session")
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

  const handleOpenHistoryFolder = async () => {
    try {
      await tipcClient.openConversationsFolder()
      toast.success("History folder opened")
    } catch (error) {
      toast.error("Failed to open history folder")
    }
  }

  const handleClearInactiveSessions = async () => {
    try {
      await tipcClient.clearInactiveSessions()
      toast.success("Inactive sessions cleared")
    } catch (error) {
      toast.error("Failed to clear inactive sessions")
    }
  }

  const handleResetTileLayout = useCallback(() => {
    clearAllPersistedSizes()
    setTileResetKey(prev => prev + 1)
    toast.success("Tile sizes reset to default")
  }, [])

  // Count inactive (completed) sessions
  const inactiveSessionCount = useMemo(() => {
    return allProgressEntries.filter(([_, progress]) => progress?.isComplete).length
  }, [allProgressEntries])

  return (
    <div className="group/tile flex h-full flex-col">
      {/* Main content area */}
      <div className="flex-1 overflow-y-auto scrollbar-hide-until-hover">
        {/* Show empty state when no sessions and no pending */}
        {allProgressEntries.length === 0 && !pendingProgress ? (
          <EmptyState onTextClick={handleTextClick} onVoiceClick={handleVoiceStart} onSelectPrompt={handleSelectPrompt} />
        ) : (
          <>
            {/* Header with start buttons, view toggle, and clear inactive button */}
            <div className="px-4 py-2 flex items-center justify-between bg-muted/20 border-b">
              <div className="flex gap-2 items-center">
                <Button size="sm" onClick={handleTextClick} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Start with Text
                </Button>
                <Button variant="secondary" size="sm" onClick={handleVoiceStart} className="gap-2">
                  <Mic className="h-4 w-4" />
                  Start with Voice
                </Button>
                <PredefinedPromptsMenu
                  onSelectPrompt={handleSelectPrompt}
                />
              </div>
              <div className="flex items-center gap-2">
                {/* View mode toggle */}
                <div className="flex border rounded-md overflow-hidden" role="group" aria-label="Session view mode">
                  <Button
                    variant={viewMode === "grid" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("grid")}
                    className="rounded-none h-7 px-2"
                    title="Grid view"
                    aria-label="Grid view"
                    aria-pressed={viewMode === "grid"}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === "kanban" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("kanban")}
                    className="rounded-none h-7 px-2"
                    title="Kanban view"
                    aria-label="Kanban view"
                    aria-pressed={viewMode === "kanban"}
                  >
                    <Kanban className="h-4 w-4" />
                  </Button>
                </div>
                {viewMode === "grid" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetTileLayout}
                    className="gap-2 text-muted-foreground hover:text-foreground"
                    title="Reset all tile sizes to default dimensions"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset Layout
                  </Button>
                )}
                {inactiveSessionCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearInactiveSessions}
                    className="gap-2 text-muted-foreground hover:text-foreground"
                    title="Clear all completed sessions from view (conversations are saved to history)"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Clear {inactiveSessionCount} completed
                  </Button>
                )}
              </div>
            </div>
            {/* Active sessions - grid or kanban view */}
            {viewMode === "kanban" ? (
              <SessionsKanban
                sessions={allProgressEntries}
                focusedSessionId={focusedSessionId}
                onFocusSession={handleFocusSession}
                onDismissSession={handleDismissSession}
                pendingProgress={pendingProgress}
                pendingSessionId={pendingSessionId}
                onDismissPendingContinuation={handleDismissPendingContinuation}
              />
            ) : (
              <SessionGrid sessionCount={allProgressEntries.length + (pendingProgress ? 1 : 0)} resetKey={tileResetKey}>
                {/* Pending continuation tile first */}
                {pendingProgress && pendingSessionId && (
                  <SessionTileWrapper
                    key={pendingSessionId}
                    sessionId={pendingSessionId}
                    index={0}
                    isCollapsed={false}
                    onDragStart={() => {}}
                    onDragOver={() => {}}
                    onDragEnd={() => {}}
                    isDragTarget={false}
                    isDragging={false}
                  >
                    <AgentProgress
                      progress={pendingProgress}
                      variant="tile"
                      isFocused={true}
                      onFocus={() => {}}
                      onDismiss={handleDismissPendingContinuation}
                      isCollapsed={false}
                      onCollapsedChange={() => {}}
                    />
                  </SessionTileWrapper>
                )}
                {/* Regular sessions */}
                {allProgressEntries.map(([sessionId, progress], index) => {
                  const isCollapsed = collapsedSessions[sessionId] ?? false
                  const adjustedIndex = pendingProgress ? index + 1 : index
                  return (
                    <div
                      key={sessionId}
                      ref={(el) => { sessionRefs.current[sessionId] = el }}
                    >
                      <SessionTileWrapper
                        sessionId={sessionId}
                        index={adjustedIndex}
                        isCollapsed={isCollapsed}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragEnd={handleDragEnd}
                        isDragTarget={dragTargetIndex === adjustedIndex && draggedSessionId !== sessionId}
                        isDragging={draggedSessionId === sessionId}
                      >
                        <AgentProgress
                          progress={progress}
                          variant="tile"
                          isFocused={focusedSessionId === sessionId}
                          onFocus={() => handleFocusSession(sessionId)}
                          onDismiss={() => handleDismissSession(sessionId)}
                          isCollapsed={isCollapsed}
                          onCollapsedChange={(collapsed) => handleCollapsedChange(sessionId, collapsed)}
                        />
                      </SessionTileWrapper>
                    </div>
                  )
                })}
              </SessionGrid>
            )}
          </>
        )}

        {/* Past Sessions Section - always shown with lazy loading */}
        <div className="border-t">
          <div className="px-4 py-3 flex items-center justify-between bg-muted/30">
            <button
              onClick={() => setPastSessionsExpanded(!pastSessionsExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", !pastSessionsExpanded && "-rotate-90")} />
              <Calendar className="h-4 w-4" />
              <span>Past Sessions</span>
              {conversationHistoryQuery.data && (
                <Badge variant="secondary" className="text-xs">
                  {conversationHistoryQuery.data.length}
                </Badge>
              )}
            </button>
            <div className="flex items-center gap-2">
              {pastSessionsExpanded && (
                <>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search..."
                      className="w-40 h-7 pl-7 text-xs"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenHistoryFolder}
                    className="h-7 w-7 p-0"
                    title="Open history folder"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteAllDialog(true)}
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                    title="Delete all history"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>

          {pastSessionsExpanded && (
            <div className="px-4 py-4">
              {groupedHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? "No matching sessions" : "No past sessions yet"}
                </div>
              ) : (
                <div className="space-y-6">
                  {groupedHistory.map(({ date, items }) => (
                    <div key={date}>
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {date}
                      </h4>
                      <div className="space-y-2">
                        {items.map((historyItem) => (
                          <PastSessionCard
                            key={historyItem.id}
                            conversation={historyItem}
                            onOpen={() => handleContinueConversation(historyItem.id)}
                            onDelete={() => handleDeleteHistoryItem(historyItem.id)}
                            isDeleting={deleteConversationMutation.isPending}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Load more button */}
                  {hasMorePastSessions && (
                    <div className="flex justify-center pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLoadMore}
                        className="gap-2"
                      >
                        <ChevronDown className="h-4 w-4" />
                        Load More ({filteredHistory.length - pastSessionsCount} remaining)
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete All Confirmation Dialog */}
      <Dialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete All History</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all session history? This action cannot be undone.
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

/** Card for a past session in the history list - clicking opens as a new tile */
interface PastSessionCardProps {
  conversation: ConversationHistoryItem
  onOpen: () => void
  onDelete: () => void
  isDeleting: boolean
}

function PastSessionCard({
  conversation,
  onOpen,
  onDelete,
  isDeleting,
}: PastSessionCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
      )}
      onClick={onOpen}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 truncate font-medium">{conversation.title}</h3>
            <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
              {conversation.preview}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="text-xs">
                {conversation.messageCount} messages
              </Badge>
              <span>•</span>
              <span>
                {dayjs(conversation.updatedAt).format("MMM D, h:mm A")}
              </span>
            </div>
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
              className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
              title="Delete session"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

