import { configStore } from "./config"
import { mcpService, MCPToolCall, MCPToolResult } from "./mcp-service"
import { processTranscriptWithTools } from "./llm"
import { AgentChainExecution, AgentChainStep, AgentChainConfig } from "../shared/types"
import { getRendererHandlers } from "@egoist/tipc/main"
import { RendererHandlers } from "./renderer-handlers"
import { WINDOWS } from "./window"

export interface AgentChainProgressUpdate {
  chainId: string
  status: AgentChainExecution['status']
  currentStep?: AgentChainStep
  totalSteps: number
  completedSteps: number
}

class AgentChainService {
  private activeChains: Map<string, AgentChainExecution> = new Map()
  private chainTimeouts: Map<string, NodeJS.Timeout> = new Map()

  private getDefaultConfig(): AgentChainConfig {
    return {
      enabled: true,
      maxIterations: 10,
      timeoutMs: 300000, // 5 minutes
      systemPrompt: `You are an autonomous AI agent that can execute tools to accomplish user goals.

IMPORTANT INSTRUCTIONS:
1. You will receive a high-level goal from the user
2. Break down the goal into actionable steps
3. Execute tools one at a time to accomplish the goal
4. After each tool execution, analyze the result and decide the next action
5. Continue until the goal is complete or you encounter an unrecoverable error

RESPONSE FORMAT:
You must respond with ONLY a valid JSON object in one of these formats:

For tool execution:
{
  "action": "execute_tool",
  "toolCall": {
    "name": "exact_tool_name",
    "arguments": { "param1": "value1" }
  },
  "reasoning": "Why you're executing this tool",
  "nextSteps": "What you plan to do after this"
}

For goal completion:
{
  "action": "complete",
  "reasoning": "Why the goal is now complete",
  "summary": "Summary of what was accomplished"
}

For error/failure:
{
  "action": "error",
  "reasoning": "What went wrong and why you cannot continue",
  "error": "Error description"
}

CRITICAL RULES:
- Use EXACT tool names from the available tools list
- Always provide clear reasoning for your decisions
- If a tool fails, try alternative approaches before giving up
- Keep track of what you've already tried to avoid loops
- Be efficient and focused on the user's goal`,
      enableProgressTracking: true
    }
  }

  async startChain(goal: string): Promise<string> {
    const config = configStore.get()
    const chainConfig = config.agentChainConfig || this.getDefaultConfig()

    if (!chainConfig.enabled) {
      throw new Error("Agent chaining is disabled")
    }

    // Initialize MCP service
    await mcpService.initialize()
    const availableTools = mcpService.getAvailableTools()

    if (availableTools.length === 0) {
      throw new Error("No tools available for agent chaining")
    }

    const chainId = `chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const execution: AgentChainExecution = {
      id: chainId,
      goal,
      startTime: Date.now(),
      status: 'running',
      steps: [],
      totalSteps: 0,
      maxIterations: chainConfig.maxIterations,
      timeoutMs: chainConfig.timeoutMs
    }

    this.activeChains.set(chainId, execution)

    // Set timeout for the entire chain
    const timeout = setTimeout(() => {
      this.stopChain(chainId, 'failed', 'Chain execution timed out')
    }, chainConfig.timeoutMs)
    this.chainTimeouts.set(chainId, timeout)

    // Start the chain execution
    this.executeChainStep(chainId, goal, availableTools, [])
      .catch(error => {
        console.error(`[AGENT-CHAIN] Chain ${chainId} failed:`, error)
        this.stopChain(chainId, 'failed', error instanceof Error ? error.message : String(error))
      })

    return chainId
  }

  private async executeChainStep(
    chainId: string,
    currentInput: string,
    availableTools: any[],
    conversationHistory: Array<{ role: string; content: string }>
  ): Promise<void> {
    const execution = this.activeChains.get(chainId)
    if (!execution || execution.status !== 'running') {
      return
    }

    // Check iteration limit
    if (execution.steps.length >= execution.maxIterations) {
      this.stopChain(chainId, 'completed', 'Maximum iterations reached')
      return
    }

    const config = configStore.get()
    const chainConfig = config.agentChainConfig || this.getDefaultConfig()

    // Create step for LLM decision
    const decisionStep: AgentChainStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'llm_decision',
      description: 'Analyzing situation and deciding next action'
    }

    execution.steps.push(decisionStep)
    execution.currentStep = decisionStep.id
    execution.totalSteps = execution.steps.length
    this.sendProgressUpdate(execution)

    try {
      // Build conversation context
      const messages = [
        {
          role: 'system',
          content: `${chainConfig.systemPrompt}

Available tools:
${availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

Current goal: ${execution.goal}
Current input: ${currentInput}`
        },
        ...conversationHistory,
        {
          role: 'user',
          content: currentInput
        }
      ]

      // Get LLM decision using a specialized prompt for agent chaining
      const agentPrompt = `${chainConfig.systemPrompt}

Available tools:
${availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

Current goal: ${execution.goal}
Current situation: ${currentInput}

Previous conversation:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Please analyze the situation and decide what to do next. Respond with ONLY a valid JSON object.`

      // Use a simple LLM call instead of processTranscriptWithTools
      const config = configStore.get()
      const chatProviderId = config.mcpToolsProviderId || "openai"

      let llmResponseText = ""

      if (chatProviderId === "gemini") {
        const { GoogleGenerativeAI } = await import("@google/generative-ai")
        if (!config.geminiApiKey) throw new Error("Gemini API key is required")

        const gai = new GoogleGenerativeAI(config.geminiApiKey)
        const geminiModel = config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
        const gModel = gai.getGenerativeModel({ model: geminiModel })

        const result = await gModel.generateContent([agentPrompt], {
          baseUrl: config.geminiBaseUrl,
        })
        llmResponseText = result.response.text().trim()
      } else {
        const chatBaseUrl = chatProviderId === "groq"
          ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
          : config.openaiBaseUrl || "https://api.openai.com/v1"

        const model = chatProviderId === "groq"
          ? config.mcpToolsGroqModel || "gemma2-9b-it"
          : config.mcpToolsOpenaiModel || "gpt-4o-mini"

        const chatResponse = await fetch(`${chatBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${chatProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            temperature: 0,
            model,
            messages: [
              {
                role: "user",
                content: agentPrompt
              }
            ],
          }),
        })

        if (!chatResponse.ok) {
          const errorText = await chatResponse.text()
          throw new Error(`LLM request failed: ${chatResponse.statusText} ${errorText.slice(0, 300)}`)
        }

        const chatJson = await chatResponse.json()
        llmResponseText = chatJson.choices[0].message.content.trim()
      }

      let decision: any
      try {
        // Try to parse the LLM response as JSON
        decision = JSON.parse(llmResponseText)
      } catch (parseError) {
        // If parsing fails, try to extract JSON from the response
        const jsonMatch = llmResponseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          decision = JSON.parse(jsonMatch[0])
        } else {
          throw new Error(`Invalid LLM response format: ${llmResponseText}`)
        }
      }

      decisionStep.llmResponse = {
        content: llmResponseText,
        reasoning: decision.reasoning
      }

      // Process the decision
      await this.processAgentDecision(chainId, decision, availableTools, conversationHistory)

    } catch (error) {
      console.error(`[AGENT-CHAIN] Step failed for chain ${chainId}:`, error)
      decisionStep.type = 'error'
      decisionStep.description = `Error: ${error instanceof Error ? error.message : String(error)}`
      this.stopChain(chainId, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async processAgentDecision(
    chainId: string,
    decision: any,
    availableTools: any[],
    conversationHistory: Array<{ role: string; content: string }>
  ): Promise<void> {
    const execution = this.activeChains.get(chainId)
    if (!execution || execution.status !== 'running') {
      return
    }

    switch (decision.action) {
      case 'execute_tool':
        await this.executeToolStep(chainId, decision, availableTools, conversationHistory)
        break

      case 'complete':
        this.completeChain(chainId, decision.summary || 'Goal completed')
        break

      case 'error':
        this.stopChain(chainId, 'failed', decision.error || 'Agent reported an error')
        break

      default:
        this.stopChain(chainId, 'failed', `Unknown action: ${decision.action}`)
    }
  }

  private async executeToolStep(
    chainId: string,
    decision: any,
    availableTools: any[],
    conversationHistory: Array<{ role: string; content: string }>
  ): Promise<void> {
    const execution = this.activeChains.get(chainId)
    if (!execution || execution.status !== 'running') {
      return
    }

    const toolCall: MCPToolCall = decision.toolCall
    
    // Create tool execution step
    const toolStep: AgentChainStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'tool_execution',
      description: `Executing tool: ${toolCall.name}`,
      toolCall
    }

    execution.steps.push(toolStep)
    execution.currentStep = toolStep.id
    execution.totalSteps = execution.steps.length
    this.sendProgressUpdate(execution)

    try {
      // Execute the tool
      const result: MCPToolResult = await mcpService.executeToolCall(toolCall)
      
      toolStep.result = {
        content: result.content.map(c => c.text).join('\n'),
        isError: result.isError
      }

      // Update conversation history
      const newHistory = [
        ...conversationHistory,
        {
          role: 'assistant',
          content: JSON.stringify(decision)
        },
        {
          role: 'user',
          content: `Tool execution result: ${toolStep.result.content}`
        }
      ]

      // Continue with next step if tool succeeded
      if (!result.isError) {
        // Small delay before next step
        setTimeout(() => {
          this.executeChainStep(chainId, toolStep.result!.content, availableTools, newHistory)
        }, 1000)
      } else {
        // Tool failed, let the agent decide how to handle it
        setTimeout(() => {
          this.executeChainStep(
            chainId, 
            `Previous tool failed with error: ${toolStep.result!.content}. Please try a different approach.`,
            availableTools,
            newHistory
          )
        }, 1000)
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      toolStep.result = {
        content: `Tool execution failed: ${errorMessage}`,
        isError: true
      }
      this.stopChain(chainId, 'failed', `Tool execution failed: ${errorMessage}`)
    }
  }

  private completeChain(chainId: string, summary: string): void {
    const execution = this.activeChains.get(chainId)
    if (!execution) return

    const completionStep: AgentChainStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'completion',
      description: `Goal completed: ${summary}`
    }

    execution.steps.push(completionStep)
    execution.status = 'completed'
    execution.endTime = Date.now()
    execution.currentStep = completionStep.id
    execution.totalSteps = execution.steps.length

    this.cleanupChain(chainId)
    this.sendProgressUpdate(execution)
  }

  stopChain(chainId: string, status: 'stopped' | 'failed' | 'completed' = 'stopped', reason?: string): void {
    const execution = this.activeChains.get(chainId)
    if (!execution) return

    if (reason) {
      const errorStep: AgentChainStep = {
        id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        type: 'error',
        description: reason
      }
      execution.steps.push(errorStep)
      execution.currentStep = errorStep.id
      execution.totalSteps = execution.steps.length
    }

    execution.status = status
    execution.endTime = Date.now()

    this.cleanupChain(chainId)
    this.sendProgressUpdate(execution)
  }

  pauseChain(chainId: string): boolean {
    const execution = this.activeChains.get(chainId)
    if (!execution || execution.status !== 'running') {
      return false
    }

    execution.status = 'paused'
    this.sendProgressUpdate(execution)
    return true
  }

  resumeChain(chainId: string): boolean {
    const execution = this.activeChains.get(chainId)
    if (!execution || execution.status !== 'paused') {
      return false
    }

    execution.status = 'running'
    this.sendProgressUpdate(execution)
    
    // Resume from where we left off
    // This is a simplified resume - in practice, you'd want to store more state
    const availableTools = mcpService.getAvailableTools()
    this.executeChainStep(chainId, "Resuming chain execution", availableTools, [])
      .catch(error => {
        this.stopChain(chainId, 'failed', error.message)
      })

    return true
  }

  getChainExecution(chainId: string): AgentChainExecution | undefined {
    return this.activeChains.get(chainId)
  }

  getAllActiveChains(): AgentChainExecution[] {
    return Array.from(this.activeChains.values())
  }

  private cleanupChain(chainId: string): void {
    const timeout = this.chainTimeouts.get(chainId)
    if (timeout) {
      clearTimeout(timeout)
      this.chainTimeouts.delete(chainId)
    }
  }

  private sendProgressUpdate(execution: AgentChainExecution): void {
    const update: AgentChainProgressUpdate = {
      chainId: execution.id,
      status: execution.status,
      currentStep: execution.steps[execution.steps.length - 1],
      totalSteps: execution.totalSteps,
      completedSteps: execution.steps.filter(s => s.type !== 'error').length
    }

    // Send to all windows that might be interested
    const main = WINDOWS.get("main")
    if (main) {
      getRendererHandlers<RendererHandlers>(main.webContents).agentChainProgress?.send(update)
    }

    const panel = WINDOWS.get("panel")
    if (panel) {
      getRendererHandlers<RendererHandlers>(panel.webContents).agentChainProgress?.send(update)
    }
  }
}

export const agentChainService = new AgentChainService()
