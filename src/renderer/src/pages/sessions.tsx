import React, { useEffect, useState, useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { useAgentStore } from "@renderer/stores"
import { SessionGrid, SessionTileWrapper } from "@renderer/components/session-grid"
import { AgentProgress } from "@renderer/components/agent-progress"
import { SessionInput } from "@renderer/components/session-input"
import { Settings, MessageCircle, Mic, Plus, Clock, ArrowRight } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { useConversationHistoryQuery } from "@renderer/lib/queries"
import { ConversationHistoryItem } from "@shared/types"
import { cn } from "@renderer/lib/utils"

function EmptyState({ onTextClick, onVoiceClick }: { onTextClick: () => void; onVoiceClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <MessageCircle className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No Active Sessions</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        Start a new agent session using text or voice input. Your sessions will appear here as tiles.
      </p>
      <div className="flex gap-3">
        <Button onClick={onTextClick} className="gap-2">
          <Plus className="h-4 w-4" />
          Start with Text
        </Button>
        <Button variant="secondary" onClick={onVoiceClick} className="gap-2">
          <Mic className="h-4 w-4" />
          Start with Voice
        </Button>
      </div>
    </div>
  )
}

/** Compact card for a recent conversation */
function RecentConversationCard({
  conversation,
  onContinue
}: {
  conversation: ConversationHistoryItem
  onContinue: (id: string) => void
}) {
  const timeAgo = getTimeAgo(conversation.updatedAt)

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border bg-card",
        "hover:bg-accent/50 cursor-pointer transition-colors group"
      )}
      onClick={() => onContinue(conversation.id)}
    >
      <div className="flex-shrink-0">
        <Clock className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{conversation.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {conversation.messageCount} messages · {timeAgo}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="opacity-0 group-hover:opacity-100 transition-opacity h-7 px-2"
        onClick={(e) => {
          e.stopPropagation()
          onContinue(conversation.id)
        }}
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

/** Format timestamp to relative time */
function getTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function Component() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)

  // Custom ordering state - persists session order across re-renders
  const [sessionOrder, setSessionOrder] = useState<string[]>([])

  // Text input visibility state - lifted up to allow EmptyState to trigger it
  const [showTextInput, setShowTextInput] = useState(false)

  // Drag state
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null)
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null)

  // Collapsed state per session
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>({})

  const handleCollapsedChange = useCallback((sessionId: string, collapsed: boolean) => {
    setCollapsedSessions(prev => ({ ...prev, [sessionId]: collapsed }))
  }, [])

  // Get all sessions from the progress store - this is the single source of truth
  const allProgressEntries = React.useMemo(() => {
    const entries = Array.from(agentProgressById.entries())
      .filter(([_, progress]) => progress !== null)

    // If we have a custom order, use it; otherwise sort by default
    if (sessionOrder.length > 0) {
      // Sort by custom order, putting unknown sessions at the end
      return entries.sort((a, b) => {
        const aIndex = sessionOrder.indexOf(a[0])
        const bIndex = sessionOrder.indexOf(b[0])
        // If not in order list, put at end
        if (aIndex === -1 && bIndex === -1) return 0
        if (aIndex === -1) return 1
        if (bIndex === -1) return -1
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

  // Create text input mutation
  const createTextMutation = useMutation({
    mutationFn: async (text: string) => {
      await tipcClient.createMcpTextInput({ text })
    },
  })

  // Fetch recent conversations from history
  const conversationHistoryQuery = useConversationHistoryQuery()
  const recentConversations = React.useMemo(() => {
    if (!conversationHistoryQuery.data) return []
    // Get top 3, excluding any that have active sessions
    const activeConversationIds = new Set(
      Array.from(agentProgressById.values())
        .filter(p => p !== null)
        .map(p => p?.conversationId)
        .filter(Boolean)
    )
    return conversationHistoryQuery.data
      .filter(c => !activeConversationIds.has(c.id))
      .slice(0, 3)
  }, [conversationHistoryQuery.data, agentProgressById])

  // Continue conversation mutation
  const continueConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      // Load the conversation to get the context, then start with a prompt
      const conversation = await tipcClient.loadConversation({ conversationId })
      if (!conversation) throw new Error("Conversation not found")

      // Start a new agent session that continues this conversation
      // The user can type in the tile input to send the actual message
      await tipcClient.createMcpTextInput({
        text: "(Continuing previous conversation...)",
        conversationId
      })
    },
  })

  // Handle continuing a conversation
  const handleContinueConversation = (conversationId: string) => {
    continueConversationMutation.mutate(conversationId)
  }

  // Handle text submit
  const handleTextSubmit = (text: string) => {
    createTextMutation.mutate(text)
  }

  // Handle voice start - trigger MCP recording
  const handleVoiceStart = async () => {
    await tipcClient.showPanelWindow({})
    await tipcClient.triggerMcpRecording({})
  }

  const handleFocusSession = (sessionId: string) => {
    setFocusedSessionId(sessionId)
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

  return (
    <div className="flex h-full flex-col">
      {/* Top bar with input and settings */}
      <div className="flex items-center justify-between border-b bg-background/95 backdrop-blur-sm px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} title="Settings">
            <Settings className="h-5 w-5" />
          </Button>
          <span className="font-semibold">SpeakMCP</span>
        </div>
        <SessionInput
          onTextSubmit={handleTextSubmit}
          onVoiceStart={handleVoiceStart}
          isProcessing={createTextMutation.isPending}
          showTextInput={showTextInput}
          onShowTextInputChange={setShowTextInput}
          className="flex-1 max-w-2xl mx-4 border-0 bg-transparent p-0"
        />
        <Button variant="ghost" size="icon" onClick={() => navigate("/history")} title="History">
          <MessageCircle className="h-5 w-5" />
        </Button>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto">
        {allProgressEntries.length === 0 ? (
          <div className="flex flex-col h-full">
            <EmptyState onTextClick={() => setShowTextInput(true)} onVoiceClick={handleVoiceStart} />

            {/* Recent conversations section when no active sessions */}
            {recentConversations.length > 0 && (
              <div className="px-4 pb-4 mt-auto">
                <div className="max-w-md mx-auto">
                  <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Recent Conversations
                  </h3>
                  <div className="space-y-2">
                    {recentConversations.map((conv) => (
                      <RecentConversationCard
                        key={conv.id}
                        conversation={conv}
                        onContinue={handleContinueConversation}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Active sessions grid */}
            <SessionGrid sessionCount={allProgressEntries.length}>
              {allProgressEntries.map(([sessionId, progress], index) => {
                const isCollapsed = collapsedSessions[sessionId] ?? false
                return (
                  <SessionTileWrapper
                    key={sessionId}
                    sessionId={sessionId}
                    index={index}
                    isCollapsed={isCollapsed}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    isDragTarget={dragTargetIndex === index && draggedSessionId !== sessionId}
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
                )
              })}
            </SessionGrid>

            {/* Recent conversations section below active sessions */}
            {recentConversations.length > 0 && (
              <div className="px-4 py-4 border-t bg-muted/10">
                <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Continue Recent Conversation
                </h3>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {recentConversations.map((conv) => (
                    <div key={conv.id} className="flex-shrink-0 w-64">
                      <RecentConversationCard
                        conversation={conv}
                        onContinue={handleContinueConversation}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

