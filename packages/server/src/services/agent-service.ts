import { EventEmitter } from 'events'
import { nanoid } from 'nanoid'
import OpenAI from 'openai'
import { mcpService } from './mcp-service.js'
import { conversationService, type Conversation, type Message } from './conversation-service.js'
import { profileService, type Profile } from './profile-service.js'
import { config } from '../config.js'
import { configService } from './config-service.js'

// Types
export interface AgentSession {
  id: string
  conversationId: string
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'error'
  iteration: number
  maxIterations: number
  profileSnapshot: Profile | null
  startedAt: number
  error?: string
}

export type AgentProgressType = 
  | 'thinking' 
  | 'tool_call' 
  | 'tool_result' 
  | 'response' 
  | 'stream' 
  | 'error' 
  | 'done'
  | 'approval_required'

export interface AgentProgress {
  type: AgentProgressType
  sessionId: string
  conversationId?: string
  iteration?: number
  message?: string
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
  content?: string
  error?: string
  delta?: string
}

export interface AgentOptions {
  conversationId?: string
  profileId?: string
  maxIterations?: number
  requireToolApproval?: boolean
  streaming?: boolean
}

class AgentService extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map()
  private abortControllers: Map<string, AbortController> = new Map()
  private pendingApprovals: Map<string, { 
    resolve: (approved: boolean) => void
    toolName: string
    toolArgs: unknown
  }> = new Map()

  async *process(
    input: string,
    options: AgentOptions = {}
  ): AsyncGenerator<AgentProgress> {
    const sessionId = `session_${nanoid()}`
    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)

    // Create or get conversation
    let conversationId = options.conversationId
    if (!conversationId) {
      const conv = conversationService.create(input, 'user')
      conversationId = conv.id
    } else {
      // Add user message to existing conversation
      conversationService.addMessage(conversationId, input, 'user')
    }

    // Get profile snapshot for isolation
    const profileId = options.profileId ?? configService.getCurrentProfileId()
    const profileSnapshot = profileId
      ? profileService.createSnapshot(profileId)
      : null

    const session: AgentSession = {
      id: sessionId,
      conversationId,
      status: 'running',
      iteration: 0,
      maxIterations: options.maxIterations ?? configService.getKey('mcpMaxIterations') ?? 25,
      profileSnapshot,
      startedAt: Date.now(),
    }
    this.sessions.set(sessionId, session)

    try {
      // Build messages for LLM
      const conversation = conversationService.get(conversationId)!
      const messages = this.buildMessages(conversation, profileSnapshot)
      const tools = this.buildTools()

      // Get provider config
      const providerId = configService.getKey('mcpToolsProviderId') ?? 'openai'
      const modelId = configService.getKey('mcpToolsModelId')
      
      // Create OpenAI client (works with OpenAI-compatible APIs)
      const openai = this.getOpenAIClient(providerId)
      const model = this.getModelId(providerId, modelId)

      // Agent loop
      while (session.iteration < session.maxIterations && session.status === 'running') {
        if (abortController.signal.aborted) {
          session.status = 'stopped'
          yield { type: 'done', sessionId, conversationId, message: 'Stopped by user' }
          return
        }

        session.iteration++
        yield { 
          type: 'thinking', 
          sessionId, 
          conversationId,
          iteration: session.iteration,
          message: `Iteration ${session.iteration}/${session.maxIterations}`
        }

        // Call LLM
        const response = await openai.chat.completions.create({
          model,
          messages: messages as OpenAI.ChatCompletionMessageParam[],
          tools: tools.length > 0 ? tools : undefined,
          stream: false,
        }, {
          signal: abortController.signal,
        })

        const choice = response.choices[0]
        const assistantMessage = choice.message

        // Check for tool calls
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          // Add assistant message with tool calls
          messages.push(assistantMessage as any)

          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name
            let toolArgs: unknown
            try {
              toolArgs = JSON.parse(toolCall.function.arguments)
            } catch {
              toolArgs = {}
            }

            yield {
              type: 'tool_call',
              sessionId,
              conversationId,
              toolName,
              toolArgs,
              iteration: session.iteration
            }

            // Handle tool approval if required
            const requireApproval = options.requireToolApproval ?? 
              configService.getKey('mcpRequireApprovalBeforeToolCall') ?? false

            if (requireApproval) {
              yield {
                type: 'approval_required',
                sessionId,
                conversationId,
                toolName,
                toolArgs,
              }

              const approved = await this.waitForApproval(sessionId, toolName, toolArgs)
              if (!approved) {
                const deniedResult = 'Tool call denied by user'
                yield { type: 'tool_result', sessionId, conversationId, toolName, toolResult: deniedResult }
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: deniedResult,
                } as any)
                continue
              }
            }

            // Execute tool
            try {
              const result = await mcpService.executeToolByName(toolName, toolArgs)

              const resultContent = typeof result === 'object'
                ? JSON.stringify(result, null, 2)
                : String(result)

              yield { type: 'tool_result', sessionId, conversationId, toolName, toolResult: result }

              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: resultContent,
              } as any)
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error)
              yield { type: 'tool_result', sessionId, conversationId, toolName, toolResult: { error: errorMsg } }
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: errorMsg }),
              } as any)
            }
          }
        } else {
          // No tool calls - final response
          const content = assistantMessage.content ?? ''

          // Save to conversation
          conversationService.addMessage(conversationId, content, 'assistant')

          yield { type: 'response', sessionId, conversationId, content }
          yield { type: 'done', sessionId, conversationId }

          session.status = 'completed'
          return
        }
      }

      // Max iterations reached
      const errorMsg = 'Max iterations reached'
      yield { type: 'error', sessionId, conversationId, error: errorMsg }
      session.status = 'error'
      session.error = errorMsg

    } catch (error) {
      if (abortController.signal.aborted) {
        session.status = 'stopped'
        yield { type: 'done', sessionId, conversationId, message: 'Stopped' }
        return
      }

      const errorMsg = error instanceof Error ? error.message : String(error)
      session.status = 'error'
      session.error = errorMsg
      yield { type: 'error', sessionId, conversationId, error: errorMsg }
    } finally {
      this.abortControllers.delete(sessionId)
    }
  }

  stopSession(sessionId: string): boolean {
    const controller = this.abortControllers.get(sessionId)
    const session = this.sessions.get(sessionId)
    if (controller) {
      controller.abort()
      if (session) session.status = 'stopped'
      return true
    }
    return false
  }

  stopAllSessions(): number {
    let count = 0
    for (const [id, controller] of this.abortControllers) {
      controller.abort()
      const session = this.sessions.get(id)
      if (session) session.status = 'stopped'
      count++
    }
    return count
  }

  getSession(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }

  getActiveSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'running')
  }

  respondToApproval(sessionId: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(sessionId)
    if (pending) {
      pending.resolve(approved)
      this.pendingApprovals.delete(sessionId)
      return true
    }
    return false
  }

  private async waitForApproval(sessionId: string, toolName: string, toolArgs: unknown): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(sessionId, { resolve, toolName, toolArgs })
      this.emit('approval:required', { sessionId, toolName, toolArgs })

      // Auto-approve after 60 seconds
      setTimeout(() => {
        if (this.pendingApprovals.has(sessionId)) {
          this.pendingApprovals.delete(sessionId)
          resolve(true)
        }
      }, 60000)
    })
  }

  private buildMessages(conversation: Conversation, profile: Profile | null): any[] {
    const messages: any[] = []

    // System messages from profile and config
    const customSystemPrompt = configService.getKey('mcpCustomSystemPrompt')
    const toolsSystemPrompt = configService.getKey('mcpToolsSystemPrompt')

    if (profile?.systemPrompt) {
      messages.push({ role: 'system', content: profile.systemPrompt })
    }
    if (customSystemPrompt) {
      messages.push({ role: 'system', content: customSystemPrompt })
    }
    if (toolsSystemPrompt) {
      messages.push({ role: 'system', content: toolsSystemPrompt })
    }
    if (profile?.guidelines) {
      messages.push({ role: 'system', content: `Guidelines:\n${profile.guidelines}` })
    }

    // Conversation history
    for (const msg of conversation.messages) {
      messages.push({ role: msg.role, content: msg.content })
    }

    return messages
  }

  private buildTools(): OpenAI.ChatCompletionTool[] {
    const mcpTools = mcpService.getEnabledTools()
    return mcpTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    }))
  }

  private getOpenAIClient(providerId: string): OpenAI {
    const appConfig = configService.get()

    switch (providerId) {
      case 'groq':
        return new OpenAI({
          apiKey: appConfig.groqApiKey ?? config.groq.apiKey,
          baseURL: appConfig.groqBaseUrl ?? config.groq.baseUrl,
        })
      case 'gemini':
        return new OpenAI({
          apiKey: appConfig.geminiApiKey ?? config.gemini.apiKey,
          baseURL: appConfig.geminiBaseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
        })
      case 'openai':
      default:
        return new OpenAI({
          apiKey: appConfig.openaiApiKey ?? config.openai.apiKey,
          baseURL: appConfig.openaiBaseUrl ?? config.openai.baseUrl,
        })
    }
  }

  private getModelId(providerId: string, modelId?: string): string {
    if (modelId) return modelId

    switch (providerId) {
      case 'groq':
        return 'llama-3.3-70b-versatile'
      case 'gemini':
        return 'gemini-2.0-flash-exp'
      case 'openai':
      default:
        return 'gpt-4o-mini'
    }
  }

  // Clean up old sessions
  cleanupSessions(maxAge: number = 3600000): number {
    const now = Date.now()
    let count = 0
    for (const [id, session] of this.sessions) {
      if (session.status !== 'running' && now - session.startedAt > maxAge) {
        this.sessions.delete(id)
        count++
      }
    }
    return count
  }
}

export const agentService = new AgentService()