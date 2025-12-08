import { QueuedMessage, MessageQueue } from "../shared/types"
import { logApp } from "./debug"
import { getRendererHandlers } from "@egoist/tipc/main"
import { RendererHandlers } from "./renderer-handlers"
import { WINDOWS } from "./window"

/**
 * Service for managing message queues per conversation.
 * When message queuing is enabled, users can submit messages while an agent session is active.
 * These messages are queued and processed sequentially after the current session completes.
 */
class MessageQueueService {
  private static instance: MessageQueueService | null = null
  private queues: Map<string, QueuedMessage[]> = new Map()
  // Track which conversations are currently being processed to prevent concurrent processing
  private processingConversations: Set<string> = new Set()

  static getInstance(): MessageQueueService {
    if (!MessageQueueService.instance) {
      MessageQueueService.instance = new MessageQueueService()
    }
    return MessageQueueService.instance
  }

  private constructor() {}

  /**
   * Try to acquire a processing lock for a conversation.
   * Returns true if lock acquired, false if already being processed.
   */
  tryAcquireProcessingLock(conversationId: string): boolean {
    if (this.processingConversations.has(conversationId)) {
      logApp(`[MessageQueueService] Already processing queue for ${conversationId}, skipping`)
      return false
    }
    this.processingConversations.add(conversationId)
    logApp(`[MessageQueueService] Acquired processing lock for ${conversationId}`)
    return true
  }

  /**
   * Release the processing lock for a conversation.
   */
  releaseProcessingLock(conversationId: string): void {
    this.processingConversations.delete(conversationId)
    logApp(`[MessageQueueService] Released processing lock for ${conversationId}`)
  }

  /**
   * Check if a conversation is currently being processed.
   */
  isProcessing(conversationId: string): boolean {
    return this.processingConversations.has(conversationId)
  }

  private generateMessageId(): string {
    return `qmsg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * Add a message to the queue for a conversation
   */
  enqueue(conversationId: string, text: string): QueuedMessage {
    const message: QueuedMessage = {
      id: this.generateMessageId(),
      conversationId,
      text,
      createdAt: Date.now(),
      status: "pending",
    }

    const queue = this.queues.get(conversationId) || []
    queue.push(message)
    this.queues.set(conversationId, queue)

    logApp(`[MessageQueueService] Enqueued message for ${conversationId}: ${message.id}`)
    this.emitQueueUpdate(conversationId)

    return message
  }

  /**
   * Get all queued messages for a conversation
   */
  getQueue(conversationId: string): QueuedMessage[] {
    return this.queues.get(conversationId) || []
  }

  /**
   * Get all queues (for debugging/UI purposes)
   */
  getAllQueues(): MessageQueue[] {
    const result: MessageQueue[] = []
    this.queues.forEach((messages, conversationId) => {
      if (messages.length > 0) {
        result.push({ conversationId, messages })
      }
    })
    return result
  }

  /**
   * Remove a specific message from the queue
   */
  removeFromQueue(conversationId: string, messageId: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue) return false

    const index = queue.findIndex((m) => m.id === messageId)
    if (index === -1) return false

    queue.splice(index, 1)
    logApp(`[MessageQueueService] Removed message ${messageId} from ${conversationId}`)
    this.emitQueueUpdate(conversationId)

    return true
  }

  /**
   * Clear all messages in a conversation's queue
   */
  clearQueue(conversationId: string): void {
    this.queues.delete(conversationId)
    logApp(`[MessageQueueService] Cleared queue for ${conversationId}`)
    this.emitQueueUpdate(conversationId)
  }

  /**
   * Peek at the next pending message without removing it
   */
  peek(conversationId: string): QueuedMessage | null {
    const queue = this.queues.get(conversationId)
    if (!queue || queue.length === 0) return null
    return queue[0]
  }

  /**
   * Mark the first message in the queue as successfully processed and remove it
   */
  markProcessed(conversationId: string, messageId: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue || queue.length === 0) return false

    if (queue[0]?.id !== messageId) {
      logApp(`[MessageQueueService] Warning: markProcessed called for ${messageId} but front is ${queue[0]?.id}`)
      return false
    }

    queue.shift()
    logApp(`[MessageQueueService] Marked message ${messageId} as processed for ${conversationId}`)
    this.emitQueueUpdate(conversationId)

    return true
  }

  /**
   * Check if a conversation has queued messages
   */
  hasQueuedMessages(conversationId: string): boolean {
    const queue = this.queues.get(conversationId)
    return !!queue && queue.length > 0
  }

  /**
   * Emit queue update to renderer
   */
  private emitQueueUpdate(conversationId: string): void {
    const main = WINDOWS.get("main")
    const panel = WINDOWS.get("panel")

    const queue = this.getQueue(conversationId)

    ;[main, panel].forEach((win) => {
      if (win) {
        getRendererHandlers<RendererHandlers>(win.webContents).onMessageQueueUpdate.send({
          conversationId,
          queue,
        })
      }
    })
  }
}

export const messageQueueService = MessageQueueService.getInstance()
