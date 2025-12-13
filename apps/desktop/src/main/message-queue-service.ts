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
    if (queue.length === 0) {
      this.queues.delete(conversationId)
    }
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
   * Update the text of a queued message.
   * If the message was in failed status, resets it to pending for retry.
   */
  updateMessageText(conversationId: string, messageId: string, newText: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue) return false

    const message = queue.find((m) => m.id === messageId)
    if (!message) return false

    if (message.status === "processing") {
      logApp(`[MessageQueueService] Cannot update message ${messageId} text while it is processing`)
      return false
    }

    message.text = newText
    // Reset failed messages to pending status so they can be retried
    if (message.status === "failed") {
      message.status = "pending"
      delete message.errorMessage
      logApp(`[MessageQueueService] Reset failed message ${messageId} to pending in ${conversationId}`)
    } else {
      logApp(`[MessageQueueService] Updated message ${messageId} text in ${conversationId}`)
    }
    this.emitQueueUpdate(conversationId)

    return true
  }

  /**
   * Peek at the next pending message without removing it
   */
  peek(conversationId: string): QueuedMessage | null {
    const queue = this.queues.get(conversationId)
    if (!queue || queue.length === 0) return null
    // Return the first pending message, skipping processing/failed/cancelled items
    return queue.find((m) => m.status === "pending") || null
  }

  /**
   * Mark a message as currently being processed.
   * This prevents UI actions (edit/remove) from affecting the message while processing.
   */
  markProcessing(conversationId: string, messageId: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue) return false

    const message = queue.find((m) => m.id === messageId)
    if (!message) return false

    message.status = "processing"
    logApp(`[MessageQueueService] Marked message ${messageId} as processing in ${conversationId}`)
    this.emitQueueUpdate(conversationId)

    return true
  }

  /**
   * Mark a message as successfully processed and remove it from the queue
   * Finds the message by ID regardless of position (handles queue reordering during processing)
   */
  markProcessed(conversationId: string, messageId: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue || queue.length === 0) return false

    const index = queue.findIndex((m) => m.id === messageId)
    if (index === -1) {
      logApp(`[MessageQueueService] Warning: markProcessed called for ${messageId} but message not found in queue`)
      return false
    }

    if (index !== 0) {
      logApp(`[MessageQueueService] Message ${messageId} was at position ${index} (queue was reordered during processing)`)
    }

    queue.splice(index, 1)
    if (queue.length === 0) {
      this.queues.delete(conversationId)
    }
    logApp(`[MessageQueueService] Marked message ${messageId} as processed for ${conversationId}`)
    this.emitQueueUpdate(conversationId)

    return true
  }

  /**
   * Mark a message as failed with an error message
   */
  markFailed(conversationId: string, messageId: string, errorMessage: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue || queue.length === 0) return false

    const message = queue.find((m) => m.id === messageId)
    if (!message) {
      logApp(`[MessageQueueService] Warning: markFailed called for ${messageId} but message not found in queue`)
      return false
    }

    message.status = "failed"
    message.errorMessage = errorMessage
    logApp(`[MessageQueueService] Marked message ${messageId} as failed for ${conversationId}: ${errorMessage}`)
    this.emitQueueUpdate(conversationId)

    return true
  }

  /**
   * Mark a message as having been added to conversation history.
   * This prevents duplicates when retrying failed messages.
   */
  markAddedToHistory(conversationId: string, messageId: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue) return false

    const message = queue.find((m) => m.id === messageId)
    if (!message) return false

    message.addedToHistory = true
    logApp(`[MessageQueueService] Marked message ${messageId} as added to history in ${conversationId}`)
    // Note: No need to emit queue update - this is an internal tracking flag
    return true
  }

  /**
   * Reorder messages in the queue
   */
  reorderQueue(conversationId: string, messageIds: string[]): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue) return false

    const messageMap = new Map(queue.map((m) => [m.id, m]))

    const newQueue: QueuedMessage[] = []
    for (const id of messageIds) {
      const message = messageMap.get(id)
      if (message) {
        newQueue.push(message)
        messageMap.delete(id)
      }
    }

    messageMap.forEach((m) => newQueue.push(m))

    this.queues.set(conversationId, newQueue)
    logApp(`[MessageQueueService] Reordered queue for ${conversationId}`)
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
        try {
          const handlers = getRendererHandlers<RendererHandlers>(win.webContents)
          if (handlers?.onMessageQueueUpdate) {
            try {
              handlers.onMessageQueueUpdate.send({
                conversationId,
                queue,
              })
            } catch (error) {
              logApp("Failed to send queue update:", error)
            }
          }
        } catch (error) {
          logApp("Failed to get renderer handlers for queue update:", error)
        }
      }
    })
  }
}

export const messageQueueService = MessageQueueService.getInstance()

