import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import dayjs from "dayjs"
import { CheckCircle2, Clock, Loader2, Search } from "lucide-react"

import { cn } from "@renderer/lib/utils"
import { useConversationHistoryQuery } from "@renderer/lib/queries"
import { Input } from "@renderer/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"

const INITIAL_PAST_SESSIONS = 20

function formatTimestamp(timestamp: number): string {
  const now = dayjs()
  const date = dayjs(timestamp)
  // Clamp to 0 to handle clock skew (when timestamp is slightly in the future)
  const diffSeconds = Math.max(0, now.diff(date, "second"))
  const diffMinutes = Math.max(0, now.diff(date, "minute"))
  const diffHours = Math.max(0, now.diff(date, "hour"))

  if (diffHours < 24) {
    if (diffSeconds < 60) return `${diffSeconds}s`
    if (diffMinutes < 60) return `${diffMinutes}m`
    return `${diffHours}h`
  }

  if (diffHours < 168) return date.format("ddd h:mm A")
  return date.format("MMM D")
}

export function PastSessionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const conversationHistoryQuery = useConversationHistoryQuery(open)

  const [searchQuery, setSearchQuery] = useState("")
  const [pastSessionsCount, setPastSessionsCount] = useState(
    INITIAL_PAST_SESSIONS,
  )

  useEffect(() => {
    if (!open) {
      setSearchQuery("")
      setPastSessionsCount(INITIAL_PAST_SESSIONS)
      return
    }

    // When searching, reset the lazy-load count so results feel predictable.
    setPastSessionsCount(INITIAL_PAST_SESSIONS)
  }, [open, searchQuery])

  const filteredPastSessions = useMemo(() => {
    const all = conversationHistoryQuery.data ?? []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (session) =>
        session.title.toLowerCase().includes(q) ||
        session.preview.toLowerCase().includes(q),
    )
  }, [conversationHistoryQuery.data, searchQuery])

  const visiblePastSessions = useMemo(
    () => filteredPastSessions.slice(0, pastSessionsCount),
    [filteredPastSessions, pastSessionsCount],
  )

  const hasMorePastSessions = filteredPastSessions.length > pastSessionsCount

  const handleOpenPastSession = (conversationId: string) => {
    navigate(`/${conversationId}`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Past Sessions
          </DialogTitle>
          <DialogDescription>
            Open a previous session while keeping the sidebar collapsed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search past sessions..."
              className="pl-7 text-xs"
            />
          </div>

          <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
            {conversationHistoryQuery.isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading sessions...</span>
              </div>
            ) : conversationHistoryQuery.isError ? (
              <p className="text-destructive px-2 py-2 text-xs">
                Failed to load sessions
              </p>
            ) : visiblePastSessions.length === 0 ? (
              <p className="text-muted-foreground px-2 py-2 text-xs">
                No past sessions
              </p>
            ) : (
              <>
                {visiblePastSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleOpenPastSession(session.id)}
                    className={cn(
                      "group flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      "hover:bg-accent/50",
                    )}
                    title={`${session.preview}\n${dayjs(session.updatedAt).format("MMM D, h:mm A")}`}
                  >
                    <CheckCircle2 className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {session.title}
                        </span>
                        <span className="text-muted-foreground ml-auto shrink-0 text-[10px] tabular-nums">
                          {formatTimestamp(session.updatedAt)}
                        </span>
                      </div>
                      {session.preview && (
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">
                          {session.preview}
                        </p>
                      )}
                    </div>
                  </button>
                ))}

                {hasMorePastSessions && (
                  <button
                    type="button"
                    onClick={() =>
                      setPastSessionsCount(
                        (prev) => prev + INITIAL_PAST_SESSIONS,
                      )
                    }
                    className="text-muted-foreground hover:bg-accent/50 hover:text-foreground w-full rounded-md px-3 py-2 text-xs transition-colors"
                  >
                    Load more ({filteredPastSessions.length - pastSessionsCount}{" "}
                    remaining)
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
