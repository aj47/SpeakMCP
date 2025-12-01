import React, { useState, useMemo, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@renderer/components/ui/button"
import { Card, CardContent } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import {
  Plus,
  Mic,
  Activity,
  MessageCircle,
  Clock,
  AlertCircle,
  CheckCircle,
  StopCircle,
  Settings,
} from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { useAgentStore, useConversationStore } from "@renderer/stores"
import { useNavigate } from "react-router-dom"
import { useHistoryQuery } from "@renderer/lib/queries"
import dayjs from "dayjs"
import { toast } from "sonner"
import { logUI } from "@renderer/lib/debug"

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

export function Component() {
  const navigate = useNavigate()
  const [isStartingSpeech, setIsStartingSpeech] = useState(false)
  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  const continueConversation = useConversationStore((s) => s.continueConversation)

  // Get agent sessions
  const { data: sessionsData, refetch: refetchSessions } = useQuery<AgentSessionsResponse>({
    queryKey: ["agentSessions"],
    queryFn: async () => {
      return await tipcClient.getAgentSessions()
    },
  })

  // Get conversation history for past sessions
  const historyQuery = useHistoryQuery()

  // Listen for session updates
  useEffect(() => {
    const unlisten = rendererHandlers.agentSessionsUpdated.listen(() => {
      refetchSessions()
    })
    return unlisten
  }, [refetchSessions])

  const activeSessions = sessionsData?.activeSessions || []
  const recentSessions = sessionsData?.recentSessions || []

  // Handle starting new agent with text
  const handleStartTextAgent = async () => {
    logUI("[AgentSessions] Starting new text agent")
    try {
      await tipcClient.showTextInput({})
    } catch (error) {
      toast.error("Failed to start text agent")
    }
  }

  // Handle starting new agent with speech (MCP mode)
  const handleStartSpeechAgent = async () => {
    logUI("[AgentSessions] Starting speech agent (MCP mode)")
    setIsStartingSpeech(true)
    try {
      // Show panel and start MCP recording
      await tipcClient.setPanelMode({ mode: "normal" })
      await tipcClient.showPanelWindow({})
      // The panel will handle the recording UI
      toast.info("Panel opened. Hold Ctrl+Alt+Space to record, or use the microphone button.")
    } catch (error) {
      toast.error("Failed to start speech mode")
    } finally {
      setIsStartingSpeech(false)
    }
  }

  // Handle clicking on an active session
  const handleActiveSessionClick = async (session: AgentSession) => {
    logUI("[AgentSessions] Focusing active session:", session.id)
    setFocusedSessionId(session.id)

    // Unsnooze if snoozed
    if (session.isSnoozed) {
      await tipcClient.unsnoozeAgentSession({ sessionId: session.id })
    }

    // Focus and show panel
    await tipcClient.focusAgentSession({ sessionId: session.id })
    await tipcClient.setPanelMode({ mode: "agent" })
    await tipcClient.showPanelWindow({})
  }

  // Handle clicking on a past session
  const handlePastSessionClick = (session: AgentSession) => {
    if (session.conversationId) {
      navigate(`/history/${session.conversationId}`)
    }
  }

  // Handle continuing a conversation
  const handleContinueConversation = (conversationId: string) => {
    continueConversation(conversationId)
    toast.success("Conversation activated. Use Ctrl+T to continue.")
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="app-drag-region flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
        <h1 className="text-xl font-bold">Agent Sessions</h1>
        <div className="flex items-center gap-3">
          <Button
            onClick={handleStartTextAgent}
            size="lg"
            className="gap-2"
          >
            <Plus className="h-5 w-5" />
            New Agent
          </Button>
          <Button
            onClick={handleStartSpeechAgent}
            variant="outline"
            size="lg"
            className="gap-2"
            disabled={isStartingSpeech}
          >
            <Mic className={cn("h-5 w-5", isStartingSpeech && "animate-pulse text-red-500")} />
            {isStartingSpeech ? "Listening..." : "Voice Agent"}
          </Button>
          <Button
            onClick={() => navigate("/settings")}
            variant="ghost"
            size="icon"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <ScrollArea className="flex-1">
        <div className="space-y-8 p-6">
          {/* Active Sessions */}
          <ActiveSessionsSection
            sessions={activeSessions}
            focusedSessionId={focusedSessionId}
            agentProgressById={agentProgressById}
            onSessionClick={handleActiveSessionClick}
          />

          {/* Recent Sessions */}
          <RecentSessionsSection
            sessions={recentSessions}
            onSessionClick={handlePastSessionClick}
            onContinue={handleContinueConversation}
          />

          {/* Conversation History */}
          <ConversationHistorySection
            conversations={historyQuery.data || []}
            onContinue={handleContinueConversation}
          />
        </div>
      </ScrollArea>

      {/* Speech Mode Instructions Overlay */}
      {isStartingSpeech && <SpeechModeInstructions />}
    </div>
  )
}

// Active Sessions Section
function ActiveSessionsSection({
  sessions,
  focusedSessionId,
  agentProgressById,
  onSessionClick,
}: {
  sessions: AgentSession[]
  focusedSessionId: string | null
  agentProgressById: Map<string, any>
  onSessionClick: (session: AgentSession) => void
}) {
  if (sessions.length === 0) {
    return (
      <section>
        <h2 className="mb-4 text-lg font-semibold text-muted-foreground">Active Sessions</h2>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">No active sessions</p>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Start a new agent using the buttons above
            </p>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">
        Active Sessions
        <Badge variant="default" className="ml-2">{sessions.length}</Badge>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.map((session) => {
          const isFocused = focusedSessionId === session.id
          const progress = agentProgressById.get(session.id)
          const hasPendingApproval = !!progress?.pendingToolApproval

          return (
            <Card
              key={session.id}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md",
                hasPendingApproval && "border-amber-500 ring-2 ring-amber-500/20",
                isFocused && !hasPendingApproval && "border-blue-500 ring-2 ring-blue-500/20"
              )}
              onClick={() => onSessionClick(session)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "mt-1 rounded-full p-2",
                    hasPendingApproval ? "bg-amber-500/10" :
                    session.isSnoozed ? "bg-muted" : "bg-blue-500/10"
                  )}>
                    <Activity className={cn(
                      "h-4 w-4",
                      hasPendingApproval ? "text-amber-500" :
                      session.isSnoozed ? "text-muted-foreground" : "text-blue-500 animate-pulse"
                    )} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium">{session.conversationTitle || "Untitled"}</h3>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {hasPendingApproval ? `⚠ Approval: ${progress.pendingToolApproval?.toolName}` :
                       session.lastActivity || "Processing..."}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{dayjs(session.startTime).format("h:mm A")}</span>
                      {session.isSnoozed && (
                        <Badge variant="secondary" className="text-xs">Minimized</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

// Recent Sessions Section
function RecentSessionsSection({
  sessions,
  onSessionClick,
  onContinue,
}: {
  sessions: AgentSession[]
  onSessionClick: (session: AgentSession) => void
  onContinue: (conversationId: string) => void
}) {
  if (sessions.length === 0) return null

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-muted-foreground">Recent Sessions</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.slice(0, 6).map((session) => {
          const statusIcon = session.status === "completed" ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : session.status === "error" ? (
            <AlertCircle className="h-4 w-4 text-red-500" />
          ) : (
            <StopCircle className="h-4 w-4 text-muted-foreground" />
          )

          return (
            <Card
              key={session.id}
              className="cursor-pointer transition-all hover:shadow-sm"
              onClick={() => onSessionClick(session)}
            >
              <CardContent className="flex items-center gap-3 p-3">
                {statusIcon}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{session.conversationTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.endTime ? dayjs(session.endTime).format("h:mm A") : "Unknown"}
                  </p>
                </div>
                {session.conversationId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onContinue(session.conversationId!)
                    }}
                    title="Continue conversation"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

// Conversation History Section
function ConversationHistorySection({
  conversations,
  onContinue,
}: {
  conversations: any[]
  onContinue: (conversationId: string) => void
}) {
  const navigate = useNavigate()

  if (conversations.length === 0) return null

  // Show only first 6 conversations
  const displayedConversations = conversations.slice(0, 6)

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-muted-foreground">Conversation History</h2>
        <Button variant="ghost" size="sm" onClick={() => navigate("/history")}>
          View All
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {displayedConversations.map((conv) => (
          <Card
            key={conv.id}
            className="cursor-pointer transition-all hover:shadow-sm"
            onClick={() => navigate(`/history/${conv.id}`)}
          >
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{conv.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {conv.preview}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-xs">
                      {conv.messageCount} msgs
                    </Badge>
                    <span>{dayjs(conv.updatedAt).format("MMM D, h:mm A")}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

// Speech Mode Instructions Component
function SpeechModeInstructions() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="mx-4 max-w-md">
        <CardContent className="p-6 text-center">
          <Mic className="mx-auto mb-4 h-12 w-12 animate-pulse text-red-500" />
          <h3 className="mb-2 text-lg font-semibold">Speech Mode Active</h3>
          <p className="text-muted-foreground">
            Speak your message now. When you're done:
          </p>
          <div className="mt-4 space-y-2 text-left">
            <div className="flex items-center gap-2 rounded-md bg-muted p-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm">
                <strong>Submit:</strong> Press the toggle key again
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-muted p-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm">
                <strong>Cancel:</strong> Press Escape
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

