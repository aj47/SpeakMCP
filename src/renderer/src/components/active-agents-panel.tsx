import React from "react"
import { useQuery } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Card, CardContent, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import { Activity, CheckCircle2, XCircle, StopCircle, Clock } from "lucide-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

dayjs.extend(relativeTime)

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
}

interface AgentSessionsResponse {
  activeSessions: AgentSession[]
  recentSessions: AgentSession[]
}

export function ActiveAgentsPanel() {
  const { data, isLoading, error } = useQuery<AgentSessionsResponse>({
    queryKey: ["agentSessions"],
    queryFn: async () => {
      return await tipcClient.getAgentSessions()
    },
    refetchInterval: 2000, // Refresh every 2 seconds to show real-time updates
  })

  if (isLoading) {
    return (
      <Card className="modern-panel-subtle modern-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Active Agents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading agent status...</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="modern-panel-subtle modern-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Active Agents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-500">Failed to load agent status</p>
        </CardContent>
      </Card>
    )
  }

  const { activeSessions = [], recentSessions = [] } = data || {}
  const hasActiveSessions = activeSessions.length > 0
  const hasRecentSessions = recentSessions.length > 0

  return (
    <Card className="modern-panel-subtle modern-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Active Agents
          {hasActiveSessions && (
            <Badge variant="default" className="ml-auto">
              {activeSessions.length} active
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          <div className="space-y-3">
            {/* Active Sessions */}
            {hasActiveSessions && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Currently Active</h4>
                {activeSessions.map((session) => (
                  <AgentSessionCard key={session.id} session={session} />
                ))}
              </div>
            )}

            {/* Recent Sessions */}
            {hasRecentSessions && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {hasActiveSessions ? "Recent History" : "Recent Agents"}
                </h4>
                {recentSessions.map((session) => (
                  <AgentSessionCard key={session.id} session={session} />
                ))}
              </div>
            )}

            {/* Empty State */}
            {!hasActiveSessions && !hasRecentSessions && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="mb-2 h-8 w-8 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">No agent sessions yet</p>
                <p className="text-xs text-muted-foreground">
                  Agent sessions will appear here when you use agent mode
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

interface AgentSessionCardProps {
  session: AgentSession
}

function AgentSessionCard({ session }: AgentSessionCardProps) {
  const getStatusIcon = () => {
    switch (session.status) {
      case "active":
        return <Activity className="h-3.5 w-3.5 animate-pulse text-blue-500" />
      case "completed":
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-red-500" />
      case "stopped":
        return <StopCircle className="h-3.5 w-3.5 text-orange-500" />
    }
  }

  const getStatusBadge = () => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      completed: "secondary",
      error: "destructive",
      stopped: "outline",
    }
    return (
      <Badge variant={variants[session.status]} className="text-xs">
        {session.status}
      </Badge>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-3 text-card-foreground shadow-sm transition-colors hover:bg-accent/50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {getStatusIcon()}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{session.conversationTitle}</p>
            {session.lastActivity && (
              <p className="truncate text-xs text-muted-foreground">{session.lastActivity}</p>
            )}
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{dayjs(session.startTime).fromNow()}</span>
              {session.endTime && (
                <span>• {Math.round((session.endTime - session.startTime) / 1000)}s</span>
              )}
            </div>
          </div>
        </div>
        {getStatusBadge()}
      </div>
    </div>
  )
}

