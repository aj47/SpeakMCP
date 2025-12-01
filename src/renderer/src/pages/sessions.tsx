import React, { useEffect, useState, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { useAgentStore } from "@renderer/stores"
import { SessionGrid, SessionTileWrapper } from "@renderer/components/session-grid"
import { AgentProgress } from "@renderer/components/agent-progress"
import { SessionInput } from "@renderer/components/session-input"
import { Settings, MessageCircle, Mic, Plus } from "lucide-react"
import { Button } from "@renderer/components/ui/button"

function EmptyState({ onTextClick, onVoiceClick }: { onTextClick: () => void; onVoiceClick: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
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

export function Component() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)

  // Custom ordering state - persists session order across re-renders
  const [sessionOrder, setSessionOrder] = useState<string[]>([])

  // Drag state
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null)
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null)

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
          className="flex-1 max-w-2xl mx-4 border-0 bg-transparent p-0"
        />
        <Button variant="ghost" size="icon" onClick={() => navigate("/history")} title="History">
          <MessageCircle className="h-5 w-5" />
        </Button>
      </div>

      {/* Sessions grid */}
      <div className="flex-1 overflow-y-auto">
        {allProgressEntries.length === 0 ? (
          <EmptyState onTextClick={() => {}} onVoiceClick={handleVoiceStart} />
        ) : (
          <SessionGrid sessionCount={allProgressEntries.length}>
            {allProgressEntries.map(([sessionId, progress], index) => (
              <SessionTileWrapper
                key={sessionId}
                sessionId={sessionId}
                index={index}
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
                />
              </SessionTileWrapper>
            ))}
          </SessionGrid>
        )}
      </div>
    </div>
  )
}

