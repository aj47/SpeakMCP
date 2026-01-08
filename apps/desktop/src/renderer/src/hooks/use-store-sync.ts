import { useEffect } from 'react'
import { rendererHandlers, tipcClient } from '@renderer/lib/tipc-client'
import { useAgentStore, useConversationStore } from '@renderer/stores'
import { AgentProgressUpdate, Conversation, ConversationMessage, QueuedMessage } from '@shared/types'
import { useSaveConversationMutation } from '@renderer/lib/queries'

export function useStoreSync() {
  const updateSessionProgress = useAgentStore((s) => s.updateSessionProgress)
  const clearAllProgress = useAgentStore((s) => s.clearAllProgress)
  const clearSessionProgress = useAgentStore((s) => s.clearSessionProgress)
  const clearInactiveSessions = useAgentStore((s) => s.clearInactiveSessions)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const setScrollToSessionId = useAgentStore((s) => s.setScrollToSessionId)
  const updateMessageQueue = useAgentStore((s) => s.updateMessageQueue)
  const markConversationCompleted = useConversationStore((s) => s.markConversationCompleted)
  const saveConversationMutation = useSaveConversationMutation()

  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen(
      (update: AgentProgressUpdate) => {
        updateSessionProgress(update)

        // Save complete conversation history when agent completes
        if (update.isComplete && update.conversationId) {
          if (update.conversationHistory && update.conversationHistory.length > 0) {
            saveCompleteConversationHistory(
              update.conversationId,
              update.conversationHistory
            )
          }
          markConversationCompleted(update.conversationId)
        }
      }
    )

    return unlisten
  }, [updateSessionProgress, markConversationCompleted])

  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
      clearAllProgress()
    })
    return unlisten
  }, [clearAllProgress])

  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentSessionProgress.listen(
      (sessionId: string) => {
        clearSessionProgress(sessionId)
      }
    )
    return unlisten
  }, [clearSessionProgress])

  useEffect(() => {
    const unlisten = rendererHandlers.clearInactiveSessions.listen(
      () => {
        clearInactiveSessions()
      }
    )
    return unlisten
  }, [clearInactiveSessions])

  useEffect(() => {
    const unlisten = rendererHandlers.focusAgentSession.listen(
      (sessionId: string) => {
        setFocusedSessionId(sessionId)
        setScrollToSessionId(null)
      }
    )
    return unlisten
  }, [setFocusedSessionId, setScrollToSessionId])

  // Listen for message queue updates
  useEffect(() => {
    const unlisten = rendererHandlers.onMessageQueueUpdate.listen(
      (data: { conversationId: string; queue: QueuedMessage[]; isPaused: boolean }) => {
        updateMessageQueue(data.conversationId, data.queue, data.isPaused)
      }
    )
    return unlisten
  }, [updateMessageQueue])

  // Initial hydration of message queues on mount
  useEffect(() => {
    tipcClient.getAllMessageQueues().then((queues: Array<{ conversationId: string; messages: QueuedMessage[]; isPaused: boolean }>) => {
      for (const queue of queues) {
        updateMessageQueue(queue.conversationId, queue.messages, queue.isPaused)
      }
    }).catch(() => {
      // Silently ignore hydration failures
    })
  }, [])

  async function saveCompleteConversationHistory(
    conversationId: string,
    conversationHistory: Array<{
      role: 'user' | 'assistant' | 'tool'
      content: string
      toolCalls?: Array<{ name: string; arguments: any }>
      toolResults?: Array<{ success: boolean; content: string; error?: string }>
      timestamp?: number
    }>
  ) {
    try {
      const currentConv = await tipcClient.loadConversation({ conversationId })
      if (!currentConv) return

      const messages: ConversationMessage[] = conversationHistory.map(
        (entry, index) => ({
          id: `msg_${entry.timestamp || Date.now()}_${index}`,
          role: entry.role,
          content: entry.content,
          timestamp: entry.timestamp || Date.now(),
          toolCalls: entry.toolCalls,
          toolResults: entry.toolResults,
        })
      )

      const updatedConversation: Conversation = {
        ...currentConv,
        messages,
        updatedAt: Date.now(),
      }

      await saveConversationMutation.mutateAsync({
        conversation: updatedConversation,
      })
    } catch (error) {
      console.error('Failed to save conversation history:', error)
    }
  }
}

