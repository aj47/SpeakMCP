import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Button } from "@renderer/components/ui/button"
import { Badge } from "@renderer/components/ui/badge"
import { AgentProgress } from "@renderer/components/agent-progress"
import { 
  Bot, 
  Plus, 
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle
} from "lucide-react"
import { AgentExecutionState } from "@shared/types"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"

export function Component() {
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)

  const { data: executions = [], isLoading, refetch } = useQuery({
    queryKey: ["agent-executions"],
    queryFn: async () => {
      return await tipcClient.getAllAgentExecutions()
    },
    refetchInterval: 2000, // Refresh every 2 seconds for active executions
  })

  const handleStartNewExecution = async () => {
    const goal = prompt("Enter your goal for the agent:")
    if (!goal?.trim()) return

    try {
      const result = await tipcClient.startAgentExecution({ goal: goal.trim() })
      setSelectedExecutionId(result.executionId)
      toast.success("Agent execution started!")
      refetch()
    } catch (error) {
      toast.error("Failed to start agent execution")
      console.error(error)
    }
  }

  const getStatusIcon = (status: AgentExecutionState['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-gray-500" />
      case 'running':
      case 'initializing':
        return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />
    }
  }

  const formatDuration = (startTime: number, endTime?: number) => {
    const duration = (endTime || Date.now()) - startTime
    const seconds = Math.floor(duration / 1000)
    const minutes = Math.floor(seconds / 60)
    
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    }
    return `${seconds}s`
  }

  if (selectedExecutionId) {
    return (
      <div className="container mx-auto p-6">
        <AgentProgress 
          executionId={selectedExecutionId} 
          onClose={() => setSelectedExecutionId(null)}
        />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bot className="h-8 w-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold">Agent Executions</h1>
            <p className="text-muted-foreground">
              Manage and monitor your agent chaining executions
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={handleStartNewExecution}>
            <Plus className="h-4 w-4 mr-2" />
            New Execution
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Bot className="h-12 w-12 mx-auto mb-4 text-muted-foreground animate-pulse" />
            <p className="text-muted-foreground">Loading executions...</p>
          </div>
        </div>
      ) : executions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bot className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Agent Executions</h3>
            <p className="text-muted-foreground text-center mb-4">
              Start your first agent execution to see it here
            </p>
            <Button onClick={handleStartNewExecution}>
              <Plus className="h-4 w-4 mr-2" />
              Start New Execution
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {executions.map((execution) => (
            <Card 
              key={execution.id} 
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedExecutionId(execution.id)}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(execution.status)}
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base truncate">
                        {execution.goal}
                      </CardTitle>
                      <CardDescription className="text-sm">
                        Started {new Date(execution.startTime).toLocaleString()}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      execution.status === 'completed' ? 'default' :
                      execution.status === 'failed' ? 'destructive' :
                      execution.status === 'cancelled' ? 'secondary' :
                      'outline'
                    }>
                      {execution.status}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Duration:</span>
                    <div className="font-medium">
                      {formatDuration(execution.startTime, execution.endTime)}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Steps:</span>
                    <div className="font-medium">{execution.steps.length}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Progress:</span>
                    <div className="font-medium">
                      {execution.progress.currentStep} / {execution.progress.totalSteps}
                    </div>
                  </div>
                </div>
                
                {execution.progress.currentStepDescription && (
                  <div className="mt-3 p-2 bg-accent/50 rounded text-sm">
                    <span className="text-muted-foreground">Current: </span>
                    {execution.progress.currentStepDescription}
                  </div>
                )}

                {execution.finalResult && (
                  <div className="mt-3 p-2 bg-green-50 dark:bg-green-950 rounded text-sm border border-green-200 dark:border-green-800">
                    <span className="text-green-800 dark:text-green-200 font-medium">Result: </span>
                    <span className="text-green-700 dark:text-green-300">
                      {execution.finalResult.length > 100 
                        ? `${execution.finalResult.substring(0, 100)}...`
                        : execution.finalResult
                      }
                    </span>
                  </div>
                )}

                {execution.error && (
                  <div className="mt-3 p-2 bg-red-50 dark:bg-red-950 rounded text-sm border border-red-200 dark:border-red-800">
                    <span className="text-red-800 dark:text-red-200 font-medium">Error: </span>
                    <span className="text-red-700 dark:text-red-300">
                      {execution.error.length > 100 
                        ? `${execution.error.substring(0, 100)}...`
                        : execution.error
                      }
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
