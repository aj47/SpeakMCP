import { logApp } from "./debug"
import type { QueuedMessage, MessageQueue } from "@shared/types"

class MessageQueueService {
  private queues: Map<string, QueuedMessage[]> = new Map()

  private generateMessageId(): string {
    return `msg_queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  queueMessage(conversationId: string, text: string): QueuedMessage {
    const message: QueuedMessage = {
      id: this.generateMessageId(),
      conversationId,
      text,
      queuedAt: Date.now(),
    }

    const queue = this.queues.get(conversationId) ?? []
    queue.push(message)
    this.queues.set(conversationId, queue)

    logApp(`[MessageQueue] Queued message ${message.id} for conversation ${conversationId}`)
    return message
  }

  getQueue(conversationId: string): QueuedMessage[] {
    return this.queues.get(conversationId) ?? []
  }

  getAllQueues(): MessageQueue[] {
    const result: MessageQueue[] = []
    for (const [conversationId, messages] of this.queues.entries()) {
      if (messages.length > 0) {
        result.push({ conversationId, messages: [...messages] })
      }
    }
    return result
  }

  removeMessage(conversationId: string, messageId: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue) return false

    const index = queue.findIndex((m) => m.id === messageId)
    if (index === -1) return false

    queue.splice(index, 1)
    if (queue.length === 0) {
      this.queues.delete(conversationId)
    }
    logApp(`[MessageQueue] Removed message ${messageId} from conversation ${conversationId}`)
    return true
  }

  clearQueue(conversationId: string): void {
    const queue = this.queues.get(conversationId)
    const count = queue?.length ?? 0
    this.queues.delete(conversationId)
    logApp(`[MessageQueue] Cleared ${count} messages for conversation ${conversationId}`)
  }

  /**
   * Peek at the next message without removing it.
   * Use this before processing to avoid data loss if processing fails.
   */
  peekNextMessage(conversationId: string): QueuedMessage | undefined {
    const queue = this.queues.get(conversationId)
    if (!queue || queue.length === 0) return undefined
    return queue[0]
  }

  /**
   * Remove and return the next message from the queue.
   * Prefer using peekNextMessage() + removeMessage() for safer processing.
   */
  popNextMessage(conversationId: string): QueuedMessage | undefined {
    const queue = this.queues.get(conversationId)
    if (!queue || queue.length === 0) return undefined

    const message = queue.shift()
    if (queue.length === 0) {
      this.queues.delete(conversationId)
    }
    if (message) {
      logApp(`[MessageQueue] Popped message ${message.id} from conversation ${conversationId}`)
    }
    return message
  }

  getQueueLength(conversationId: string): number {
    return this.queues.get(conversationId)?.length ?? 0
  }

  updateMessageText(conversationId: string, messageId: string, newText: string): boolean {
    const queue = this.queues.get(conversationId)
    if (!queue) return false

    const message = queue.find((m) => m.id === messageId)
    if (!message) return false

    message.text = newText
    logApp(`[MessageQueue] Updated message ${messageId} text in conversation ${conversationId}`)
    return true
  }
}

export const messageQueueService = new MessageQueueService()

