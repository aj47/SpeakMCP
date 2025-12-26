import { tipc } from "@egoist/tipc/main"
import { logLLM } from "../debug"
import { messageQueueService } from "../message-queue-service"
import { agentSessionTracker } from "../agent-session-tracker"

const t = tipc.create()

// Import processQueuedMessages - this will be needed when merging the routers
// For now, we'll assume it's available in the main tipc.ts scope

export const messageQueueHandlers = {
  getMessageQueue: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
          return messageQueueService.getQueue(input.conversationId)
    }),

  getAllMessageQueues: t.procedure.action(async () => {
      return messageQueueService.getAllQueues()
  }),

  removeFromMessageQueue: t.procedure
    .input<{ conversationId: string; messageId: string }>()
    .action(async ({ input }) => {
          return messageQueueService.removeFromQueue(input.conversationId, input.messageId)
    }),

  clearMessageQueue: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
          return messageQueueService.clearQueue(input.conversationId)
    }),

  reorderMessageQueue: t.procedure
    .input<{ conversationId: string; messageIds: string[] }>()
    .action(async ({ input }) => {
          return messageQueueService.reorderQueue(input.conversationId, input.messageIds)
    }),

  updateQueuedMessageText: t.procedure
    .input<{ conversationId: string; messageId: string; text: string }>()
    .action(async ({ input }) => {

      // Check if this was a failed message before updating
      const queue = messageQueueService.getQueue(input.conversationId)
      const message = queue.find((m) => m.id === input.messageId)
      const wasFailed = message?.status === "failed"

      const success = messageQueueService.updateMessageText(input.conversationId, input.messageId, input.text)
      if (!success) return false

      // If this was a failed message that's now reset to pending,
      // check if conversation is idle and trigger queue processing
      if (wasFailed) {
              const activeSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
        if (activeSessionId) {
          const session = agentSessionTracker.getSession(activeSessionId)
          if (session && session.status === "active") {
            // Session is active, queue will be processed when it completes
            return true
          }
        }

        // Conversation is idle, trigger queue processing
        // Note: processQueuedMessages needs to be imported from tipc.ts
        const { processQueuedMessages } = await import("../tipc")
        processQueuedMessages(input.conversationId).catch((err: any) => {
          logLLM("[updateQueuedMessageText] Error processing queued messages:", err)
        })
      }

      return true
    }),

  retryQueuedMessage: t.procedure
    .input<{ conversationId: string; messageId: string }>()
    .action(async ({ input }) => {

      // Use resetToPending to reset failed message status without modifying text
      // This works even for addedToHistory messages since we're not changing the text
      const success = messageQueueService.resetToPending(input.conversationId, input.messageId)
      if (!success) return false

      // Check if conversation is idle (no active session)
      const activeSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
      if (activeSessionId) {
        const session = agentSessionTracker.getSession(activeSessionId)
        if (session && session.status === "active") {
          // Session is active, queue will be processed when it completes
          return true
        }
      }

      // Conversation is idle, trigger queue processing
      // Note: processQueuedMessages needs to be imported from tipc.ts
      const { processQueuedMessages } = await import("../tipc")
      processQueuedMessages(input.conversationId).catch((err: any) => {
        logLLM("[retryQueuedMessage] Error processing queued messages:", err)
      })

      return true
    }),

  isMessageQueuePaused: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
          return messageQueueService.isQueuePaused(input.conversationId)
    }),

  resumeMessageQueue: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {

      // Resume the queue
      messageQueueService.resumeQueue(input.conversationId)

      // Check if conversation is idle (no active session) and trigger queue processing
      const activeSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
      if (activeSessionId) {
        const session = agentSessionTracker.getSession(activeSessionId)
        if (session && session.status === "active") {
          // Session is active, queue will be processed when it completes
          return true
        }
      }

      // Conversation is idle, trigger queue processing
      // Note: processQueuedMessages needs to be imported from tipc.ts
      const { processQueuedMessages } = await import("../tipc")
      processQueuedMessages(input.conversationId).catch((err: any) => {
        logLLM("[resumeMessageQueue] Error processing queued messages:", err)
      })

      return true
    }),
}
