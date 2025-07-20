import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Button } from "@renderer/components/ui/button"
import { Badge } from "@renderer/components/ui/badge"
import { Input } from "@renderer/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@renderer/components/ui/dialog"
import { 
  Bot, 
  Play, 
  Eye, 
  Trash2, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Pause,
  AlertCircle,
  Plus
} from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { rendererHandlers } from "@renderer/lib/tipc-client"
import { AgentChainExecution } from "@shared/types"
import { AgentChainProgress } from "./agent-chain-progress"
import { toast } from "sonner"

export function AgentChainDashboard() {
  const [activeChains, setActiveChains] = useState<AgentChainExecution[]>([])
  const [selectedChain, setSelectedChain] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newGoal, setNewGoal] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  // Load active chains
  useEffect(() => {
    loadActiveChains()
    const interval = setInterval(loadActiveChains, 5000) // Refresh every 5 seconds
    return () => clearInterval(interval)
  }, [])

  // Listen for progress updates
  useEffect(() => {
    const unlisten = rendererHandlers.agentChainProgress.listen(() => {
      // Refresh the list when we get updates
      loadActiveChains()
    })

    return unlisten
  }, [])

  const loadActiveChains = async () => {
    try {
      const chains = await tipcClient.getAllActiveAgentChains()
      setActiveChains(chains || [])
    } catch (error) {
      console.error("Failed to load active chains:", error)
    }
  }

  const handleCreateChain = async () => {
    if (!newGoal.trim()) {
      toast.error("Please enter a goal")
      return
    }

    try {
      setIsLoading(true)
      const result = await tipcClient.startAgentChain({ goal: newGoal.trim() })
      toast.success("Agent chain started successfully")
      setNewGoal("")
      setShowCreateDialog(false)
      setSelectedChain(result.chainId)
      loadActiveChains()
    } catch (error) {
      toast.error("Failed to start agent chain")
      console.error("Failed to start chain:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleStopChain = async (chainId: string) => {
    try {
      await tipcClient.stopAgentChain({ chainId })
      toast.success("Chain stopped")
      loadActiveChains()
    } catch (error) {
      toast.error("Failed to stop chain")
    }
  }

  const handlePauseChain = async (chainId: string) => {
    try {
      await tipcClient.pauseAgentChain({ chainId })
      toast.success("Chain paused")
      loadActiveChains()
    } catch (error) {
      toast.error("Failed to pause chain")
    }
  }

  const handleResumeChain = async (chainId: string) => {
    try {
      await tipcClient.resumeAgentChain({ chainId })
      toast.success("Chain resumed")
      loadActiveChains()
    } catch (error) {
      toast.error("Failed to resume chain")
    }
  }

  const getStatusIcon = (status: AgentChainExecution['status']) => {
    switch (status) {
      case 'running':
        return <Play className="h-4 w-4 text-blue-500" />
      case 'paused':
        return <Pause className="h-4 w-4 text-yellow-500" />
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'stopped':
        return <AlertCircle className="h-4 w-4 text-gray-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Agent Chain Dashboard
              </CardTitle>
              <CardDescription>
                Monitor and manage autonomous agent chain executions
              </CardDescription>
            </div>
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Start New Chain
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Start New Agent Chain</DialogTitle>
                  <DialogDescription>
                    Enter a high-level goal for the agent to accomplish autonomously.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="goal" className="text-sm font-medium">
                      Goal
                    </label>
                    <Input
                      id="goal"
                      value={newGoal}
                      onChange={(e) => setNewGoal(e.target.value)}
                      placeholder="e.g., Create a new project folder and add a README file"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleCreateChain()
                        }
                      }}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateChain} disabled={isLoading || !newGoal.trim()}>
                      {isLoading ? "Starting..." : "Start Chain"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {activeChains.length === 0 ? (
            <div className="text-center py-8">
              <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No active agent chains</p>
              <p className="text-sm text-muted-foreground mt-2">
                Start a new chain or use Ctrl+Alt+Shift+/ to record a voice goal
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeChains.map((chain) => (
                <div key={chain.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(chain.status)}
                      <div>
                        <h4 className="font-medium">{chain.goal}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          {getStatusBadge(chain.status)}
                          <span className="text-sm text-muted-foreground">
                            {chain.steps.length} steps • {formatDuration(chain.startTime, chain.endTime)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedChain(chain.id)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View
                      </Button>
                      {chain.status === 'running' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePauseChain(chain.id)}
                        >
                          <Pause className="h-4 w-4 mr-2" />
                          Pause
                        </Button>
                      )}
                      {chain.status === 'paused' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResumeChain(chain.id)}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Resume
                        </Button>
                      )}
                      {(chain.status === 'running' || chain.status === 'paused') && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleStopChain(chain.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Stop
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress Dialog */}
      {selectedChain && (
        <Dialog open={!!selectedChain} onOpenChange={() => setSelectedChain(null)}>
          <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
            <AgentChainProgress 
              chainId={selectedChain} 
              onClose={() => setSelectedChain(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
