import React, { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useQueryClient, useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useAgentStore } from "@renderer/stores"
import { SessionGrid, SessionTileWrapper } from "@renderer/components/session-grid"
import { clearPersistedSize } from "@renderer/hooks/use-resizable"
import { AgentProgress } from "@renderer/components/agent-progress"
import { MessageCircle, Mic, Plus, CheckCircle2, LayoutGrid, Kanban, Keyboard } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { AgentProgressUpdate } from "@shared/types"
import { cn } from "@renderer/lib/utils"
import { toast } from "sonner"
import { SessionsKanban } from "@renderer/components/sessions-kanban"
import { PredefinedPromptsMenu } from "@renderer/components/predefined-prompts-menu"
import { useConfigQuery } from "@renderer/lib/query-client"
import { getMcpToolsShortcutDisplay, getTextInputShortcutDisplay, getDictationShortcutDisplay } from "@shared/key-utils"

function EmptyState({ onTextClick, onVoiceClick, onSelectPrompt, textInputShortcut, voiceInputShortcut, dictationShortcut }: {
  onTextClick: () => void
  onVoiceClick: () => void
  onSelectPrompt: (content: string) => void
  textInputShortcut: string
  voiceInputShortcut: string
  dictationShortcut: string
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <MessageCircle className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No Active Sessions</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        Start a new agent session using text or voice input. Your sessions will appear here as tiles.
      </p>
      <div className="flex flex-col items-center gap-4">
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
        {/* Keybind hints - hidden on narrow screens */}
        <div className="hidden md:flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" />
            <span>Text:</span>
            <kbd className="px-2 py-0.5 text-xs font-semibold bg-muted border rounded">
              {textInputShortcut}
            </kbd>
          </div>
          <div className="flex items-center gap-2">
            <span>Voice:</span>
            <kbd className="px-2 py-0.5 text-xs font-semibold bg-muted border rounded">
              {voiceInputShortcut}
            </kbd>
          </div>
          <div className="flex items-center gap-2">
            <span>Dictation:</span>
            <kbd className="px-2 py-0.5 text-xs font-semibold bg-muted border rounded">
              {dictationShortcut}
            </kbd>
          </div>
        </div>
      </div>
    </div>
  )
}

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

  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)

  // Get config for shortcut displays
  const configQuery = useConfigQuery()
  const textInputShortcut = getTextInputShortcutDisplay(configQuery.data?.textInputShortcut, configQuery.data?.customTextInputShortcut)
  const voiceInputShortcut = getMcpToolsShortcutDisplay(configQuery.data?.mcpToolsShortcut, configQuery.data?.customMcpToolsShortcut)
  const dictationShortcut = getDictationShortcutDisplay(configQuery.data?.shortcut, configQuery.data?.customShortcut)

  const [sessionOrder, setSessionOrder] = useState<string[]>([])
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null)
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null)
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>({})
  const [tileResetKey, setTileResetKey] = useState(0)

  const sessionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const handleCollapsedChange = useCallback((sessionId: string, collapsed: boolean) => {
    setCollapsedSessions(prev => ({
      ...prev,
      [sessionId]: collapsed
    }))
  }, [])

  /**
   * Returns the timestamp of the most recent activity in a session.
   * Used to sort sessions by last modified time on initial load.
   */
  const getLastActivityTimestamp = useCallback((progress: AgentProgressUpdate | null | undefined): number => {
    if (!progress) return 0
    const lastStepTimestamp = progress.steps?.length > 0
      ? progress.steps[progress.steps.length - 1].timestamp
      : 0
    const history = progress.conversationHistory
    const lastHistoryTimestamp = history && history.length > 0
      ? (history[history.length - 1].timestamp ?? 0)
      : 0
    return Math.max(lastStepTimestamp, lastHistoryTimestamp)
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
          // Both are new - sort by last activity (newest first)
          return getLastActivityTimestamp(b[1]) - getLastActivityTimestamp(a[1])
        }
        if (aIndex === -1) return -1  // a is new, put it first
        if (bIndex === -1) return 1   // b is new, put it first
        return aIndex - bIndex
      })
    }

    // Default sort: active sessions first, then by last activity (newest first)
    return entries.sort((a, b) => {
      const aComplete = a[1]?.isComplete ?? false
      const bComplete = b[1]?.isComplete ?? false
      if (aComplete !== bComplete) return aComplete ? 1 : -1
      return getLastActivityTimestamp(b[1]) - getLastActivityTimestamp(a[1])
    })
  }, [agentProgressById, sessionOrder, getLastActivityTimestamp])

  // Sync session order when new sessions appear
  useEffect(() => {
    const currentIds = Array.from(agentProgressById.keys())
    const newIds = currentIds.filter(id => !sessionOrder.includes(id))

    if (newIds.length > 0) {
      const isInitialLoad = sessionOrder.length === 0

      // On initial load, sort sessions by most recently modified first so the
      // freshest sessions appear at the top of the list.
      // When a new session is added during an active view, it still goes to the front.
      const sortedNewIds = isInitialLoad
        ? [...newIds].sort((a, b) =>
            getLastActivityTimestamp(agentProgressById.get(b)) -
            getLastActivityTimestamp(agentProgressById.get(a))
          )
        : newIds

      // Add (sorted) new sessions to the beginning of the order
      setSessionOrder(prev => [...sortedNewIds, ...prev.filter(id => currentIds.includes(id))])
    } else {
      // Remove sessions that no longer exist
      const validOrder = sessionOrder.filter(id => currentIds.includes(id))
      if (validOrder.length !== sessionOrder.length) {
        setSessionOrder(validOrder)
      }
    }
  }, [agentProgressById, getLastActivityTimestamp])

  // State for pending conversation continuation (user selected a conversation to continue)
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null)

  // Handle route parameter for deep-linking to specific session
  // When navigating to /:id, focus the active session tile or create a new tile for past sessions
  useEffect(() => {
    if (routeHistoryItemId) {
      // Check if this ID matches an active (non-complete) session - if so, focus it.
      // Completed sessions should reload from disk to ensure fresh data,
      // especially for sessions created remotely (e.g. from mobile) where
      // in-memory progress data may be stale or incomplete.
      const activeSession = Array.from(agentProgressById.entries()).find(
        ([_, progress]) => progress?.conversationId === routeHistoryItemId && !progress?.isComplete
      )
      if (activeSession) {
        setFocusedSessionId(activeSession[0])
        // Scroll to the session tile
        setTimeout(() => {
          sessionRefs.current[activeSession[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
      } else {
        // It's a past session or completed session - load fresh data from disk
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
      ([_, progress]) => progress?.conversationId === conversationId && !progress?.isComplete
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

    // Check if any active (non-complete) real session exists for this conversationId.
    // Completed sessions should not dismiss the pending tile because we want to
    // reload completed history from disk for freshness and remote-sync correctness.
    const hasRealSession = Array.from(agentProgressById.entries()).some(
      ([sessionId, progress]) =>
        !sessionId.startsWith("pending-") &&
        progress?.conversationId === pendingConversationId &&
        !progress?.isComplete
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

  const handleClearInactiveSessions = async () => {
    try {
      await tipcClient.clearInactiveSessions()
      toast.success("Inactive sessions cleared")
    } catch (error) {
      toast.error("Failed to clear inactive sessions")
    }
  }

  const handleResetTileLayout = useCallback(() => {
    clearPersistedSize("session-tile")
    setTileResetKey(prev => prev + 1)
    toast.success("Tile sizes reset to default")
  }, [])

  const handleCollapseExpanded = useCallback(() => {
    setExpandedSessionId(null)
  }, [])

  // Count inactive (completed) sessions
  const inactiveSessionCount = useMemo(() => {
    return allProgressEntries.filter(([_, progress]) => progress?.isComplete).length
  }, [allProgressEntries])

  // Check if expanded session is a regular session or a pending session
  const expandedProgress = expandedSessionId
    ? (agentProgressById.get(expandedSessionId) || (expandedSessionId === pendingSessionId ? pendingProgress : null))
    : null
  const isExpandedPending = expandedSessionId === pendingSessionId

  // If a session is expanded, show the expanded view
  if (expandedSessionId && expandedProgress) {
    const isCollapsed = collapsedSessions[expandedSessionId] ?? false
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 p-4">
          <div className="h-full">
            <AgentProgress
              progress={expandedProgress}
              variant="tile"
              isExpanded={true}
              isFocused={true}
              onFocus={() => {}}
              onDismiss={async () => {
                if (isExpandedPending) {
                  handleDismissPendingContinuation()
                } else {
                  await handleDismissSession(expandedSessionId)
                }
                setExpandedSessionId(null)
              }}
              isCollapsed={isCollapsed}
              onCollapsedChange={(collapsed) => handleCollapsedChange(expandedSessionId, collapsed)}
              onExpand={handleCollapseExpanded}
            />
          </div>
        </div>
      </div>
    )
  }

  const hasSessions = allProgressEntries.length > 0 || !!pendingProgress

  return (
    <div className="group/tile flex h-full flex-col">
      {/* Header with start buttons - outside the scroll area so its height is excluded
          when SessionGrid measures the parent to size tiles. */}
      {hasSessions && (
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between bg-muted/20 border-b">
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
                onClick={() => {
                  if (viewMode === "grid") {
                    // Already in grid view - reset tile layout
                    handleResetTileLayout()
                  } else {
                    setViewMode("grid")
                  }
                }}
                className="rounded-none h-7 px-2"
                title={viewMode === "grid" ? "Reset tile sizes to default" : "Grid view"}
                aria-label={viewMode === "grid" ? "Reset tile layout" : "Grid view"}
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
            {inactiveSessionCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearInactiveSessions}
                className="h-7 px-2 text-muted-foreground hover:text-foreground"
                title={`Clear ${inactiveSessionCount} completed sessions (conversations are saved to history)`}
                aria-label={`Clear ${inactiveSessionCount} completed sessions`}
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Scrollable content area - flex-1 min-h-0 so it fills remaining height without overflow */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide-until-hover">
        {/* Show empty state when no sessions and no pending */}
        {!hasSessions ? (
          <EmptyState
            onTextClick={handleTextClick}
            onVoiceClick={handleVoiceStart}
            onSelectPrompt={handleSelectPrompt}
            textInputShortcut={textInputShortcut}
            voiceInputShortcut={voiceInputShortcut}
            dictationShortcut={dictationShortcut}
          />
        ) : (
          /* Active sessions - grid or kanban view */
          viewMode === "kanban" ? (
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
                  isCollapsed={collapsedSessions[pendingSessionId] ?? false}
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
                    isCollapsed={collapsedSessions[pendingSessionId] ?? false}
                    onCollapsedChange={(collapsed) => handleCollapsedChange(pendingSessionId, collapsed)}
                    onExpand={() => setExpandedSessionId(pendingSessionId)}
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
                        onExpand={() => setExpandedSessionId(sessionId)}
                      />
                    </SessionTileWrapper>
                  </div>
                )
              })}
            </SessionGrid>
          )
        )}
      </div>
    </div>
  )
}
