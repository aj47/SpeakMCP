/**
 * Hook to synchronize Zustand stores with renderer event handlers.
 * Call this once at the app root to set up listeners.
 */
import { useEffect } from 'react'
import { rendererHandlers, tipcClient } from '@renderer/lib/tipc-client'
import { useAgentStore, useConversationStore, useUIStore } from '@renderer/stores'
import { AgentProgressUpdate, Conversation, ConversationMessage } from '@shared/types'
import { logUI, logStateChange } from '@renderer/lib/debug'
import { useSaveConversationMutation } from '@renderer/lib/queries'

export function useStoreSync() {
  const updateSessionProgress = useAgentStore((s) => s.updateSessionProgress)
  const clearAllProgress = useAgentStore((s) => s.clearAllProgress)
  const clearSessionProgress = useAgentStore((s) => s.clearSessionProgress)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const markConversationCompleted = useConversationStore((s) => s.markConversationCompleted)
  
  const saveConversationMutation = useSaveConversationMutation()

  // Listen for agent progress updates
  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen(
      (update: AgentProgressUpdate) => {
        const sessionId = update.sessionId

        logUI('[useStoreSync] Received progress update:', {
          sessionId,
          iteration: `${update.currentIteration}/${update.maxIterations}`,
          isComplete: update.isComplete,
          isSnoozed: update.isSnoozed,
          stepsCount: update.steps.length,
        })

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

  // Listen for agent progress clear (all)
  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
      logUI('[useStoreSync] Clearing all agent progress')
      clearAllProgress()
    })
    return unlisten
  }, [clearAllProgress])

  // Listen for session-scoped progress clear
  useEffect(() => {
    const unlisten = (rendererHandlers as any).clearAgentSessionProgress?.listen?.(
      (sessionId: string) => {
        logUI('[useStoreSync] Clearing agent progress for session:', sessionId)
        clearSessionProgress(sessionId)
      }
    )
    return unlisten
  }, [clearSessionProgress])

  // Cross-window: focus a specific agent session
  useEffect(() => {
    const unlisten = (rendererHandlers as any).focusAgentSession?.listen?.(
      (sessionId: string) => {
        logUI('[useStoreSync] External focusAgentSession received:', sessionId)
        setFocusedSessionId(sessionId)
      }
    )
    return unlisten
  }, [setFocusedSessionId])

  // Helper to save conversation history
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
      // Silently handle error
    }
  }
}

