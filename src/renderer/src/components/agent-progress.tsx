import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Button } from "@renderer/components/ui/button"
import { Badge } from "@renderer/components/ui/badge"
import { Progress } from "@renderer/components/ui/progress"
import { Spinner } from "@renderer/components/ui/spinner"
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Play, 
  Square, 
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Bot,
  Wrench,
  Target
} from "lucide-react"
import { AgentExecutionState, AgentStep } from "@shared/types"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"
import { cn } from "@renderer/lib/utils"

interface AgentProgressProps {
  executionId?: string
  onClose?: () => void
}

export function AgentProgress({ executionId, onClose }: AgentProgressProps) {
  const [execution, setExecution] = useState<AgentExecutionState | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!executionId) {
      setIsLoading(false)
      return
    }

    const fetchExecution = async () => {
      try {
        const result = await tipcClient.getAgentExecution({ executionId })
        setExecution(result)
      } catch (error) {
        console.error("Failed to fetch agent execution:", error)
        toast.error("Failed to load agent execution")
      } finally {
        setIsLoading(false)
      }
    }

    fetchExecution()
    
    // Poll for updates while execution is running
    const interval = setInterval(() => {
      if (execution?.status === 'running' || execution?.status === 'initializing') {
        fetchExecution()
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [executionId, execution?.status])

  const handleCancelExecution = async () => {
    if (!executionId || !execution) return

    try {
      await tipcClient.cancelAgentExecution({ executionId })
      toast.success("Agent execution cancelled")
    } catch (error) {
      toast.error("Failed to cancel execution")
    }
  }

  const toggleStepExpansion = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev)
      if (newSet.has(stepId)) {
        newSet.delete(stepId)
      } else {
        newSet.add(stepId)
      }
      return newSet
    })
  }

  const getStatusIcon = (status: AgentStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'running':
        return <Spinner className="h-4 w-4" />
      case 'pending':
        return <Clock className="h-4 w-4 text-gray-400" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStepIcon = (type: AgentStep['type']) => {
    switch (type) {
      case 'llm_call':
        return <Bot className="h-4 w-4 text-blue-500" />
      case 'tool_execution':
        return <Wrench className="h-4 w-4 text-orange-500" />
      case 'completion':
        return <Target className="h-4 w-4 text-green-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Spinner className="h-8 w-8" />
        </CardContent>
      </Card>
    )
  }

  if (!execution) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground text-center">
            No agent execution found
          </p>
        </CardContent>
      </Card>
    )
  }

  const progressPercentage = execution.progress.totalSteps > 0 
    ? (execution.progress.currentStep / execution.progress.totalSteps) * 100 
    : 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className="h-6 w-6 text-blue-500" />
              <div>
                <CardTitle className="text-lg">Agent Execution</CardTitle>
                <CardDescription className="text-sm">
                  {execution.goal}
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
              {onClose && (
                <Button variant="ghost" size="sm" onClick={onClose}>
                  ×
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{execution.progress.currentStep} / {execution.progress.totalSteps}</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
              <p className="text-sm text-muted-foreground">
                {execution.progress.currentStepDescription}
              </p>
            </div>

            {/* Execution Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Duration:</span>
                <span className="ml-2">{formatDuration(execution.startTime, execution.endTime)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Steps:</span>
                <span className="ml-2">{execution.steps.length}</span>
              </div>
            </div>

            {/* Controls */}
            {execution.status === 'running' && (
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleCancelExecution}
                  className="flex items-center gap-2"
                >
                  <Square className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
            )}

            {/* Final Result */}
            {execution.finalResult && (
              <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                <h4 className="font-medium text-green-800 dark:text-green-200 mb-2">Result</h4>
                <p className="text-sm text-green-700 dark:text-green-300">
                  {execution.finalResult}
                </p>
              </div>
            )}

            {/* Error */}
            {execution.error && (
              <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
                <h4 className="font-medium text-red-800 dark:text-red-200 mb-2">Error</h4>
                <p className="text-sm text-red-700 dark:text-red-300">
                  {execution.error}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {execution.steps.map((step) => (
              <div key={step.id} className="border rounded-lg">
                <div 
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => toggleStepExpansion(step.id)}
                >
                  <div className="flex items-center gap-2">
                    {getStatusIcon(step.status)}
                    {getStepIcon(step.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {step.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                  {expandedSteps.has(step.id) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </div>

                {expandedSteps.has(step.id) && (
                  <div className="px-3 pb-3 border-t bg-accent/20">
                    {step.llmResponse && (
                      <div className="mt-3">
                        <h5 className="text-xs font-medium text-muted-foreground mb-2">LLM Response</h5>
                        <p className="text-sm bg-background p-2 rounded border">
                          {step.llmResponse}
                        </p>
                      </div>
                    )}

                    {step.toolCalls && step.toolCalls.length > 0 && (
                      <div className="mt-3">
                        <h5 className="text-xs font-medium text-muted-foreground mb-2">Tool Calls</h5>
                        <div className="space-y-2">
                          {step.toolCalls.map((toolCall, tcIndex) => (
                            <div key={tcIndex} className="bg-background p-2 rounded border">
                              <div className="flex items-center gap-2 mb-1">
                                <Wrench className="h-3 w-3" />
                                <span className="text-xs font-medium">{toolCall.name}</span>
                              </div>
                              {toolCall.result && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {toolCall.result.content.map(c => c.text).join('\n')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {step.error && (
                      <div className="mt-3">
                        <h5 className="text-xs font-medium text-red-600 mb-2">Error</h5>
                        <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950 p-2 rounded border border-red-200 dark:border-red-800">
                          {step.error}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {execution.steps.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No steps executed yet</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
