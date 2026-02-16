import fs from "fs"
import path from "path"
import { conversationsFolder } from "./config"
import { logApp } from "./debug"
import {
  Conversation,
  ConversationMessage,
  ConversationHistoryItem,
} from "../shared/types"
import { summarizeContent } from "./context-budget"

// Threshold for compacting conversations on load
// When a conversation exceeds this many messages, older ones are summarized
const COMPACTION_MESSAGE_THRESHOLD = 20
// Number of recent messages to keep intact after compaction
const COMPACTION_KEEP_LAST = 10

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

  /**
   * Public method to generate a conversation ID.
   * Used by remote-server when creating new conversations without a provided ID.
   */
  generateConversationIdPublic(): string {
    return this.generateConversationId()
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


  async saveConversation(conversation: Conversation, preserveTimestamp: boolean = false): Promise<void> {
    this.ensureConversationsFolder()
    const conversationPath = this.getConversationPath(conversation.id)

    // Update the updatedAt timestamp unless preserving client-supplied value
    if (!preserveTimestamp) {
      conversation.updatedAt = Date.now()
    }

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

  /**
   * Load a conversation and compact it if it exceeds the message threshold.
   * Use this when loading conversations for continued use (e.g., in agent mode).
   * The compaction is persisted to disk, so subsequent loads will be faster.
   *
   * @param conversationId - The ID of the conversation to load
   * @param sessionId - Optional session ID for cancellation support during summarization
   * @returns The conversation (possibly compacted), or null if not found
   */
  async loadConversationWithCompaction(conversationId: string, sessionId?: string): Promise<Conversation | null> {
    const conversation = await this.loadConversation(conversationId)
    if (!conversation) {
      return null
    }

    // Compact if needed (this will save to disk if compaction occurs)
    // Best-effort: if compaction fails, return the original conversation
    try {
      return await this.compactOnLoad(conversation, sessionId)
    } catch (error) {
      logApp(`Failed to compact conversation ${conversationId}, returning original: ${error}`)
      return conversation
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
   * Compact a conversation by summarizing older messages.
   * Called when loading a conversation that exceeds the message threshold.
   * This is a lazy compaction strategy - we only compact when the conversation
   * is loaded, not during the agent loop.
   *
   * @param conversation - The conversation to compact
   * @param sessionId - Optional session ID for cancellation support during summarization
   * @returns The compacted conversation
   */
  private async compactOnLoad(conversation: Conversation, sessionId?: string): Promise<Conversation> {
    const messageCount = conversation.messages.length
    if (messageCount <= COMPACTION_MESSAGE_THRESHOLD) {
      return conversation
    }

    // Calculate how many messages to summarize
    const messagesToSummarize = conversation.messages.slice(0, messageCount - COMPACTION_KEEP_LAST)
    const messagesToKeep = conversation.messages.slice(messageCount - COMPACTION_KEEP_LAST)

    if (messagesToSummarize.length === 0) {
      return conversation
    }

    logApp(`[conversationService] compactOnLoad: compacting ${messagesToSummarize.length} messages for ${conversation.id}`)

    // Build a summary of the older messages
    const summaryInput = messagesToSummarize
      .map((m) => {
        let text = `${m.role}: ${m.content?.substring(0, 500) || "(empty)"}`

        // Include tool calls if present
        if (m.toolCalls && m.toolCalls.length > 0) {
          const toolCallsStr = m.toolCalls
            .map((tc) => {
              const argsStr = JSON.stringify(tc.arguments).substring(0, 200)
              return `${tc.name}(${argsStr})`
            })
            .join(", ")
          text += `\nTool calls: ${toolCallsStr}`
        }

        // Include tool results if present
        if (m.toolResults && m.toolResults.length > 0) {
          const toolResultsStr = m.toolResults
            .map((tr) => {
              const status = tr.success ? "success" : "error"
              const content = (tr.error || tr.content || "").substring(0, 200)
              return `${status}: ${content}`
            })
            .join(", ")
          text += `\nTool results: ${toolResultsStr}`
        }

        return text
      })
      .join("\n\n")

    let summaryContent: string
    const summarizationPrompt = `Summarize this conversation history concisely, preserving key facts, decisions, and context:\n\n${summaryInput}`
    try {
      summaryContent = await summarizeContent(summarizationPrompt, sessionId)
      // summarizeContent() swallows errors internally and returns the input text on failure.
      // Detect this by checking if the result equals or contains the full prompt (failure case).
      // A successful summary should be significantly shorter than the prompt.
      if (summaryContent === summarizationPrompt || summaryContent.length >= summarizationPrompt.length * 0.9) {
        logApp(`[conversationService] compactOnLoad: summarization likely failed (output too similar to input), keeping original`)
        return conversation
      }
    } catch (error) {
      logApp(`[conversationService] compactOnLoad: summarization failed, keeping original:`, error)
      return conversation
    }

    // Create summary message
    const summaryMessage: ConversationMessage = {
      id: this.generateMessageId(),
      role: "assistant",
      content: summaryContent,
      timestamp: messagesToSummarize[0]?.timestamp || Date.now(),
      isSummary: true,
      summarizedMessageCount: messagesToSummarize.length,
    }

    // Create compacted conversation (don't mutate original)
    const compactedConversation: Conversation = {
      ...conversation,
      messages: [summaryMessage, ...messagesToKeep],
      updatedAt: Date.now(),
    }

    // Persist the compacted conversation
    // Note: saveConversation() already calls updateConversationIndex(), so no need to call it separately
    // If save fails, return the original conversation (best-effort)
    try {
      await this.saveConversation(compactedConversation)
    } catch (error) {
      logApp(`[conversationService] compactOnLoad: failed to persist, returning original:`, error)
      return conversation
    }

    logApp(`[conversationService] compactOnLoad: compacted ${messagesToSummarize.length} messages into summary, new count: ${compactedConversation.messages.length}`)
    return compactedConversation
  }

  /**
   * Get the most recently updated conversation's ID and title.
   * Used by "continue last conversation" keybinds.
   */
  async getMostRecentConversation(): Promise<{ id: string; title: string } | null> {
    const history = await this.getConversationHistory()
    if (history.length === 0) return null
    return { id: history[0].id, title: history[0].title }
  }

  async deleteAllConversations(): Promise<void> {
    if (fs.existsSync(conversationsFolder)) {
      fs.rmSync(conversationsFolder, { recursive: true, force: true })
    }
    this.ensureConversationsFolder()
  }
}

export const conversationService = ConversationService.getInstance()
