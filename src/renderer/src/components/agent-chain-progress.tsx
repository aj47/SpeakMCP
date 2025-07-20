import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Button } from "@renderer/components/ui/button"
import { Badge } from "@renderer/components/ui/badge"
import { Progress } from "@renderer/components/ui/progress"
import { 
  Play, 
  Pause, 
  Square, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Zap, 
  Brain,
  AlertCircle,
  ChevronDown,
  ChevronRight
} from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { rendererHandlers } from "@renderer/lib/tipc-client"
import { AgentChainExecution, AgentChainStep } from "@shared/types"
import { toast } from "sonner"

interface AgentChainProgressUpdate {
  chainId: string
  status: AgentChainExecution['status']
  currentStep?: AgentChainStep
  totalSteps: number
  completedSteps: number
}

interface AgentChainProgressProps {
  chainId?: string
  onClose?: () => void
}

export function AgentChainProgress({ chainId, onClose }: AgentChainProgressProps) {
  const [execution, setExecution] = useState<AgentChainExecution | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)

  // Load initial execution data
  useEffect(() => {
    if (chainId) {
      loadExecution(chainId)
    }
  }, [chainId])

  // Listen for progress updates
  useEffect(() => {
    const unlisten = rendererHandlers.agentChainProgress.listen((update: AgentChainProgressUpdate) => {
      if (!chainId || update.chainId === chainId) {
        // Update the execution with new step data
        setExecution(prev => {
          if (!prev) return prev
          
          return {
            ...prev,
            status: update.status,
            steps: update.currentStep 
              ? [...prev.steps.filter(s => s.id !== update.currentStep!.id), update.currentStep]
              : prev.steps,
            totalSteps: update.totalSteps,
            currentStep: update.currentStep?.id
          }
        })
      }
    })

    return unlisten
  }, [chainId])

  const loadExecution = async (id: string) => {
    try {
      setIsLoading(true)
      const result = await tipcClient.getAgentChainExecution({ chainId: id })
      setExecution(result || null)
    } catch (error) {
      console.error("Failed to load chain execution:", error)
      toast.error("Failed to load chain execution")
    } finally {
      setIsLoading(false)
    }
  }

  const handlePause = async () => {
    if (!execution) return
    try {
      await tipcClient.pauseAgentChain({ chainId: execution.id })
      toast.success("Chain paused")
    } catch (error) {
      toast.error("Failed to pause chain")
    }
  }

  const handleResume = async () => {
    if (!execution) return
    try {
      await tipcClient.resumeAgentChain({ chainId: execution.id })
      toast.success("Chain resumed")
    } catch (error) {
      toast.error("Failed to resume chain")
    }
  }

  const handleStop = async () => {
    if (!execution) return
    try {
      await tipcClient.stopAgentChain({ chainId: execution.id })
      toast.success("Chain stopped")
    } catch (error) {
      toast.error("Failed to stop chain")
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

  const getStepIcon = (step: AgentChainStep) => {
    switch (step.type) {
      case 'llm_decision':
        return <Brain className="h-4 w-4" />
      case 'tool_execution':
        return <Zap className="h-4 w-4" />
      case 'analysis':
        return <Clock className="h-4 w-4" />
      case 'completion':
        return <CheckCircle className="h-4 w-4" />
      case 'error':
        return <XCircle className="h-4 w-4" />
      default:
        return <Clock className="h-4 w-4" />
    }
  }

  const getStepColor = (step: AgentChainStep) => {
    switch (step.type) {
      case 'llm_decision':
        return 'bg-blue-500'
      case 'tool_execution':
        return 'bg-green-500'
      case 'analysis':
        return 'bg-yellow-500'
      case 'completion':
        return 'bg-emerald-500'
      case 'error':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  const getStatusBadge = (status: AgentChainExecution['status']) => {
    switch (status) {
      case 'running':
        return <Badge variant="default" className="bg-blue-500">Running</Badge>
      case 'paused':
        return <Badge variant="secondary">Paused</Badge>
      case 'completed':
        return <Badge variant="default" className="bg-green-500">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'stopped':
        return <Badge variant="outline">Stopped</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
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
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading chain execution...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!execution) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No chain execution found</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const completedSteps = execution.steps.filter(s => s.type !== 'error').length
  const progressPercentage = execution.totalSteps > 0 ? (completedSteps / execution.totalSteps) * 100 : 0

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Agent Chain Execution
              {getStatusBadge(execution.status)}
            </CardTitle>
            <CardDescription className="mt-2">
              <strong>Goal:</strong> {execution.goal}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {execution.status === 'running' && (
              <Button variant="outline" size="sm" onClick={handlePause}>
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </Button>
            )}
            {execution.status === 'paused' && (
              <Button variant="outline" size="sm" onClick={handleResume}>
                <Play className="h-4 w-4 mr-2" />
                Resume
              </Button>
            )}
            {(execution.status === 'running' || execution.status === 'paused') && (
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            )}
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Overview */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progress</span>
            <span>{completedSteps} / {execution.totalSteps} steps</span>
          </div>
          <Progress value={progressPercentage} className="w-full" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Duration: {formatDuration(execution.startTime, execution.endTime)}</span>
            <span>Max iterations: {execution.maxIterations}</span>
          </div>
        </div>

        {/* Steps Timeline */}
        <div className="space-y-3">
          <h4 className="font-medium">Execution Steps</h4>
          <div className="space-y-2">
            {execution.steps.map((step) => (
              <div key={step.id} className="border rounded-lg p-3">
                <div 
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => toggleStepExpansion(step.id)}
                >
                  <div className={`w-2 h-2 rounded-full ${getStepColor(step)}`} />
                  <div className="flex items-center gap-2">
                    {getStepIcon(step)}
                    <span className="font-medium capitalize">{step.type.replace('_', ' ')}</span>
                  </div>
                  <div className="flex-1 text-sm text-muted-foreground">
                    {step.description}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(step.timestamp).toLocaleTimeString()}
                  </div>
                  {expandedSteps.has(step.id) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </div>

                {expandedSteps.has(step.id) && (
                  <div className="mt-3 pl-7 space-y-2 text-sm">
                    {step.toolCall && (
                      <div>
                        <strong>Tool Call:</strong>
                        <pre className="bg-muted p-2 rounded text-xs mt-1 overflow-x-auto">
                          {JSON.stringify(step.toolCall, null, 2)}
                        </pre>
                      </div>
                    )}
                    {step.result && (
                      <div>
                        <strong>Result:</strong>
                        <div className={`p-2 rounded text-xs mt-1 ${step.result.isError ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
                          {step.result.content}
                        </div>
                      </div>
                    )}
                    {step.llmResponse && (
                      <div>
                        <strong>LLM Response:</strong>
                        <div className="bg-blue-50 text-blue-800 p-2 rounded text-xs mt-1">
                          {step.llmResponse.reasoning || step.llmResponse.content}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
