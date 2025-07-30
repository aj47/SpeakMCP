import { EventEmitter } from "events"
import { ChildProcess } from "child_process"
import { MCPTool, MCPToolCall, MCPToolResult } from "./mcp-service"
import { processTranscriptWithAgentMode, AgentModeResponse } from "./llm"
import { conversationService } from "./conversation-service"
import { mcpService } from "./mcp-service"
import { Conversation } from "../shared/types"
import { diagnosticsService } from "./diagnostics"

export interface AgentInstance {
  id: string
  conversationId: string
  status: "idle" | "processing" | "completed" | "error" | "stopped"
  createdAt: number
  startedAt?: number
  completedAt?: number
  currentIteration: number
  maxIterations: number
  processes: Set<ChildProcess>
  metadata: {
    initialPrompt: string
    totalTokens?: number
    model?: string
    provider?: string
  }
}

export interface AgentPoolStats {
  totalAgents: number
  activeAgents: number
  completedAgents: number
  erroredAgents: number
  averageCompletionTime: number
  totalResourceUsage: {
    processes: number
    conversations: number
  }
}

export class AgentPoolService extends EventEmitter {
  private static instance: AgentPoolService | null = null
  private agents: Map<string, AgentInstance> = new Map()
  private maxConcurrentAgents: number = 5
  private cleanupInterval: NodeJS.Timeout | null = null

  static getInstance(): AgentPoolService {
    if (!AgentPoolService.instance) {
      AgentPoolService.instance = new AgentPoolService()
    }
    return AgentPoolService.instance
  }

  private constructor() {
    super()
    this.startCleanupTimer()
  }

  private generateAgentId(): string {
    return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private startCleanupTimer() {
    // Clean up completed agents every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupCompletedAgents()
    }, 5 * 60 * 1000)
  }

  private cleanupCompletedAgents() {
    const now = Date.now()
    const maxAge = 30 * 60 * 1000 // 30 minutes

    for (const [agentId, agent] of this.agents.entries()) {
      if (
        (agent.status === "completed" || agent.status === "error") &&
        agent.completedAt &&
        now - agent.completedAt > maxAge
      ) {
        this.cleanupAgent(agentId)
      }
    }
  }

  private cleanupAgent(agentId: string) {
    const agent = this.agents.get(agentId)
    if (!agent) return

    // Kill any remaining processes
    for (const process of agent.processes) {
      try {
        if (!process.killed) {
          process.kill('SIGTERM')
        }
      } catch (error) {
        diagnosticsService.logError('agent-pool', `Failed to kill process for agent ${agentId}`, error)
      }
    }

    this.agents.delete(agentId)
    this.emit('agentCleaned', agentId)
  }

  async createAgent(
    initialPrompt: string,
    options: {
      maxIterations?: number
      conversationId?: string
      metadata?: Partial<AgentInstance['metadata']>
    } = {}
  ): Promise<string> {
    if (this.getActiveAgentCount() >= this.maxConcurrentAgents) {
      throw new Error(`Maximum concurrent agents limit reached (${this.maxConcurrentAgents})`)
    }

    const agentId = this.generateAgentId()
    const now = Date.now()

    // Create or use existing conversation
    let conversationId = options.conversationId
    if (!conversationId) {
      const conversation = await conversationService.createConversation(initialPrompt, "user")
      conversationId = conversation.id
    }

    const agent: AgentInstance = {
      id: agentId,
      conversationId,
      status: "idle",
      createdAt: now,
      currentIteration: 0,
      maxIterations: options.maxIterations || 10,
      processes: new Set(),
      metadata: {
        initialPrompt,
        ...options.metadata
      }
    }

    this.agents.set(agentId, agent)
    this.emit('agentCreated', agent)

    return agentId
  }

  async startAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }

    if (agent.status !== "idle") {
      throw new Error(`Agent ${agentId} is not in idle state`)
    }

    agent.status = "processing"
    agent.startedAt = Date.now()
    this.emit('agentStarted', agent)

    try {
      // Load conversation history
      const conversation = await conversationService.loadConversation(agent.conversationId)
      if (!conversation) {
        throw new Error(`Conversation ${agent.conversationId} not found`)
      }

      // Convert conversation to agent mode format
      const previousHistory = conversation.messages.slice(0, -1).map(msg => ({
        role: msg.role,
        content: msg.content,
        toolCalls: msg.toolCalls,
        toolResults: msg.toolResults
      }))

      // Get available tools
      const availableTools = mcpService.getAvailableTools()

      // Create tool execution function with process tracking
      const executeToolCall = async (toolCall: MCPToolCall): Promise<MCPToolResult> => {
        const result = await mcpService.executeToolCall(toolCall)
        
        // Track any new processes created during tool execution
        // This would need integration with MCP service to track processes
        
        return result
      }

      // Start agent processing
      const result = await processTranscriptWithAgentMode(
        agent.metadata.initialPrompt,
        availableTools,
        executeToolCall,
        agent.maxIterations,
        previousHistory
      )

      // Update agent status
      agent.status = "completed"
      agent.completedAt = Date.now()
      agent.currentIteration = result.totalIterations

      // Update conversation with final result
      await conversationService.addMessageToConversation(
        agent.conversationId,
        result.content,
        "assistant"
      )

      this.emit('agentCompleted', agent, result)

    } catch (error) {
      agent.status = "error"
      agent.completedAt = Date.now()
      
      diagnosticsService.logError('agent-pool', `Agent ${agentId} failed`, error)
      this.emit('agentError', agent, error)
      
      throw error
    }
  }

  async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }

    if (agent.status !== "processing") {
      return // Already stopped or not running
    }

    agent.status = "stopped"
    agent.completedAt = Date.now()

    // Kill all processes associated with this agent
    for (const process of agent.processes) {
      try {
        if (!process.killed) {
          process.kill('SIGTERM')
        }
      } catch (error) {
        diagnosticsService.logError('agent-pool', `Failed to stop process for agent ${agentId}`, error)
      }
    }

    this.emit('agentStopped', agent)
  }

  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId)
  }

  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values())
  }

  getActiveAgents(): AgentInstance[] {
    return this.getAllAgents().filter(agent => agent.status === "processing")
  }

  getActiveAgentCount(): number {
    return this.getActiveAgents().length
  }

  getStats(): AgentPoolStats {
    const agents = this.getAllAgents()
    const completedAgents = agents.filter(a => a.status === "completed")
    
    const totalCompletionTime = completedAgents.reduce((sum, agent) => {
      if (agent.startedAt && agent.completedAt) {
        return sum + (agent.completedAt - agent.startedAt)
      }
      return sum
    }, 0)

    const averageCompletionTime = completedAgents.length > 0 
      ? totalCompletionTime / completedAgents.length 
      : 0

    const totalProcesses = agents.reduce((sum, agent) => sum + agent.processes.size, 0)

    return {
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status === "processing").length,
      completedAgents: agents.filter(a => a.status === "completed").length,
      erroredAgents: agents.filter(a => a.status === "error").length,
      averageCompletionTime,
      totalResourceUsage: {
        processes: totalProcesses,
        conversations: agents.length
      }
    }
  }

  setMaxConcurrentAgents(max: number) {
    this.maxConcurrentAgents = Math.max(1, Math.min(max, 20)) // Limit between 1-20
  }

  getMaxConcurrentAgents(): number {
    return this.maxConcurrentAgents
  }

  async stopAllAgents(): Promise<void> {
    const activeAgents = this.getActiveAgents()
    await Promise.all(activeAgents.map(agent => this.stopAgent(agent.id)))
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // Stop all agents
    this.stopAllAgents().catch(error => {
      diagnosticsService.logError('agent-pool', 'Failed to stop all agents during destroy', error)
    })

    this.removeAllListeners()
  }
}

export const agentPoolService = AgentPoolService.getInstance()
