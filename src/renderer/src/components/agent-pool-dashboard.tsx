import React, { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Button } from "@renderer/components/ui/button"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import { Progress } from "@renderer/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@renderer/components/ui/dialog"
import {
  Play,
  Square,
  Trash2,
  Plus,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Users,
  MessageSquare,
  Cpu,
  BarChart3
} from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { AgentInstance, AgentPoolStats } from "../../../main/agent-pool-service"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

dayjs.extend(relativeTime)

interface AgentPoolDashboardProps {
  className?: string
}

export function AgentPoolDashboard({ className }: AgentPoolDashboardProps) {
  const [selectedTab, setSelectedTab] = useState("overview")
  const queryClient = useQueryClient()

  // Queries
  const agentsQuery = useQuery({
    queryKey: ["agent-pool", "agents"],
    queryFn: () => tipcClient.getAgentPoolAgents(),
    refetchInterval: 2000 // Refresh every 2 seconds
  })

  const statsQuery = useQuery({
    queryKey: ["agent-pool", "stats"],
    queryFn: () => tipcClient.getAgentPoolStats(),
    refetchInterval: 5000 // Refresh every 5 seconds
  })

  // Mutations
  const stopAgentMutation = useMutation({
    mutationFn: (agentId: string) => tipcClient.stopAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-pool"] })
    }
  })

  const stopAllAgentsMutation = useMutation({
    mutationFn: () => tipcClient.stopAllAgents(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-pool"] })
    }
  })

  const agents = agentsQuery.data || []
  const stats = statsQuery.data

  const getStatusColor = (status: AgentInstance['status']) => {
    switch (status) {
      case "idle": return "bg-gray-500"
      case "processing": return "bg-blue-500"
      case "completed": return "bg-green-500"
      case "error": return "bg-red-500"
      case "stopped": return "bg-orange-500"
      default: return "bg-gray-500"
    }
  }

  const getStatusIcon = (status: AgentInstance['status']) => {
    switch (status) {
      case "idle": return <Clock className="h-4 w-4" />
      case "processing": return <Activity className="h-4 w-4" />
      case "completed": return <CheckCircle className="h-4 w-4" />
      case "error": return <XCircle className="h-4 w-4" />
      case "stopped": return <AlertCircle className="h-4 w-4" />
      default: return <Clock className="h-4 w-4" />
    }
  }

  const formatDuration = (startTime?: number, endTime?: number) => {
    if (!startTime) return "Not started"
    const end = endTime || Date.now()
    const duration = end - startTime
    return dayjs.duration(duration).humanize()
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Agent Pool Dashboard</h2>
          <p className="text-muted-foreground">
            Manage and monitor parallel agent execution
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["agent-pool"] })}
          >
            Refresh
          </Button>
          <Button
            variant="destructive"
            onClick={() => stopAllAgentsMutation.mutate()}
            disabled={stopAllAgentsMutation.isPending || !stats?.activeAgents}
          >
            <Square className="h-4 w-4 mr-2" />
            Stop All
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Agents</p>
                  <p className="text-2xl font-bold">{stats.totalAgents}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold">{stats.activeAgents}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Completed</p>
                  <p className="text-2xl font-bold">{stats.completedAgents}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Avg Time</p>
                  <p className="text-2xl font-bold">
                    {dayjs.duration(stats.averageCompletionTime).humanize()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="active">Active Agents</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Agents</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                <div className="space-y-2">
                  {agents.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No agents created yet
                    </div>
                  ) : (
                    agents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        onStop={() => stopAgentMutation.mutate(agent.id)}
                        isStoppingAgent={stopAgentMutation.isPending}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="active" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Agents</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                <div className="space-y-2">
                  {agents.filter(a => a.status === "processing").map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onStop={() => stopAgentMutation.mutate(agent.id)}
                      isStoppingAgent={stopAgentMutation.isPending}
                      showProgress
                    />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Completed Agents</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                <div className="space-y-2">
                  {agents.filter(a => a.status === "completed" || a.status === "error" || a.status === "stopped").map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onStop={() => stopAgentMutation.mutate(agent.id)}
                      isStoppingAgent={stopAgentMutation.isPending}
                    />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monitoring" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  Resource Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats && (
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Active Processes</span>
                        <span>{stats.totalResourceUsage.processes}</span>
                      </div>
                      <Progress value={(stats.totalResourceUsage.processes / 50) * 100} />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Conversations</span>
                        <span>{stats.totalResourceUsage.conversations}</span>
                      </div>
                      <Progress value={(stats.totalResourceUsage.conversations / 100) * 100} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Performance Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats && (
                  <div className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-sm">Success Rate</span>
                      <span className="text-sm font-medium">
                        {stats.totalAgents > 0 
                          ? Math.round((stats.completedAgents / stats.totalAgents) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Error Rate</span>
                      <span className="text-sm font-medium">
                        {stats.totalAgents > 0 
                          ? Math.round((stats.erroredAgents / stats.totalAgents) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Avg Completion</span>
                      <span className="text-sm font-medium">
                        {dayjs.duration(stats.averageCompletionTime).humanize()}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface AgentCardProps {
  agent: AgentInstance
  onStop: () => void
  isStoppingAgent: boolean
  showProgress?: boolean
}

function AgentCard({ agent, onStop, isStoppingAgent, showProgress }: AgentCardProps) {
  const getStatusColor = (status: AgentInstance['status']) => {
    switch (status) {
      case "idle": return "bg-gray-500"
      case "processing": return "bg-blue-500"
      case "completed": return "bg-green-500"
      case "error": return "bg-red-500"
      case "stopped": return "bg-orange-500"
      default: return "bg-gray-500"
    }
  }

  const getStatusIcon = (status: AgentInstance['status']) => {
    switch (status) {
      case "idle": return <Clock className="h-4 w-4" />
      case "processing": return <Activity className="h-4 w-4" />
      case "completed": return <CheckCircle className="h-4 w-4" />
      case "error": return <XCircle className="h-4 w-4" />
      case "stopped": return <AlertCircle className="h-4 w-4" />
      default: return <Clock className="h-4 w-4" />
    }
  }

  const formatDuration = (startTime?: number, endTime?: number) => {
    if (!startTime) return "Not started"
    const end = endTime || Date.now()
    const duration = end - startTime
    return dayjs.duration(duration).humanize()
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          <div className={cn("w-3 h-3 rounded-full", getStatusColor(agent.status))} />
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">
                Agent {agent.id.split('_')[1]}
              </span>
              <Badge variant="outline" className="text-xs">
                {agent.status}
              </Badge>
            </div>
            
            <p className="text-xs text-muted-foreground truncate">
              {agent.metadata.initialPrompt}
            </p>
            
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span>
                {formatDuration(agent.startedAt, agent.completedAt)}
              </span>
              <span>
                {agent.currentIteration}/{agent.maxIterations} iterations
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {agent.status === "processing" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              disabled={isStoppingAgent}
            >
              <Square className="h-3 w-3" />
            </Button>
          )}
          
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Navigate to conversation
              // This would need to be implemented
            }}
          >
            <MessageSquare className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {showProgress && agent.status === "processing" && (
        <div className="mt-3">
          <Progress 
            value={(agent.currentIteration / agent.maxIterations) * 100} 
            className="h-2"
          />
        </div>
      )}
    </Card>
  )
}
