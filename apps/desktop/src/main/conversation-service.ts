import fs from "fs"
import path from "path"
import { conversationsFolder } from "./config"
import { logApp } from "./debug"
import {
  Conversation,
  ConversationMessage,
  ConversationHistoryItem,
} from "../shared/types"

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
      index = index.filter((item) => item.id !== conversation.id)

      // Create new index entry
      const lastMessage =
        conversation.messages[conversation.messages.length - 1]
      const indexItem: ConversationHistoryItem = {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        lastMessage: lastMessage?.content || "",
        preview: this.generatePreview(conversation.messages),
      }

      // Add to beginning of array (most recent first)
      index.unshift(indexItem)

      // Save updated index
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
    } catch (error) {}

  }

  private generatePreview(messages: ConversationMessage[]): string {
    // Generate a preview from the first few messages
    const previewMessages = messages.slice(0, 3)
    const preview = previewMessages
      .map((msg) => `${msg.role}: ${msg.content.slice(0, 100)}`)
      .join(" | ")
    return preview.length > 200 ? `${preview.slice(0, 200)}...` : preview
  }

  private isConsecutiveDuplicate(
    last: ConversationMessage | undefined,
    role: ConversationMessage["role"],
    content: string,
  ): boolean {
    const incomingContent = (content || "").trim()
    const lastContent = (last?.content || "").trim()
    return !!last && last.role === role && lastContent === incomingContent
  }


  async saveConversation(conversation: Conversation): Promise<void> {
    this.ensureConversationsFolder()
    const conversationPath = this.getConversationPath(conversation.id)

    // Update the updatedAt timestamp
    conversation.updatedAt = Date.now()

    // Save conversation to file
    fs.writeFileSync(conversationPath, JSON.stringify(conversation, null, 2))

    // Update the index
    this.updateConversationIndex(conversation)
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const conversationPath = this.getConversationPath(conversationId)

      if (!fs.existsSync(conversationPath)) {
        return null
      }

      const conversationData = fs.readFileSync(conversationPath, "utf8")
      const conversation: Conversation = JSON.parse(conversationData)

      return conversation
    } catch (error) {
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
      const sorted = history.sort((a, b) => b.updatedAt - a.updatedAt)
      return sorted
    } catch (error) {
      logApp("[ConversationService] Error loading conversation history:", error)
      return []
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
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
      index = index.filter((item) => item.id !== conversationId)
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
    }
  }

  async createConversation(
    firstMessage: string,
    role: "user" | "assistant" = "user",
  ): Promise<Conversation> {
    const conversationId = this.generateConversationId()
    return this.createConversationWithId(conversationId, firstMessage, role)
  }

  /**
   * Validate and sanitize a conversation ID to prevent path traversal attacks.
   * Rejects IDs containing path separators or other dangerous characters.
   */
  private validateConversationId(conversationId: string): string {
    // Reject path separators and parent directory references
    if (conversationId.includes("/") || conversationId.includes("\\") || conversationId.includes("..")) {
      throw new Error(`Invalid conversation ID: contains path separators or traversal sequences`)
    }
    // Reject null bytes which could truncate paths
    if (conversationId.includes("\0")) {
      throw new Error(`Invalid conversation ID: contains null bytes`)
    }
    // Sanitize: only allow alphanumeric, underscore, hyphen, at sign, and dot
    // This covers formats like: conv_123_abc, whatsapp_61406142826@s.whatsapp.net
    const sanitized = conversationId.replace(/[^a-zA-Z0-9_\-@.]/g, "_")
    // Ensure the sanitized ID doesn't resolve outside conversations folder
    const resolvedPath = path.resolve(conversationsFolder, `${sanitized}.json`)
    if (!resolvedPath.startsWith(path.resolve(conversationsFolder))) {
      throw new Error(`Invalid conversation ID: path traversal detected`)
    }
    return sanitized
  }

  /**
   * Create a conversation with a specific ID.
   * Used for external integrations (like WhatsApp) that need to use their own identifiers.
   */
  async createConversationWithId(
    conversationId: string,
    firstMessage: string,
    role: "user" | "assistant" = "user",
  ): Promise<Conversation> {
    // Validate and sanitize the externally-provided conversation ID
    const validatedId = this.validateConversationId(conversationId)
    const messageId = this.generateMessageId()
    const now = Date.now()

    const message: ConversationMessage = {
      id: messageId,
      role,
      content: firstMessage,
      timestamp: now,
    }

    const conversation: Conversation = {
      id: validatedId,
      title: this.generateConversationTitle(firstMessage),
      createdAt: now,
      updatedAt: now,
      messages: [message],
    }

    await this.saveConversation(conversation)
    return conversation
  }

  async addMessageToConversation(
    conversationId: string,
    content: string,
    role: "user" | "assistant" | "tool",
    toolCalls?: Array<{ name: string; arguments: any }>,
    toolResults?: Array<{ success: boolean; content: string; error?: string }>,
  ): Promise<Conversation | null> {
    try {
      const conversation = await this.loadConversation(conversationId)
      if (!conversation) {
        return null
      }

      // Idempotency guard: avoid pushing consecutive duplicate messages
      const last = conversation.messages[conversation.messages.length - 1]
      if (this.isConsecutiveDuplicate(last, role, content)) {
        conversation.updatedAt = Date.now()
        await this.saveConversation(conversation)
        return conversation
      }

      const messageId = this.generateMessageId()
      const message: ConversationMessage = {
        id: messageId,
        role,
        content,
        timestamp: Date.now(),
        toolCalls,
        toolResults,
      }

      conversation.messages.push(message)
      await this.saveConversation(conversation)

      return conversation
    } catch (error) {
      return null
    }
  }

  /**
   * Compact a conversation by replacing messages up to a certain index with a summary message.
   * This persists the compaction to disk, reducing the size of the conversation file.
   *
   * @param conversationId - The ID of the conversation to compact
   * @param summaryContent - The summary text that replaces the old messages
   * @param replaceUpToIndex - Index (exclusive) of messages to replace with summary.
   *                           Messages from 0 to replaceUpToIndex-1 will be replaced.
   * @returns The updated conversation, or null if not found
   */
  async compactConversation(
    conversationId: string,
    summaryContent: string,
    replaceUpToIndex: number,
  ): Promise<Conversation | null> {
    try {
      const conversation = await this.loadConversation(conversationId)
      if (!conversation) {
        logApp(`[conversationService] compactConversation: conversation not found: ${conversationId}`)
        return null
      }

      // Validate index
      if (replaceUpToIndex <= 0 || replaceUpToIndex > conversation.messages.length) {
        logApp(`[conversationService] compactConversation: invalid replaceUpToIndex: ${replaceUpToIndex}, messages: ${conversation.messages.length}`)
        return conversation
      }

      // Create summary message
      const summaryMessage: ConversationMessage = {
        id: this.generateMessageId(),
        role: "assistant",
        content: summaryContent,
        timestamp: Date.now(),
        isSummary: true,
        summarizedMessageCount: replaceUpToIndex,
      }

      // Replace old messages with summary + keep messages after the index
      const messagesAfterSummary = conversation.messages.slice(replaceUpToIndex)
      conversation.messages = [summaryMessage, ...messagesAfterSummary]
      conversation.updatedAt = Date.now()

      // Save the compacted conversation
      await this.saveConversation(conversation)
      this.updateConversationIndex(conversation)

      logApp(`[conversationService] compactConversation: compacted ${replaceUpToIndex} messages into summary for ${conversationId}`)
      return conversation
    } catch (error) {
      logApp(`[conversationService] compactConversation error:`, error)
      return null
    }
  }

  async deleteAllConversations(): Promise<void> {
    if (fs.existsSync(conversationsFolder)) {
      fs.rmSync(conversationsFolder, { recursive: true, force: true })
    }
    this.ensureConversationsFolder()
  }
}

export const conversationService = ConversationService.getInstance()
