import React from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate } from "@shared/types"
import { AgentProgress } from "./agent-progress"
import { Loader2, Clock, CheckCircle2 } from "lucide-react"

interface KanbanColumn {
  id: "idle" | "active" | "done"
  title: string
  color: string
}

const COLUMNS: KanbanColumn[] = [
  {
    id: "idle",
    title: "Idle",
    color: "border-t-amber-500"
  },
  {
    id: "active",
    title: "In Progress",
    color: "border-t-blue-500"
  },
  {
    id: "done",
    title: "Done",
    color: "border-t-green-500"
  },
]

function getColumnIcon(columnId: KanbanColumn["id"], hasActiveSessions: boolean): React.ReactNode {
  switch (columnId) {
    case "idle":
      return <Clock className="h-4 w-4" />
    case "active":
      return <Loader2 className={cn("h-4 w-4", hasActiveSessions && "animate-spin")} />
    case "done":
      return <CheckCircle2 className="h-4 w-4" />
  }
}

export interface SessionsKanbanProps {
  sessions: Array<[string, AgentProgressUpdate]>
  focusedSessionId: string | null
  onFocusSession: (sessionId: string) => void
  onDismissSession: (sessionId: string) => void
  pendingProgress?: AgentProgressUpdate | null
  pendingSessionId?: string | null
  onDismissPendingContinuation?: () => void
}

export function SessionsKanban({
  sessions,
  focusedSessionId,
  onFocusSession,
  onDismissSession,
  pendingProgress,
  pendingSessionId,
  onDismissPendingContinuation,
}: SessionsKanbanProps) {
  // Categorize sessions into columns
  const categorizedSessions = React.useMemo(() => {
    const idle: Array<[string, AgentProgressUpdate]> = []
    const active: Array<[string, AgentProgressUpdate]> = []
    const done: Array<[string, AgentProgressUpdate]> = []

    // Add pending continuation to idle column if it exists
    // Pending conversations are waiting for user input, so they're idle until a message is sent
    if (pendingProgress && pendingSessionId) {
      idle.push([pendingSessionId, pendingProgress])
    }

    for (const entry of sessions) {
      const [sessionId, progress] = entry
      // Skip if this is the pending session (already added above to avoid duplicates)
      if (pendingSessionId && sessionId === pendingSessionId) {
        continue
      }
      if (progress.isComplete) {
        done.push(entry)
      } else if (progress.isSnoozed) {
        idle.push(entry)
      } else {
        active.push(entry)
      }
    }

    return { idle, active, done }
  }, [sessions, pendingProgress, pendingSessionId])

  return (
    <div className="flex gap-4 p-4 h-full overflow-x-auto">
      {COLUMNS.map((column) => (
        <KanbanColumnComponent
          key={column.id}
          column={column}
          sessions={categorizedSessions[column.id]}
          focusedSessionId={focusedSessionId}
          onFocusSession={onFocusSession}
          onDismissSession={onDismissSession}
          pendingSessionId={pendingSessionId}
          onDismissPendingContinuation={onDismissPendingContinuation}
        />
      ))}
    </div>
  )
}

interface KanbanColumnComponentProps {
  column: KanbanColumn
  sessions: Array<[string, AgentProgressUpdate]>
  focusedSessionId: string | null
  onFocusSession: (sessionId: string) => void
  onDismissSession: (sessionId: string) => void
  pendingSessionId?: string | null
  onDismissPendingContinuation?: () => void
}

function KanbanColumnComponent({
  column,
  sessions,
  focusedSessionId,
  onFocusSession,
  onDismissSession,
  pendingSessionId,
  onDismissPendingContinuation,
}: KanbanColumnComponentProps) {
  return (
    <div className={cn(
      "flex-1 min-w-[300px] max-w-[400px] flex flex-col",
      "bg-muted/30 rounded-lg border border-t-4",
      column.color
    )}>
      {/* Column header */}
      <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
        {getColumnIcon(column.id, sessions.length > 0)}
        <span className="font-medium text-sm">{column.title}</span>
        <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {sessions.length}
        </span>
      </div>

      {/* Cards container */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
            No sessions
          </div>
        ) : (
          sessions.map(([sessionId, progress]) => {
            const isPending = sessionId === pendingSessionId
            return (
              <KanbanCard
                key={sessionId}
                sessionId={sessionId}
                progress={progress}
                isFocused={isPending || focusedSessionId === sessionId}
                onFocus={() => !isPending && onFocusSession(sessionId)}
                onDismiss={() => isPending && onDismissPendingContinuation ? onDismissPendingContinuation() : onDismissSession(sessionId)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

interface KanbanCardProps {
  sessionId: string
  progress: AgentProgressUpdate
  isFocused: boolean
  onFocus: () => void
  onDismiss: () => void
}

function KanbanCard({
  sessionId,
  progress,
  isFocused,
  onFocus,
  onDismiss,
}: KanbanCardProps) {
  // Local collapsed state for the card - defaults to true for compact Kanban view
  const [isCollapsed, setIsCollapsed] = React.useState(true)

  return (
    <div className={cn(
      "bg-background rounded-md border shadow-sm overflow-hidden",
      "transition-all hover:shadow-md",
      isFocused && "ring-2 ring-primary"
    )}>
      <AgentProgress
        progress={progress}
        variant="tile"
        isFocused={isFocused}
        onFocus={onFocus}
        onDismiss={onDismiss}
        isCollapsed={isCollapsed}
        onCollapsedChange={setIsCollapsed}
      />
    </div>
  )
}

