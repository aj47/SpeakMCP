import { configStore } from "./config"
import { mcpService, MCPTool, MCPToolCall, MCPToolResult } from "./mcp-service"
import { AgentExecutionState, AgentStep, AgentProgress } from "../shared/types"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { v4 as uuidv4 } from "uuid"

export interface AgentLLMResponse {
  content?: string
  toolCalls?: MCPToolCall[]
  shouldContinue: boolean
  reasoning?: string
}

class AgentService {
  private activeExecutions: Map<string, AgentExecutionState> = new Map()
  private executionTimeouts: Map<string, NodeJS.Timeout> = new Map()

  async startAgentExecution(goal: string): Promise<string> {
    const config = configStore.get()
    
    if (!config.agentChainingEnabled) {
      throw new Error("Agent chaining is not enabled")
    }

    const executionId = uuidv4()
    const execution: AgentExecutionState = {
      id: executionId,
      goal,
      status: 'initializing',
      startTime: Date.now(),
      steps: [],
      progress: {
        currentStep: 0,
        totalSteps: 1, // Will be updated as we go
        currentStepDescription: 'Initializing agent execution...'
      },
      conversationHistory: [
        {
          role: 'system',
          content: this.getSystemPrompt()
        },
        {
          role: 'user',
          content: goal
        }
      ]
    }

    this.activeExecutions.set(executionId, execution)
    
    // Set timeout
    const timeoutMinutes = config.agentChainingTimeoutMinutes || 10
    const timeout = setTimeout(() => {
      this.cancelExecution(executionId, 'Execution timed out')
    }, timeoutMinutes * 60 * 1000)
    this.executionTimeouts.set(executionId, timeout)

    // Start execution in background
    this.executeAgent(executionId).catch(error => {
      console.error(`[AGENT] Execution ${executionId} failed:`, error)
      this.updateExecutionStatus(executionId, 'failed', error.message)
    })

    return executionId
  }

  private async executeAgent(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId)
    if (!execution) return

    const config = configStore.get()
    const maxSteps = config.agentChainingMaxSteps || 10
    let stepCount = 0

    this.updateExecutionStatus(executionId, 'running')

    while (stepCount < maxSteps && execution.status === 'running') {
      stepCount++
      
      // Create new step
      const step: AgentStep = {
        id: uuidv4(),
        type: 'llm_call',
        status: 'running',
        timestamp: Date.now(),
        description: `Step ${stepCount}: Analyzing situation and planning next actions`
      }

      this.addStep(executionId, step)
      this.updateProgress(executionId, stepCount, maxSteps, step.description)

      try {
        // Get available tools
        const availableTools = mcpService.getAvailableTools()
        
        // Make LLM call
        const llmResponse = await this.callLLMWithTools(execution.conversationHistory, availableTools)
        
        step.llmResponse = llmResponse.content
        step.status = 'completed'
        this.updateStep(executionId, step)

        // Add LLM response to conversation history
        if (llmResponse.content) {
          execution.conversationHistory.push({
            role: 'assistant',
            content: llmResponse.content,
            toolCalls: llmResponse.toolCalls
          })
        }

        // Execute tool calls if any
        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          const toolStep: AgentStep = {
            id: uuidv4(),
            type: 'tool_execution',
            status: 'running',
            timestamp: Date.now(),
            description: `Executing ${llmResponse.toolCalls.length} tool(s): ${llmResponse.toolCalls.map(tc => tc.name).join(', ')}`,
            toolCalls: llmResponse.toolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments }))
          }

          this.addStep(executionId, toolStep)

          // Execute tools
          const toolResults: MCPToolResult[] = []
          for (const toolCall of llmResponse.toolCalls) {
            const result = await mcpService.executeToolCall(toolCall)
            toolResults.push(result)
          }

          // Update tool step with results
          toolStep.toolCalls = llmResponse.toolCalls.map((tc, index) => ({
            name: tc.name,
            arguments: tc.arguments,
            result: toolResults[index]
          }))
          toolStep.status = 'completed'
          this.updateStep(executionId, toolStep)

          // Add tool results to conversation history
          for (let i = 0; i < toolResults.length; i++) {
            const result = toolResults[i]
            execution.conversationHistory.push({
              role: 'tool',
              content: result.content.map(c => c.text).join('\n'),
              toolCallId: `tool_${i}`
            })
          }
        }

        // Check if we should continue
        if (!llmResponse.shouldContinue) {
          const completionStep: AgentStep = {
            id: uuidv4(),
            type: 'completion',
            status: 'completed',
            timestamp: Date.now(),
            description: 'Goal completed successfully'
          }
          this.addStep(executionId, completionStep)
          
          execution.finalResult = llmResponse.content || 'Task completed'
          this.updateExecutionStatus(executionId, 'completed')
          break
        }

      } catch (error) {
        step.status = 'failed'
        step.error = error instanceof Error ? error.message : String(error)
        this.updateStep(executionId, step)
        throw error
      }
    }

    if (stepCount >= maxSteps && execution.status === 'running') {
      this.updateExecutionStatus(executionId, 'failed', 'Maximum steps reached')
    }
  }

  private async callLLMWithTools(
    conversationHistory: AgentExecutionState['conversationHistory'],
    availableTools: MCPTool[]
  ): Promise<AgentLLMResponse> {
    const config = configStore.get()
    const chatProviderId = config.agentChainingProviderId || config.mcpToolsProviderId || "groq"

    // Create tools description for the LLM
    const toolsDescription = availableTools.length > 0 
      ? `\n\nAvailable tools:\n${availableTools.map(tool => 
          `- ${tool.name}: ${tool.description}`
        ).join('\n')}`
      : ""

    const messages = conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content + (msg.role === 'system' ? toolsDescription : '')
    }))

    // Add instruction for the LLM to decide when to continue
    messages.push({
      role: 'system',
      content: `
After analyzing the current situation and any tool results, decide whether to:
1. Continue with more actions (respond with your next steps and any tool calls needed)
2. Complete the task (respond with a summary and set shouldContinue to false)

Always end your response with either:
- "CONTINUE: [reason why you need to continue]" if more work is needed
- "COMPLETE: [summary of what was accomplished]" if the goal is achieved

If you need to use tools, specify them in your response.`
    })

    if (chatProviderId === "gemini") {
      // Handle Gemini API
      if (!config.geminiApiKey) throw new Error("Gemini API key is required")
      
      const gai = new GoogleGenerativeAI(config.geminiApiKey)
      const model = config.agentChainingGeminiModel || "gemini-1.5-flash-002"
      const gModel = gai.getGenerativeModel({ model })

      const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n')
      const result = await gModel.generateContent([prompt])
      const response = result.response.text()

      return this.parseAgentResponse(response, availableTools)
    }

    // Handle OpenAI/Groq API
    const chatBaseUrl = chatProviderId === "groq" 
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

    const model = chatProviderId === "groq"
      ? config.agentChainingGroqModel || "gemma2-9b-it"
      : config.agentChainingOpenaiModel || "gpt-4o-mini"

    const response = await fetch(`${chatBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chatProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        temperature: 0.1,
        model,
        messages,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`${response.statusText} ${errorText.slice(0, 300)}`)
    }

    const chatJson = await response.json()
    const content = chatJson.choices[0].message.content

    return this.parseAgentResponse(content, availableTools)
  }

  private parseAgentResponse(content: string, availableTools: MCPTool[]): AgentLLMResponse {
    const shouldContinue = content.includes("CONTINUE:") && !content.includes("COMPLETE:")
    
    // Simple tool call parsing - look for tool names mentioned in the response
    const toolCalls: MCPToolCall[] = []
    
    for (const tool of availableTools) {
      if (content.toLowerCase().includes(tool.name.toLowerCase())) {
        // This is a simplified approach - in a real implementation, you'd want
        // more sophisticated parsing or use function calling APIs
        toolCalls.push({
          name: tool.name,
          arguments: {} // Would need better argument parsing
        })
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      shouldContinue
    }
  }

  private getSystemPrompt(): string {
    const config = configStore.get()
    return config.agentChainingSystemPrompt || `You are an intelligent agent that can execute multiple steps to accomplish complex goals. 

You have access to various tools that can help you complete tasks. Analyze the user's goal, break it down into steps, and execute them systematically.

For each step:
1. Analyze what needs to be done
2. Use appropriate tools if needed
3. Evaluate the results
4. Decide whether to continue or if the goal is complete

Be thorough but efficient. Always explain your reasoning and next steps clearly.`
  }

  // Helper methods for updating execution state
  private updateExecutionStatus(executionId: string, status: AgentExecutionState['status'], error?: string) {
    const execution = this.activeExecutions.get(executionId)
    if (!execution) return

    execution.status = status
    if (error) execution.error = error
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      execution.endTime = Date.now()
      // Clear timeout
      const timeout = this.executionTimeouts.get(executionId)
      if (timeout) {
        clearTimeout(timeout)
        this.executionTimeouts.delete(executionId)
      }
    }
  }

  private addStep(executionId: string, step: AgentStep) {
    const execution = this.activeExecutions.get(executionId)
    if (!execution) return

    execution.steps.push(step)
  }

  private updateStep(executionId: string, updatedStep: AgentStep) {
    const execution = this.activeExecutions.get(executionId)
    if (!execution) return

    const stepIndex = execution.steps.findIndex(s => s.id === updatedStep.id)
    if (stepIndex >= 0) {
      execution.steps[stepIndex] = updatedStep
    }
  }

  private updateProgress(executionId: string, currentStep: number, totalSteps: number, description: string) {
    const execution = this.activeExecutions.get(executionId)
    if (!execution) return

    execution.progress = {
      currentStep,
      totalSteps,
      currentStepDescription: description
    }
  }

  // Public methods for external access
  getExecution(executionId: string): AgentExecutionState | undefined {
    return this.activeExecutions.get(executionId)
  }

  getAllActiveExecutions(): AgentExecutionState[] {
    return Array.from(this.activeExecutions.values())
  }

  cancelExecution(executionId: string, reason?: string): boolean {
    const execution = this.activeExecutions.get(executionId)
    if (!execution || execution.status !== 'running') return false

    this.updateExecutionStatus(executionId, 'cancelled', reason)
    return true
  }

  cleanupCompletedExecutions(olderThanHours: number = 24) {
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000)
    
    for (const [id, execution] of this.activeExecutions.entries()) {
      if (execution.status !== 'running' && execution.startTime < cutoffTime) {
        this.activeExecutions.delete(id)
      }
    }
  }
}

export const agentService = new AgentService()
