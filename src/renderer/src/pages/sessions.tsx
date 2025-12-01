import React, { useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { useAgentStore } from "@renderer/stores"
import { SessionGrid, SessionTileWrapper } from "@renderer/components/session-grid"
import { SessionTile } from "@renderer/components/session-tile"
import { SessionInput } from "@renderer/components/session-input"
import { Settings, MessageCircle, Mic, Plus } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import { useEffect } from "react"

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

  // Fetch sessions
  const { data: sessionsData, refetch } = useQuery<AgentSessionsResponse>({
    queryKey: ["agentSessions"],
    queryFn: async () => tipcClient.getAgentSessions(),
  })

  // Listen for session updates
  useEffect(() => {
    const unlisten = rendererHandlers.agentSessionsUpdated.listen(() => {
      refetch()
    })
    return unlisten
  }, [refetch])

  const activeSessions = sessionsData?.activeSessions || []
  const recentSessions = sessionsData?.recentSessions || []
  const allSessions = [...activeSessions, ...recentSessions]

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

  // Session action handlers
  const handleStopSession = async (sessionId: string) => {
    await tipcClient.stopAgentSession({ sessionId })
  }

  const handleSnoozeSession = async (sessionId: string) => {
    await tipcClient.snoozeAgentSession({ sessionId })
    if (focusedSessionId === sessionId) {
      setFocusedSessionId(null)
    }
  }

  const handleUnsnoozeSession = async (sessionId: string) => {
    setFocusedSessionId(sessionId)
    await tipcClient.unsnoozeAgentSession({ sessionId })
    await tipcClient.focusAgentSession({ sessionId })
  }

  const handleFocusSession = (sessionId: string) => {
    setFocusedSessionId(sessionId)
  }

  const handleDismissSession = async (sessionId: string) => {
    await tipcClient.clearAgentSessionProgress({ sessionId })
    queryClient.invalidateQueries({ queryKey: ["agentSessions"] })
  }

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
        {allSessions.length === 0 ? (
          <EmptyState onTextClick={() => {}} onVoiceClick={handleVoiceStart} />
        ) : (
          <SessionGrid sessionCount={allSessions.length}>
            {allSessions.map((session, index) => (
              <SessionTileWrapper key={session.id} sessionCount={allSessions.length} index={index}>
                <SessionTile
                  session={session}
                  progress={agentProgressById.get(session.id)}
                  isFocused={focusedSessionId === session.id}
                  onFocus={() => handleFocusSession(session.id)}
                  onStop={() => handleStopSession(session.id)}
                  onSnooze={() => handleSnoozeSession(session.id)}
                  onUnsnooze={() => handleUnsnoozeSession(session.id)}
                  onDismiss={() => handleDismissSession(session.id)}
                />
              </SessionTileWrapper>
            ))}
          </SessionGrid>
        )}
      </div>
    </div>
  )
}

