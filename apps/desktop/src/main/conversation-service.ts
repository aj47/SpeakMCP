import fs from "fs"
import fsPromises from "fs/promises"
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

// Debounce delay for writing the conversation index to disk (ms)
const INDEX_WRITE_DEBOUNCE_MS = 500
// On parse failures, try a bounded number of prefix candidates to recover a valid JSON object.
const CONVERSATION_REPAIR_MAX_PARSE_ATTEMPTS = 5000

export class ConversationService {
  private static instance: ConversationService | null = null

  // In-memory cache of the conversation index to avoid re-reading from disk
  private indexCache: ConversationHistoryItem[] | null = null
  // Debounce timer for writing the index to disk
  private indexWriteTimer: ReturnType<typeof setTimeout> | null = null
  // Promise that resolves when the current index write completes (for flush)
  private indexWritePromise: Promise<void> | null = null
  // Queue that serializes mutations per-conversation to prevent concurrent writes/corruption.
  private conversationMutationQueues = new Map<string, Promise<void>>()
  // Queue that serializes index cache mutations to prevent lost updates under concurrent saves.
  private indexMutationQueue: Promise<void> = Promise.resolve()

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

  /**
   * Load the conversation index into memory if not already cached.
   */
  private async ensureIndexLoaded(): Promise<ConversationHistoryItem[]> {
    if (this.indexCache !== null) {
      return this.indexCache
    }
    try {
      const indexPath = this.getConversationIndexPath()
      const data = await fsPromises.readFile(indexPath, "utf8")
      const parsed = JSON.parse(data)
      this.indexCache = Array.isArray(parsed) ? parsed : []
    } catch {
      // File doesn't exist or is corrupted — start fresh
      this.indexCache = []
    }
    return this.indexCache!
  }

  /**
   * Serialize index-cache mutations so async saves cannot clobber each other.
   */
  private enqueueIndexMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const run = this.indexMutationQueue.then(mutation)
    this.indexMutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Update the in-memory index and schedule a debounced write to disk.
   * The in-memory cache is updated immediately so subsequent reads are consistent.
   * The disk write is debounced so rapid successive calls (e.g. during agent sessions)
   * collapse into a single I/O operation.
   */
  private async updateConversationIndex(conversation: Conversation): Promise<void> {
    await this.enqueueIndexMutation(async () => {
      try {
        let index = await this.ensureIndexLoaded()

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

        // Update in-memory cache immediately
        this.indexCache = index

        // Schedule debounced disk write
        this.scheduleDiskWrite()
      } catch (error) {
        logApp("[ConversationService] Error updating conversation index:", error)
      }
    })
  }

  /**
   * Schedule (or reschedule) a debounced write of the in-memory index to disk.
   */
  private scheduleDiskWrite(): void {
    if (this.indexWriteTimer) {
      clearTimeout(this.indexWriteTimer)
    }
    this.indexWriteTimer = setTimeout(() => {
      this.indexWriteTimer = null
      this.indexWritePromise = this.writeIndexToDisk()
      this.indexWritePromise.finally(() => {
        this.indexWritePromise = null
      })
    }, INDEX_WRITE_DEBOUNCE_MS)
  }

  /**
   * Write the in-memory index cache to disk asynchronously.
   */
  private async writeIndexToDisk(): Promise<void> {
    if (!this.indexCache) return
    try {
      const indexPath = this.getConversationIndexPath()
      await fsPromises.writeFile(indexPath, JSON.stringify(this.indexCache, null, 2))
    } catch (error) {
      logApp("[ConversationService] Error writing index to disk:", error)
    }
  }

  /**
   * Serialize mutations for a single conversation to avoid concurrent read-modify-write races.
   */
  private enqueueConversationMutation<T>(
    conversationId: string,
    mutation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.conversationMutationQueues.get(conversationId) ?? Promise.resolve()
    const run = previous.then(mutation)
    const settled = run.then(() => undefined, () => undefined)

    this.conversationMutationQueues.set(conversationId, settled)
    settled.finally(() => {
      if (this.conversationMutationQueues.get(conversationId) === settled) {
        this.conversationMutationQueues.delete(conversationId)
      }
    })

    return run
  }

  /**
   * Await the latest queued mutation for a conversation, if any.
   */
  private async waitForConversationMutation(conversationId: string): Promise<void> {
    const pending = this.conversationMutationQueues.get(conversationId)
    if (pending) {
      await pending
    }
  }

  /**
   * Await all in-flight conversation mutations (used before destructive global deletes).
   */
  private async waitForAllConversationMutations(): Promise<void> {
    const pending = [...this.conversationMutationQueues.values()]
    if (pending.length === 0) return
    await Promise.allSettled(pending)
  }

  /**
   * Persist a conversation file atomically to avoid partially-written/corrupted JSON files.
   */
  private async writeConversationFileAtomic(conversationPath: string, payload: string): Promise<void> {
    const tempPath = `${conversationPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    try {
      await fsPromises.writeFile(tempPath, payload)
      await fsPromises.rename(tempPath, conversationPath)
    } catch (error) {
      try {
        await fsPromises.unlink(tempPath)
      } catch {
        // Best-effort cleanup
      }
      throw error
    }
  }

  /**
   * Validate minimal shape before accepting parsed JSON as a conversation.
   */
  private isValidConversationShape(value: unknown): value is Conversation {
    if (!value || typeof value !== "object") return false
    const maybe = value as Partial<Conversation>
    return (
      typeof maybe.id === "string" &&
      typeof maybe.title === "string" &&
      typeof maybe.createdAt === "number" &&
      typeof maybe.updatedAt === "number" &&
      Array.isArray(maybe.messages)
    )
  }

  /**
   * Attempt to recover a valid conversation JSON by trimming trailing garbage and reparsing.
   * This is only used when the file failed normal JSON.parse().
   */
  private tryRepairConversationFromCorruptedData(raw: string): Conversation | null {
    const trimmed = raw.trim()
    if (!trimmed.startsWith("{")) {
      return null
    }

    let attempts = 0
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i] !== "}") {
        continue
      }
      attempts++
      if (attempts > CONVERSATION_REPAIR_MAX_PARSE_ATTEMPTS) {
        break
      }

      const candidate = trimmed.slice(0, i + 1)
      try {
        const parsed = JSON.parse(candidate) as unknown
        if (this.isValidConversationShape(parsed)) {
          return parsed
        }
      } catch {
        // Keep scanning earlier object boundaries.
      }
    }

    return null
  }

  private async loadConversationFromDisk(conversationId: string): Promise<Conversation | null> {
    const conversationPath = this.getConversationPath(conversationId)

    let conversationData: string
    try {
      conversationData = await fsPromises.readFile(conversationPath, "utf8")
    } catch (error) {
      // File doesn't exist or is unreadable.
      return null
    }

    try {
      const conversation = JSON.parse(conversationData) as unknown
      if (!this.isValidConversationShape(conversation)) {
        logApp(`[ConversationService] Invalid conversation shape for ${conversationId}`)
        return null
      }
      return conversation
    } catch (error) {
      const repairedConversation = this.tryRepairConversationFromCorruptedData(conversationData)
      if (!repairedConversation) {
        logApp(`[ConversationService] Failed to parse conversation ${conversationId}; unable to repair.`, error)
        return null
      }

      try {
        await this.saveConversationUnlocked(repairedConversation, true)
        logApp(`[ConversationService] Repaired corrupted conversation file: ${conversationId}`)
      } catch (repairSaveError) {
        logApp(`[ConversationService] Recovered conversation ${conversationId} in-memory, but failed to persist repaired file.`, repairSaveError)
      }

      return repairedConversation
    }
  }

  private async saveConversationUnlocked(
    conversation: Conversation,
    preserveTimestamp: boolean = false,
  ): Promise<void> {
    this.ensureConversationsFolder()
    const conversationPath = this.getConversationPath(conversation.id)

    // Update the updatedAt timestamp unless preserving client-supplied value
    if (!preserveTimestamp) {
      conversation.updatedAt = Date.now()
    }

    await this.writeConversationFileAtomic(
      conversationPath,
      JSON.stringify(conversation, null, 2),
    )

    // Update the index (in-memory immediately, disk write debounced)
    await this.updateConversationIndex(conversation)
  }

  /**
   * Flush any pending debounced index write to disk immediately.
   * Called before operations that need a consistent on-disk state (e.g. delete).
   */
  private async flushIndexWrite(): Promise<void> {
    if (this.indexWriteTimer) {
      clearTimeout(this.indexWriteTimer)
      this.indexWriteTimer = null
    }
    // If a write is already in-flight, wait for it
    if (this.indexWritePromise) {
      await this.indexWritePromise
    }
    // Persist the latest cache snapshot after waiting so stale writes
    // cannot overwrite destructive operations (delete/reset).
    await this.writeIndexToDisk()
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
    await this.enqueueConversationMutation(conversation.id, async () => {
      await this.saveConversationUnlocked(conversation, preserveTimestamp)
    })
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    // Ensure we don't read stale data while a mutation for this conversation is in-flight.
    await this.waitForConversationMutation(conversationId)
    return this.loadConversationFromDisk(conversationId)
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
      const index = await this.ensureIndexLoaded()

      // Sort by updatedAt descending (most recent first)
      const sorted = [...index].sort((a, b) => b.updatedAt - a.updatedAt)
      return sorted
    } catch (error) {
      logApp("[ConversationService] Error loading conversation history:", error)
      return []
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.enqueueConversationMutation(conversationId, async () => {
      const conversationPath = this.getConversationPath(conversationId)

      // Delete conversation file
      try {
        await fsPromises.unlink(conversationPath)
      } catch {
        // File may not exist — ignore
      }

      await this.enqueueIndexMutation(async () => {
        // Update in-memory index cache
        let index = await this.ensureIndexLoaded()
        index = index.filter((item) => item.id !== conversationId)
        this.indexCache = index

        // Flush to disk immediately for deletes (important for consistency)
        await this.flushIndexWrite()
      })
    })
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

    await this.enqueueConversationMutation(validatedId, async () => {
      await this.saveConversationUnlocked(conversation)
    })
    return conversation
  }

  async addMessageToConversation(
    conversationId: string,
    content: string,
    role: "user" | "assistant" | "tool",
    toolCalls?: Array<{ name: string; arguments: any }>,
    toolResults?: Array<{ success: boolean; content: string; error?: string }>,
  ): Promise<Conversation | null> {
    return this.enqueueConversationMutation(conversationId, async () => {
      try {
        const conversation = await this.loadConversationFromDisk(conversationId)
        if (!conversation) {
          return null
        }

        // Idempotency guard: avoid pushing consecutive duplicate messages
        const last = conversation.messages[conversation.messages.length - 1]
        if (this.isConsecutiveDuplicate(last, role, content)) {
          conversation.updatedAt = Date.now()
          await this.saveConversationUnlocked(conversation)
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
        await this.saveConversationUnlocked(conversation)

        return conversation
      } catch (error) {
        return null
      }
    })
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
    await this.waitForAllConversationMutations()

    await this.enqueueIndexMutation(async () => {
      // Ensure pending/in-flight index writes are settled before deleting files.
      await this.flushIndexWrite()

      if (fs.existsSync(conversationsFolder)) {
        fs.rmSync(conversationsFolder, { recursive: true, force: true })
      }
      this.ensureConversationsFolder()

      // Clear the in-memory cache
      this.indexCache = []
    })
  }
}

export const conversationService = ConversationService.getInstance()
