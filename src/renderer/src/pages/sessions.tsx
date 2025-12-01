import React, { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { Button } from "@renderer/components/ui/button"
import { Card, CardContent } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import { Input } from "@renderer/components/ui/input"
import { Textarea } from "@renderer/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@renderer/components/ui/dialog"
import {
  Plus,
  Mic,
  Activity,
  MessageCircle,
  X,
  Minimize2,
  Maximize2,
  Shield,
  Search,
  Calendar,
} from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useAgentStore } from "@renderer/stores"
import { useHistoryQuery } from "@renderer/lib/queries"
import dayjs from "dayjs"
import { toast } from "sonner"

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
  const [showNewAgentDialog, setShowNewAgentDialog] = useState(false)
  const [newAgentText, setNewAgentText] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSpeechMode, setIsSpeechMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  
  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  
  // Query active agent sessions
  const { data: sessionsData, refetch: refetchSessions } = useQuery<AgentSessionsResponse>({
    queryKey: ["agentSessions"],
    queryFn: async () => tipcClient.getAgentSessions(),
  })

  // Query conversation history for past sessions
  const historyQuery = useHistoryQuery()

  // Listen for push-based session updates from main process
  useEffect(() => {
    const unlisten = rendererHandlers.agentSessionsUpdated.listen(() => {
      refetchSessions()
    })
    return unlisten
  }, [refetchSessions])

  const activeSessions = sessionsData?.activeSessions || []
  const recentSessions = sessionsData?.recentSessions || []
  
  // Filter history based on search
  const filteredHistory = React.useMemo(() => {
    if (!historyQuery.data) return []
    if (!searchQuery) return historyQuery.data.slice(0, 10) // Show recent 10 by default
    return historyQuery.data.filter(
      (item) =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.preview.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [historyQuery.data, searchQuery])

  // Handle new agent with text input
  const handleStartTextAgent = async () => {
    if (!newAgentText.trim() || isSubmitting) return
    
    setIsSubmitting(true)
    try {
      await tipcClient.createMcpTextInput({ text: newAgentText.trim() })
      setNewAgentText("")
      setShowNewAgentDialog(false)
      toast.success("Agent started")
    } catch (error) {
      console.error("Failed to start agent:", error)
      toast.error("Failed to start agent")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle new agent with speech
  const handleStartSpeechAgent = async () => {
    try {
      // Show the panel and start MCP recording
      await tipcClient.showPanelWindow({})
      // The panel will handle the recording via its handlers
      // We need to trigger the MCP recording mode
      await tipcClient.triggerMcpRecording()
      setIsSpeechMode(true)
      toast.info("Speak your request. Toggle again to submit.")
    } catch (error) {
      console.error("Failed to start speech mode:", error)
      toast.error("Failed to start speech mode")
    }
  }

  // Handle session click to restore/focus
  const handleSessionClick = async (session: AgentSession) => {
    setFocusedSessionId(session.id)
    if (session.isSnoozed) {
      try {
        await tipcClient.unsnoozeAgentSession({ sessionId: session.id })
        await tipcClient.focusAgentSession({ sessionId: session.id })
        await tipcClient.setPanelMode({ mode: "agent" })
        await tipcClient.showPanelWindow({})
      } catch (error) {
        console.error("Failed to restore session:", error)
      }
    }
  }

  // Handle stop session
  const handleStopSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await tipcClient.stopAgentSession({ sessionId })
      if (focusedSessionId === sessionId) {
        setFocusedSessionId(null)
      }
    } catch (error) {
      console.error("Failed to stop session:", error)
    }
  }

  // Handle minimize/maximize session
  const handleToggleSnooze = async (session: AgentSession, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (session.isSnoozed) {
        setFocusedSessionId(session.id)
        await tipcClient.unsnoozeAgentSession({ sessionId: session.id })
        await tipcClient.focusAgentSession({ sessionId: session.id })
        await tipcClient.setPanelMode({ mode: "agent" })
        await tipcClient.showPanelWindow({})
      } else {
        await tipcClient.snoozeAgentSession({ sessionId: session.id })
        if (focusedSessionId === session.id) {
          setFocusedSessionId(null)
        }
        await tipcClient.hidePanelWindow({})
      }
    } catch (error) {
      console.error("Failed to toggle snooze:", error)
    }
  }

  // Navigate to history detail
  const handleViewHistory = (conversationId: string) => {
    navigate(`/history/${conversationId}`)
  }

  return (
    <>
      {/* Header with action buttons */}
      <header className="app-drag-region flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">Agent Sessions</h1>
          {activeSessions.length > 0 && (
            <Badge variant="secondary" className="bg-blue-500/10 text-blue-500">
              {activeSessions.length} Active
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* New Agent with Text button */}
          <Button
            onClick={() => setShowNewAgentDialog(true)}
            className="gap-2"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            New Agent
          </Button>

          {/* New Agent with Speech button */}
          <Button
            onClick={handleStartSpeechAgent}
            variant="outline"
            className="gap-2"
            size="sm"
          >
            <Mic className="h-4 w-4" />
            Voice
          </Button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden bg-background">
        <ScrollArea className="h-full">
          <div className="space-y-6 p-4">
            {/* Active Sessions Section */}
            {activeSessions.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Activity className="h-4 w-4" />
                  Active Sessions
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {activeSessions.map((session) => {
                    const isFocused = focusedSessionId === session.id
                    const sessionProgress = agentProgressById.get(session.id)
                    const hasPendingApproval = !!sessionProgress?.pendingToolApproval

                    return (
                      <Card
                        key={session.id}
                        onClick={() => handleSessionClick(session)}
                        className={cn(
                          "cursor-pointer transition-all hover:shadow-md",
                          hasPendingApproval
                            ? "border-amber-500 ring-2 ring-amber-500/20"
                            : isFocused
                            ? "border-blue-500 ring-2 ring-blue-500/20"
                            : "hover:border-primary/50"
                        )}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {hasPendingApproval ? (
                                  <Shield className="h-4 w-4 shrink-0 text-amber-500 animate-pulse" />
                                ) : (
                                  <Activity className={cn(
                                    "h-4 w-4 shrink-0",
                                    session.isSnoozed ? "text-muted-foreground" : "animate-pulse text-blue-500"
                                  )} />
                                )}
                                <h3 className="truncate font-medium">
                                  {session.conversationTitle || "New Session"}
                                </h3>
                              </div>
                              {hasPendingApproval ? (
                                <p className="mt-1 text-sm text-amber-600 dark:text-amber-400 font-medium">
                                  ⚠ Approval required: {sessionProgress.pendingToolApproval?.toolName}
                                </p>
                              ) : session.lastActivity && (
                                <p className="mt-1 truncate text-sm text-muted-foreground">
                                  {session.lastActivity}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => handleToggleSnooze(session, e)}
                                className="h-8 w-8 p-0"
                                title={session.isSnoozed ? "Restore" : "Minimize"}
                              >
                                {session.isSnoozed ? (
                                  <Maximize2 className="h-4 w-4" />
                                ) : (
                                  <Minimize2 className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => handleStopSession(session.id, e)}
                                className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                                title="Stop session"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          {session.currentIteration !== undefined && session.maxIterations !== undefined && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="h-1 flex-1 rounded-full bg-muted">
                                <div
                                  className="h-1 rounded-full bg-blue-500"
                                  style={{ width: `${(session.currentIteration / session.maxIterations) * 100}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {session.currentIteration}/{session.maxIterations}
                              </span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Recent/Completed Sessions */}
            {recentSessions.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <MessageCircle className="h-4 w-4" />
                  Recent Sessions
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {recentSessions.map((session) => {
                    const statusLabel = session.status === "stopped" ? "Stopped" : session.status === "error" ? "Error" : "Completed"
                    const statusColor = session.status === "error" ? "destructive" : "secondary"

                    return (
                      <Card
                        key={session.id}
                        onClick={() => session.conversationId && handleViewHistory(session.conversationId)}
                        className={cn(
                          "transition-all",
                          session.conversationId && "cursor-pointer hover:shadow-md hover:border-primary/50"
                        )}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate font-medium">
                                {session.conversationTitle || "Session"}
                              </h3>
                              {session.lastActivity && (
                                <p className="mt-1 truncate text-sm text-muted-foreground">
                                  {session.lastActivity}
                                </p>
                              )}
                            </div>
                            <Badge variant={statusColor} className="shrink-0">
                              {statusLabel}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Conversation History Section */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Conversation History
                </h2>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search..."
                    className="h-8 w-48 pl-8"
                  />
                </div>
              </div>

              {filteredHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MessageCircle className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="mb-2 font-semibold">
                    {searchQuery ? "No matching conversations" : "No conversation history yet"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {searchQuery
                      ? "Try adjusting your search terms"
                      : "Start a new agent session using the buttons above"
                    }
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredHistory.map((item) => (
                    <Card
                      key={item.id}
                      onClick={() => handleViewHistory(item.id)}
                      className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
                    >
                      <CardContent className="p-4">
                        <h3 className="truncate font-medium">{item.title}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {item.preview}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="text-xs">
                            {item.messageCount} messages
                          </Badge>
                          <span>•</span>
                          <span>{dayjs(item.updatedAt).format("MMM D, h:mm A")}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {filteredHistory.length > 0 && !searchQuery && historyQuery.data && historyQuery.data.length > 10 && (
                <div className="mt-4 text-center">
                  <Button
                    variant="ghost"
                    onClick={() => navigate("/history")}
                    className="text-muted-foreground"
                  >
                    View all {historyQuery.data.length} conversations
                  </Button>
                </div>
              )}
            </section>

            {/* Empty state when no sessions and no history */}
            {activeSessions.length === 0 && recentSessions.length === 0 && filteredHistory.length === 0 && !searchQuery && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
                  <MessageCircle className="h-10 w-10 text-primary" />
                </div>
                <h2 className="mb-2 text-xl font-semibold">Welcome to SpeakMCP</h2>
                <p className="mb-6 max-w-md text-muted-foreground">
                  Start your first AI agent session. Use text input or voice to interact with MCP tools and get things done.
                </p>
                <div className="flex gap-3">
                  <Button onClick={() => setShowNewAgentDialog(true)} className="gap-2">
                    <Plus className="h-4 w-4" />
                    New Agent
                  </Button>
                  <Button onClick={handleStartSpeechAgent} variant="outline" className="gap-2">
                    <Mic className="h-4 w-4" />
                    Voice Input
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* New Agent Dialog */}
      <Dialog open={showNewAgentDialog} onOpenChange={setShowNewAgentDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start New Agent</DialogTitle>
            <DialogDescription>
              Type your request to start a new AI agent session.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={newAgentText}
              onChange={(e) => setNewAgentText(e.target.value)}
              placeholder="What would you like the agent to help you with?"
              className="min-h-[100px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleStartTextAgent()
                }
              }}
              autoFocus
            />
            <div className="flex justify-between">
              <p className="text-xs text-muted-foreground">
                Press Enter to start • Shift+Enter for new line
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowNewAgentDialog(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleStartTextAgent}
                  disabled={!newAgentText.trim() || isSubmitting}
                >
                  {isSubmitting ? "Starting..." : "Start Agent"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Speech Mode Instructions Dialog */}
      <Dialog open={isSpeechMode} onOpenChange={setIsSpeechMode}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-red-500 animate-pulse" />
              Speech Mode Active
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <p className="font-medium">Speak your request now.</p>
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="mb-2"><strong>To submit:</strong> Toggle the speech button again or press the hotkey</p>
                <p><strong>To cancel:</strong> Press Escape or click Cancel</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setIsSpeechMode(false)
                tipcClient.hidePanelWindow({})
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

