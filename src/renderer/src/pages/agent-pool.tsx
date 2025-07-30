import React from "react"
import { Button } from "@renderer/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { AgentPoolDashboard } from "@renderer/components/agent-pool-dashboard"
import { CreateAgentDialog } from "@renderer/components/create-agent-dialog"
import { Plus, ArrowLeft, Activity, Users } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"

export function AgentPoolPage() {
  const navigate = useNavigate()

  // Get quick stats for the header
  const statsQuery = useQuery({
    queryKey: ["agent-pool", "stats"],
    queryFn: () => tipcClient.getAgentPoolStats(),
    refetchInterval: 5000
  })

  const stats = statsQuery.data

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/")}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              
              <div>
                <h1 className="text-2xl font-bold">Agent Pool</h1>
                <p className="text-muted-foreground">
                  Manage parallel AI agents with independent conversation threads
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Quick Stats */}
              {stats && (
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-green-500" />
                    <span className="font-medium">{stats.activeAgents}</span>
                    <span className="text-muted-foreground">active</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">{stats.totalAgents}</span>
                    <span className="text-muted-foreground">total</span>
                  </div>
                </div>
              )}

              <CreateAgentDialog
                trigger={
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    Create Agent
                  </Button>
                }
                onAgentCreated={(agentId) => {
                  console.log("Agent created:", agentId)
                  // Could navigate to agent detail view or show success message
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="space-y-8">
          {/* Welcome/Info Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Parallel Agent System
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <h4 className="font-medium mb-2">Independent Execution</h4>
                  <p className="text-sm text-muted-foreground">
                    Each agent runs in its own isolated environment with dedicated conversation history and resource management.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Concurrent Processing</h4>
                  <p className="text-sm text-muted-foreground">
                    Run multiple agents simultaneously to handle different tasks or explore various approaches in parallel.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Resource Monitoring</h4>
                  <p className="text-sm text-muted-foreground">
                    Monitor system resources, track performance metrics, and manage agent lifecycles from a unified dashboard.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dashboard */}
          <AgentPoolDashboard />

          {/* Usage Tips */}
          <Card>
            <CardHeader>
              <CardTitle>Usage Tips</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-1">Agent Templates</h4>
                  <p className="text-sm text-muted-foreground">
                    Use predefined templates for common tasks like research, coding, or data analysis. Each template comes with optimized prompts and iteration limits.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Resource Management</h4>
                  <p className="text-sm text-muted-foreground">
                    Monitor active processes and memory usage. The system automatically limits concurrent agents to prevent resource exhaustion.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Conversation Continuity</h4>
                  <p className="text-sm text-muted-foreground">
                    Each agent maintains its own conversation thread. You can continue conversations with completed agents or spawn new agents from existing conversations.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Emergency Controls</h4>
                  <p className="text-sm text-muted-foreground">
                    Use the "Stop All" button or individual agent controls to halt processing. The system includes automatic cleanup for completed agents.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
