import fs from "fs"
import path from "path"
import { conversationsFolder } from "./config"
import { Conversation, ConversationMessage, ConversationHistoryItem } from "../shared/types"
import { diagnosticsService } from "./diagnostics"

export interface AgentConversationMetadata {
  agentId?: string
  agentStatus?: "idle" | "processing" | "completed" | "error" | "stopped"
  agentStartedAt?: number
  agentCompletedAt?: number
  agentIterations?: number
  agentMaxIterations?: number
  isParallelAgent?: boolean
  parentConversationId?: string // For agent conversations spawned from main conversation
}

export interface EnhancedConversation extends Conversation {
  agentMetadata?: AgentConversationMetadata
}

export interface ConversationLock {
  conversationId: string
  agentId: string
  lockedAt: number
  expiresAt: number
}

export class EnhancedConversationService {
  private static instance: EnhancedConversationService | null = null
  private locks: Map<string, ConversationLock> = new Map()
  private lockTimeout = 30 * 60 * 1000 // 30 minutes

  static getInstance(): EnhancedConversationService {
    if (!EnhancedConversationService.instance) {
      EnhancedConversationService.instance = new EnhancedConversationService()
    }
    return EnhancedConversationService.instance
  }

  private constructor() {
    this.ensureConversationsFolder()
    this.startLockCleanup()
  }

  private ensureConversationsFolder() {
    if (!fs.existsSync(conversationsFolder)) {
      fs.mkdirSync(conversationsFolder, { recursive: true })
    }
  }

  private startLockCleanup() {
    // Clean up expired locks every 5 minutes
    setInterval(() => {
      const now = Date.now()
      for (const [conversationId, lock] of this.locks.entries()) {
        if (now > lock.expiresAt) {
          this.locks.delete(conversationId)
        }
      }
    }, 5 * 60 * 1000)
  }

  private getConversationPath(conversationId: string): string {
    return path.join(conversationsFolder, `${conversationId}.json`)
  }

  private getConversationIndexPath(): string {
    return path.join(conversationsFolder, "index.json")
  }

  private getAgentConversationsIndexPath(): string {
    return path.join(conversationsFolder, "agent-index.json")
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateConversationTitle(firstMessage: string): string {
    const title = firstMessage.trim().slice(0, 50)
    return title.length < firstMessage.trim().length ? `${title}...` : title
  }

  // Lock management for concurrent access
  async acquireLock(conversationId: string, agentId: string): Promise<boolean> {
    const existingLock = this.locks.get(conversationId)
    const now = Date.now()

    // Check if lock exists and is not expired
    if (existingLock && now < existingLock.expiresAt) {
      // Allow same agent to reacquire lock
      if (existingLock.agentId === agentId) {
        existingLock.expiresAt = now + this.lockTimeout
        return true
      }
      return false // Lock held by different agent
    }

    // Create new lock
    this.locks.set(conversationId, {
      conversationId,
      agentId,
      lockedAt: now,
      expiresAt: now + this.lockTimeout
    })

    return true
  }

  releaseLock(conversationId: string, agentId: string): void {
    const lock = this.locks.get(conversationId)
    if (lock && lock.agentId === agentId) {
      this.locks.delete(conversationId)
    }
  }

  private updateConversationIndex(conversation: EnhancedConversation) {
    try {
      const indexPath = this.getConversationIndexPath()
      let index: ConversationHistoryItem[] = []

      if (fs.existsSync(indexPath)) {
        const indexData = fs.readFileSync(indexPath, "utf8")
        index = JSON.parse(indexData)
      }

      // Remove existing entry
      index = index.filter(item => item.id !== conversation.id)

      // Create new index entry
      const lastMessage = conversation.messages[conversation.messages.length - 1]
      const indexItem: ConversationHistoryItem = {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        lastMessage: lastMessage?.content || "",
        preview: this.generatePreview(conversation.messages)
      }

      index.unshift(indexItem)
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))

      // Update agent index if this is an agent conversation
      if (conversation.agentMetadata?.isParallelAgent) {
        this.updateAgentConversationIndex(conversation)
      }

    } catch (error) {
      diagnosticsService.logError('enhanced-conversation', 'Failed to update conversation index', error)
    }
  }

  private updateAgentConversationIndex(conversation: EnhancedConversation) {
    try {
      const agentIndexPath = this.getAgentConversationsIndexPath()
      let agentIndex: Array<ConversationHistoryItem & { agentMetadata: AgentConversationMetadata }> = []

      if (fs.existsSync(agentIndexPath)) {
        const indexData = fs.readFileSync(agentIndexPath, "utf8")
        agentIndex = JSON.parse(indexData)
      }

      // Remove existing entry
      agentIndex = agentIndex.filter(item => item.id !== conversation.id)

      // Create new agent index entry
      const lastMessage = conversation.messages[conversation.messages.length - 1]
      const agentIndexItem = {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        lastMessage: lastMessage?.content || "",
        preview: this.generatePreview(conversation.messages),
        agentMetadata: conversation.agentMetadata!
      }

      agentIndex.unshift(agentIndexItem)
      fs.writeFileSync(agentIndexPath, JSON.stringify(agentIndex, null, 2))

    } catch (error) {
      diagnosticsService.logError('enhanced-conversation', 'Failed to update agent conversation index', error)
    }
  }

  private generatePreview(messages: ConversationMessage[]): string {
    const userMessages = messages.filter(m => m.role === "user")
    if (userMessages.length === 0) return ""
    
    const firstUserMessage = userMessages[0].content
    return firstUserMessage.length > 100 
      ? firstUserMessage.substring(0, 100) + "..."
      : firstUserMessage
  }

  async saveConversation(conversation: EnhancedConversation): Promise<void> {
    try {
      this.ensureConversationsFolder()
      const conversationPath = this.getConversationPath(conversation.id)

      conversation.updatedAt = Date.now()
      fs.writeFileSync(conversationPath, JSON.stringify(conversation, null, 2))
      this.updateConversationIndex(conversation)

    } catch (error) {
      diagnosticsService.logError('enhanced-conversation', `Failed to save conversation ${conversation.id}`, error)
      throw error
    }
  }

  async loadConversation(conversationId: string): Promise<EnhancedConversation | null> {
    try {
      const conversationPath = this.getConversationPath(conversationId)

      if (!fs.existsSync(conversationPath)) {
        return null
      }

      const conversationData = fs.readFileSync(conversationPath, "utf8")
      const conversation: EnhancedConversation = JSON.parse(conversationData)

      return conversation
    } catch (error) {
      diagnosticsService.logError('enhanced-conversation', `Failed to load conversation ${conversationId}`, error)
      return null
    }
  }

  async createAgentConversation(
    initialPrompt: string,
    agentId: string,
    options: {
      parentConversationId?: string
      maxIterations?: number
    } = {}
  ): Promise<EnhancedConversation> {
    const conversationId = this.generateConversationId()
    const messageId = this.generateMessageId()
    const now = Date.now()

    const message: ConversationMessage = {
      id: messageId,
      role: "user",
      content: initialPrompt,
      timestamp: now
    }

    const conversation: EnhancedConversation = {
      id: conversationId,
      title: `Agent: ${this.generateConversationTitle(initialPrompt)}`,
      createdAt: now,
      updatedAt: now,
      messages: [message],
      agentMetadata: {
        agentId,
        agentStatus: "idle",
        agentStartedAt: now,
        agentIterations: 0,
        agentMaxIterations: options.maxIterations || 10,
        isParallelAgent: true,
        parentConversationId: options.parentConversationId
      }
    }

    await this.saveConversation(conversation)
    return conversation
  }

  async updateAgentStatus(
    conversationId: string,
    agentId: string,
    status: AgentConversationMetadata['agentStatus'],
    additionalMetadata?: Partial<AgentConversationMetadata>
  ): Promise<void> {
    // Acquire lock before updating
    const lockAcquired = await this.acquireLock(conversationId, agentId)
    if (!lockAcquired) {
      throw new Error(`Cannot acquire lock for conversation ${conversationId}`)
    }

    try {
      const conversation = await this.loadConversation(conversationId)
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`)
      }

      if (!conversation.agentMetadata) {
        conversation.agentMetadata = { agentId, isParallelAgent: true }
      }

      conversation.agentMetadata.agentStatus = status
      
      if (additionalMetadata) {
        Object.assign(conversation.agentMetadata, additionalMetadata)
      }

      // Set completion time if status is completed or error
      if (status === "completed" || status === "error" || status === "stopped") {
        conversation.agentMetadata.agentCompletedAt = Date.now()
      }

      await this.saveConversation(conversation)

    } finally {
      this.releaseLock(conversationId, agentId)
    }
  }

  async getAgentConversations(): Promise<Array<ConversationHistoryItem & { agentMetadata: AgentConversationMetadata }>> {
    try {
      const agentIndexPath = this.getAgentConversationsIndexPath()

      if (!fs.existsSync(agentIndexPath)) {
        return []
      }

      const indexData = fs.readFileSync(agentIndexPath, "utf8")
      const agentIndex = JSON.parse(indexData)

      return agentIndex.sort((a: any, b: any) => b.updatedAt - a.updatedAt)
    } catch (error) {
      diagnosticsService.logError('enhanced-conversation', 'Failed to get agent conversations', error)
      return []
    }
  }

  async getActiveAgentConversations(): Promise<Array<ConversationHistoryItem & { agentMetadata: AgentConversationMetadata }>> {
    const agentConversations = await this.getAgentConversations()
    return agentConversations.filter(conv => 
      conv.agentMetadata.agentStatus === "processing" || 
      conv.agentMetadata.agentStatus === "idle"
    )
  }

  async deleteConversation(conversationId: string): Promise<void> {
    try {
      const conversationPath = this.getConversationPath(conversationId)

      if (fs.existsSync(conversationPath)) {
        fs.unlinkSync(conversationPath)
      }

      // Update main index
      const indexPath = this.getConversationIndexPath()
      if (fs.existsSync(indexPath)) {
        const indexData = fs.readFileSync(indexPath, "utf8")
        let index: ConversationHistoryItem[] = JSON.parse(indexData)
        index = index.filter(item => item.id !== conversationId)
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
      }

      // Update agent index
      const agentIndexPath = this.getAgentConversationsIndexPath()
      if (fs.existsSync(agentIndexPath)) {
        const agentIndexData = fs.readFileSync(agentIndexPath, "utf8")
        let agentIndex = JSON.parse(agentIndexData)
        agentIndex = agentIndex.filter((item: any) => item.id !== conversationId)
        fs.writeFileSync(agentIndexPath, JSON.stringify(agentIndex, null, 2))
      }

      // Release any locks
      this.locks.delete(conversationId)

    } catch (error) {
      diagnosticsService.logError('enhanced-conversation', `Failed to delete conversation ${conversationId}`, error)
      throw error
    }
  }
}

export const enhancedConversationService = EnhancedConversationService.getInstance()
