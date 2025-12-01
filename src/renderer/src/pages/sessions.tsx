import React, { useEffect } from "react"
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

  // Get all sessions from the progress store - this is the single source of truth
  const allProgressEntries = React.useMemo(() => {
    return Array.from(agentProgressById.entries())
      .filter(([_, progress]) => progress !== null)
      .sort((a, b) => {
        // Sort active sessions first, then by start time (newest first)
        const aComplete = a[1]?.isComplete ?? false
        const bComplete = b[1]?.isComplete ?? false
        if (aComplete !== bComplete) return aComplete ? 1 : -1
        return (b[1]?.steps?.[0]?.timestamp ?? 0) - (a[1]?.steps?.[0]?.timestamp ?? 0)
      })
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
              <SessionTileWrapper key={sessionId} sessionCount={allProgressEntries.length} index={index}>
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

