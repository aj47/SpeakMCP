import { useEffect } from 'react'
import { rendererHandlers, tipcClient } from '@renderer/lib/tipc-client'
import { useAgentStore, useConversationStore } from '@renderer/stores'
import { AgentProgressUpdate, Conversation, ConversationMessage, QueuedMessage } from '@shared/types'
import { useSaveConversationMutation } from '@renderer/lib/queries'
import { logUI } from '@renderer/lib/debug'

export function useStoreSync() {
  const updateSessionProgress = useAgentStore((s) => s.updateSessionProgress)
  const clearAllProgress = useAgentStore((s) => s.clearAllProgress)
  const clearSessionProgress = useAgentStore((s) => s.clearSessionProgress)
  const clearInactiveSessions = useAgentStore((s) => s.clearInactiveSessions)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const setScrollToSessionId = useAgentStore((s) => s.setScrollToSessionId)
  const updateMessageQueue = useAgentStore((s) => s.updateMessageQueue)
  const markConversationCompleted = useConversationStore((s) => s.markConversationCompleted)

  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen(
      (update: AgentProgressUpdate) => {
        updateSessionProgress(update)

        // Mark conversation as completed when agent finishes
        // NOTE: We no longer call saveCompleteConversationHistory here because:
        // 1. Messages are already saved incrementally via llm.ts saveMessageIncremental()
        // 2. Calling saveCompleteConversationHistory causes race conditions when multiple
        //    messages arrive for the same conversation - each agent overwrites with its
        //    own in-memory history, causing message order corruption
        if (update.isComplete && update.conversationId) {
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
}
