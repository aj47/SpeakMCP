import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { mcpService, MCPTool, MCPToolCall, MCPToolResult } from './mcp-service.js'
import { configService } from './config-service.js'
import { profileService, SessionProfileSnapshot } from './profile-service.js'
import { conversationService } from './conversation-service.js'

export interface AgentProgressStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result' | 'completion' | 'tool_approval'
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'error' | 'awaiting_approval'
  timestamp: number
  toolCall?: { name: string; arguments: any }
  toolResult?: { success: boolean; content: string; error?: string }
}

export interface AgentProgressUpdate {
  sessionId: string
  conversationId?: string
  conversationTitle?: string
  currentIteration: number
  maxIterations: number
  steps: AgentProgressStep[]
  isComplete: boolean
  isSnoozed?: boolean
  finalContent?: string
  streamingContent?: {
    text: string
    isStreaming: boolean
  }
  modelInfo?: {
    provider: string
    model: string
  }
  profileName?: string
}

export interface AgentSession {
  id: string
  conversationId?: string
  conversationTitle?: string
  status: 'active' | 'completed' | 'error' | 'stopped'
  isSnoozed: boolean
  startedAt: number
  endedAt?: number
  profileSnapshot?: SessionProfileSnapshot
  errorMessage?: string
}

export interface ProcessOptions {
  conversationId?: string
  profileId?: string
  onProgress?: (update: AgentProgressUpdate) => void
}

class AgentSessionTracker {
  startSession(
    conversationId: string | undefined,
    conversationTitle: string,
    snoozed: boolean = false,
    profileSnapshot?: SessionProfileSnapshot
  ): string {
    const db = getDb()
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    db.prepare(`
      INSERT INTO agent_sessions (id, conversation_id, conversation_title, status, is_snoozed, started_at, profile_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      conversationId || null,
      conversationTitle,
      'active',
      snoozed ? 1 : 0,
      Date.now(),
      profileSnapshot ? JSON.stringify(profileSnapshot) : null
    )

    return id
  }

  getSession(id: string): AgentSession | undefined {
    const db = getDb()
    const row = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as any
    if (!row) return undefined

    return {
      id: row.id,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      status: row.status,
      isSnoozed: row.is_snoozed === 1,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      profileSnapshot: row.profile_snapshot ? JSON.parse(row.profile_snapshot) : undefined,
      errorMessage: row.error_message,
    }
  }

  getActiveSessions(): AgentSession[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM agent_sessions WHERE status = ? ORDER BY started_at DESC').all('active') as any[]
    
    return rows.map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      status: row.status,
      isSnoozed: row.is_snoozed === 1,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      profileSnapshot: row.profile_snapshot ? JSON.parse(row.profile_snapshot) : undefined,
      errorMessage: row.error_message,
    }))
  }

  completeSession(id: string, message?: string): void {
    const db = getDb()
    db.prepare(`
      UPDATE agent_sessions SET status = ?, ended_at = ? WHERE id = ?
    `).run('completed', Date.now(), id)
  }

  errorSession(id: string, errorMessage: string): void {
    const db = getDb()
    db.prepare(`
      UPDATE agent_sessions SET status = ?, ended_at = ?, error_message = ? WHERE id = ?
    `).run('error', Date.now(), errorMessage, id)
  }

  stopSession(id: string): void {
    const db = getDb()
    db.prepare(`
      UPDATE agent_sessions SET status = ?, ended_at = ? WHERE id = ?
    `).run('stopped', Date.now(), id)
  }

  snoozeSession(id: string): void {
    const db = getDb()
    db.prepare('UPDATE agent_sessions SET is_snoozed = ? WHERE id = ?').run(1, id)
  }

  unsnoozeSession(id: string): void {
    const db = getDb()
    db.prepare('UPDATE agent_sessions SET is_snoozed = ? WHERE id = ?').run(0, id)
  }
}

export const agentSessionTracker = new AgentSessionTracker()

// Simple state tracking for emergency stop
const agentState = {
  shouldStop: false,
  activeSessions: new Set<string>(),
}

class AgentService {
  async *process(
    text: string,
    options: ProcessOptions = {}
  ): AsyncGenerator<AgentProgressUpdate> {
    const { conversationId: inputConversationId, profileId, onProgress } = options
    
    const config = await configService.get()
    const maxIterations = config.mcpMaxIterations || 10

    // Get profile snapshot
    let profileSnapshot: SessionProfileSnapshot | undefined
    const currentProfile = profileId 
      ? profileService.getProfile(profileId)
      : profileService.getCurrentProfile()
    
    if (currentProfile) {
      profileSnapshot = {
        profileId: currentProfile.id,
        profileName: currentProfile.name,
        guidelines: currentProfile.guidelines,
        systemPrompt: currentProfile.systemPrompt,
        mcpServerConfig: currentProfile.mcpServerConfig,
        modelConfig: currentProfile.modelConfig,
      }
    }

    // Create or continue conversation
    let conversationId = inputConversationId
    if (conversationId) {
      await conversationService.addMessageToConversation(
        conversationId,
        text,
        'user'
      )
    } else {
      const conv = await conversationService.createConversation(text, 'user')
      conversationId = conv.id
    }

    const conversationTitle = text.length > 50 ? text.substring(0, 50) + '...' : text

    // Start session
    const sessionId = agentSessionTracker.startSession(
      conversationId,
      conversationTitle,
      false,
      profileSnapshot
    )
    agentState.activeSessions.add(sessionId)

    try {
      // Initialize MCP
      await mcpService.initialize()

      // Get available tools filtered by profile
      const tools = profileSnapshot?.mcpServerConfig
        ? mcpService.getAvailableToolsForProfile(profileSnapshot.mcpServerConfig)
        : mcpService.getAvailableTools()

      const steps: AgentProgressStep[] = []
      let iteration = 0
      let isComplete = false
      let finalContent = ''

      // Initial progress update
      const createUpdate = (): AgentProgressUpdate => ({
        sessionId,
        conversationId,
        conversationTitle,
        currentIteration: iteration,
        maxIterations,
        steps: [...steps],
        isComplete,
        finalContent: isComplete ? finalContent : undefined,
        profileName: profileSnapshot?.profileName,
        modelInfo: {
          provider: config.mcpToolsProviderId || 'openai',
          model: config.mcpToolsOpenaiModel || 'gpt-4',
        },
      })

      yield createUpdate()

      // For now, since we don't have the full LLM integration,
      // we'll return a simple response indicating the tools available
      // This is a placeholder that should be replaced with actual LLM processing

      const thinkingStep: AgentProgressStep = {
        id: uuidv4(),
        type: 'thinking',
        title: 'Processing request...',
        status: 'in_progress',
        timestamp: Date.now(),
      }
      steps.push(thinkingStep)
      yield createUpdate()

      // Simulate processing
      thinkingStep.status = 'completed'
      thinkingStep.title = 'Request processed'
      
      const completionStep: AgentProgressStep = {
        id: uuidv4(),
        type: 'completion',
        title: 'Response ready',
        status: 'completed',
        timestamp: Date.now(),
      }
      steps.push(completionStep)

      isComplete = true
      finalContent = `I received your message: "${text}"\n\nI have access to ${tools.length} MCP tools. To fully process your request with tool calling, the LLM integration needs to be completed.`

      // Save assistant response to conversation
      await conversationService.addMessageToConversation(
        conversationId,
        finalContent,
        'assistant'
      )

      yield createUpdate()

      agentSessionTracker.completeSession(sessionId)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      agentSessionTracker.errorSession(sessionId, errorMessage)
      throw error
    } finally {
      agentState.activeSessions.delete(sessionId)
    }
  }

  async stop(sessionId?: string): Promise<{ killed: number }> {
    agentState.shouldStop = true

    let killed = 0
    
    if (sessionId) {
      if (agentState.activeSessions.has(sessionId)) {
        agentSessionTracker.stopSession(sessionId)
        agentState.activeSessions.delete(sessionId)
        killed = 1
      }
    } else {
      // Stop all sessions
      for (const id of agentState.activeSessions) {
        agentSessionTracker.stopSession(id)
        killed++
      }
      agentState.activeSessions.clear()
    }

    // Reset stop flag after a delay
    setTimeout(() => {
      agentState.shouldStop = false
    }, 100)

    return { killed }
  }

  getActiveSessions(): AgentSession[] {
    return agentSessionTracker.getActiveSessions()
  }

  getSession(id: string): AgentSession | undefined {
    return agentSessionTracker.getSession(id)
  }

  snoozeSession(id: string): void {
    agentSessionTracker.snoozeSession(id)
  }

  unsnoozeSession(id: string): void {
    agentSessionTracker.unsnoozeSession(id)
  }
}

export const agentService = new AgentService()
