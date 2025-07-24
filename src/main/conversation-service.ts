import fs from "fs"
import path from "path"
import { conversationsFolder } from "./config"
import { Conversation, ConversationMessage, ConversationHistoryItem } from "../shared/types"

export class ConversationService {
  private static instance: ConversationService | null = null

  static getInstance(): ConversationService {
    if (!ConversationService.instance) {
      ConversationService.instance = new ConversationService()
    }
    return ConversationService.instance
  }

  private constructor() {
    this.ensureConversationsFolder()
  }

  private ensureConversationsFolder() {
    if (!fs.existsSync(conversationsFolder)) {
      fs.mkdirSync(conversationsFolder, { recursive: true })
    }
  }

  private getConversationPath(conversationId: string): string {
    return path.join(conversationsFolder, `${conversationId}.json`)
  }

  private getConversationIndexPath(): string {
    return path.join(conversationsFolder, "index.json")
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateConversationTitle(firstMessage: string): string {
    // Generate a title from the first message (first 50 characters)
    const title = firstMessage.trim().slice(0, 50)
    return title.length < firstMessage.trim().length ? `${title}...` : title
  }

  private updateConversationIndex(conversation: Conversation) {
    try {
      const indexPath = this.getConversationIndexPath()
      let index: ConversationHistoryItem[] = []

      if (fs.existsSync(indexPath)) {
        const indexData = fs.readFileSync(indexPath, "utf8")
        index = JSON.parse(indexData)
      }

      // Remove existing entry if it exists
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

      // Add to beginning of array (most recent first)
      index.unshift(indexItem)

      // Save updated index
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
    } catch (error) {
      console.error("Failed to update conversation index:", error)
    }
  }

  private generatePreview(messages: ConversationMessage[]): string {
    // Generate a preview from the first few messages
    const previewMessages = messages.slice(0, 3)
    const preview = previewMessages
      .map(msg => `${msg.role}: ${msg.content.slice(0, 100)}`)
      .join(" | ")
    return preview.length > 200 ? `${preview.slice(0, 200)}...` : preview
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    try {
      this.ensureConversationsFolder()
      const conversationPath = this.getConversationPath(conversation.id)

      // Update the updatedAt timestamp
      conversation.updatedAt = Date.now()

      // Save conversation to file
      fs.writeFileSync(conversationPath, JSON.stringify(conversation, null, 2))

      // Update the index
      this.updateConversationIndex(conversation)

      console.log(`[CONVERSATION] Saved conversation ${conversation.id}`)
    } catch (error) {
      console.error("Failed to save conversation:", error)
      throw error
    }
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const conversationPath = this.getConversationPath(conversationId)

      if (!fs.existsSync(conversationPath)) {
        return null
      }

      const conversationData = fs.readFileSync(conversationPath, "utf8")
      const conversation: Conversation = JSON.parse(conversationData)

      console.log(`[CONVERSATION] Loaded conversation ${conversationId}`)
      return conversation
    } catch (error) {
      console.error("Failed to load conversation:", error)
      return null
    }
  }

  async getConversationHistory(): Promise<ConversationHistoryItem[]> {
    try {
      const indexPath = this.getConversationIndexPath()

      if (!fs.existsSync(indexPath)) {
        return []
      }

      const indexData = fs.readFileSync(indexPath, "utf8")
      const history: ConversationHistoryItem[] = JSON.parse(indexData)

      // Sort by updatedAt descending (most recent first)
      return history.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch (error) {
      console.error("Failed to get conversation history:", error)
      return []
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    try {
      const conversationPath = this.getConversationPath(conversationId)

      // Delete conversation file
      if (fs.existsSync(conversationPath)) {
        fs.unlinkSync(conversationPath)
      }

      // Update index
      const indexPath = this.getConversationIndexPath()
      if (fs.existsSync(indexPath)) {
        const indexData = fs.readFileSync(indexPath, "utf8")
        let index: ConversationHistoryItem[] = JSON.parse(indexData)
        index = index.filter(item => item.id !== conversationId)
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
      }

      console.log(`[CONVERSATION] Deleted conversation ${conversationId}`)
    } catch (error) {
      console.error("Failed to delete conversation:", error)
      throw error
    }
  }

  async createConversation(firstMessage: string, role: "user" | "assistant" = "user"): Promise<Conversation> {
    const conversationId = this.generateConversationId()
    const messageId = this.generateMessageId()
    const now = Date.now()

    const message: ConversationMessage = {
      id: messageId,
      role,
      content: firstMessage,
      timestamp: now
    }

    const conversation: Conversation = {
      id: conversationId,
      title: this.generateConversationTitle(firstMessage),
      createdAt: now,
      updatedAt: now,
      messages: [message]
    }

    await this.saveConversation(conversation)
    return conversation
  }

  async addMessageToConversation(
    conversationId: string,
    content: string,
    role: "user" | "assistant" | "tool",
    toolCalls?: Array<{ name: string; arguments: any }>,
    toolResults?: Array<{ success: boolean; content: string; error?: string }>
  ): Promise<Conversation | null> {
    try {
      const conversation = await this.loadConversation(conversationId)
      if (!conversation) {
        return null
      }

      const messageId = this.generateMessageId()
      const message: ConversationMessage = {
        id: messageId,
        role,
        content,
        timestamp: Date.now(),
        toolCalls,
        toolResults
      }

      conversation.messages.push(message)
      await this.saveConversation(conversation)

      return conversation
    } catch (error) {
      console.error("Failed to add message to conversation:", error)
      return null
    }
  }

  async deleteAllConversations(): Promise<void> {
    try {
      if (fs.existsSync(conversationsFolder)) {
        fs.rmSync(conversationsFolder, { recursive: true, force: true })
      }
      this.ensureConversationsFolder()
      console.log("[CONVERSATION] Deleted all conversations")
    } catch (error) {
      console.error("Failed to delete all conversations:", error)
      throw error
    }
  }
}

export const conversationService = ConversationService.getInstance()
