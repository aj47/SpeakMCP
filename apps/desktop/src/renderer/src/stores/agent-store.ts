import { create } from 'zustand'
import { AgentProgressUpdate, QueuedMessage } from '@shared/types'

export type SessionViewMode = 'grid' | 'list'
export type SessionFilter = 'all' | 'active' | 'completed' | 'error'
export type SessionSortBy = 'recent' | 'oldest' | 'status'

interface AgentState {
  agentProgressById: Map<string, AgentProgressUpdate>
  focusedSessionId: string | null
  scrollToSessionId: string | null
  messageQueuesByConversation: Map<string, QueuedMessage[]> // Message queues per conversation

  viewMode: SessionViewMode
  filter: SessionFilter
  sortBy: SessionSortBy
  pinnedSessionIds: Set<string>

  updateSessionProgress: (update: AgentProgressUpdate) => void
  clearAllProgress: () => void
  clearSessionProgress: (sessionId: string) => void
  clearInactiveSessions: () => void
  setFocusedSessionId: (sessionId: string | null) => void
  setScrollToSessionId: (sessionId: string | null) => void
  setSessionSnoozed: (sessionId: string, isSnoozed: boolean) => void
  getAgentProgress: () => AgentProgressUpdate | null

  // Message queue actions
  updateMessageQueue: (conversationId: string, queue: QueuedMessage[]) => void
  getMessageQueue: (conversationId: string) => QueuedMessage[]

  setViewMode: (mode: SessionViewMode) => void
  setFilter: (filter: SessionFilter) => void
  setSortBy: (sortBy: SessionSortBy) => void
  togglePinSession: (sessionId: string) => void
  isPinned: (sessionId: string) => boolean
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agentProgressById: new Map(),
  focusedSessionId: null,
  scrollToSessionId: null,
  messageQueuesByConversation: new Map(),

  viewMode: 'grid' as SessionViewMode,
  filter: 'all' as SessionFilter,
  sortBy: 'recent' as SessionSortBy,
  pinnedSessionIds: new Set<string>(),

  updateSessionProgress: (update: AgentProgressUpdate) => {
    const sessionId = update.sessionId

    set((state) => {
      const newMap = new Map(state.agentProgressById)
      const isNewSession = !newMap.has(sessionId)
      const existingProgress = newMap.get(sessionId)

      let mergedUpdate = update
      if (existingProgress) {
        const hasEmptyHistory = !update.conversationHistory || update.conversationHistory.length === 0
        const hasEmptySteps = !update.steps || update.steps.length === 0

        // Merge delegation steps: preserve existing delegation steps and update/add new ones
        // This ensures parallel delegations and completed delegations persist
        const mergedSteps = (() => {
          const existingSteps = existingProgress.steps || []
          const newSteps = update.steps || []
          
          // Extract existing delegation steps (keyed by runId)
          const existingDelegationSteps = new Map<string, typeof existingSteps[0]>()
          const existingNonDelegationSteps: typeof existingSteps = []
          
          for (const step of existingSteps) {
            if (step.delegation?.runId) {
              existingDelegationSteps.set(step.delegation.runId, step)
            } else {
              existingNonDelegationSteps.push(step)
            }
          }
          
          // Extract new delegation steps (keyed by runId)
          const newDelegationSteps = new Map<string, typeof newSteps[0]>()
          const newNonDelegationSteps: typeof newSteps = []
          
          for (const step of newSteps) {
            if (step.delegation?.runId) {
              newDelegationSteps.set(step.delegation.runId, step)
            } else {
              newNonDelegationSteps.push(step)
            }
          }
          
          // Merge delegation steps: new ones override existing ones with same runId
          const mergedDelegationSteps = new Map(existingDelegationSteps)
          for (const [runId, step] of newDelegationSteps) {
            mergedDelegationSteps.set(runId, step)
          }
          
          // Use new non-delegation steps if available, otherwise keep existing
          const finalNonDelegationSteps = newNonDelegationSteps.length > 0 
            ? newNonDelegationSteps 
            : existingNonDelegationSteps
          
          // Combine: non-delegation steps first, then delegation steps
          return [...finalNonDelegationSteps, ...Array.from(mergedDelegationSteps.values())]
        })()

        if (hasEmptyHistory || hasEmptySteps) {
          mergedUpdate = {
            ...existingProgress,
            ...update,
            conversationHistory: hasEmptyHistory
              ? existingProgress.conversationHistory
              : update.conversationHistory,
            steps: hasEmptySteps
              ? existingProgress.steps
              : mergedSteps,
          }
        } else {
          // Even when update has non-empty steps, we need to preserve delegation steps
          mergedUpdate = {
            ...existingProgress,
            ...update,
            steps: mergedSteps,
          }
        }
      }

      newMap.set(sessionId, mergedUpdate)

      // Only auto-focus new sessions that aren't snoozed or complete
      let newFocusedSessionId = state.focusedSessionId
      if (isNewSession && !state.focusedSessionId && !mergedUpdate.isSnoozed && !mergedUpdate.isComplete) {
        newFocusedSessionId = sessionId
      }

      return {
        agentProgressById: newMap,
        focusedSessionId: newFocusedSessionId,
      }
    })
  },

  clearAllProgress: () => {
    set({
      agentProgressById: new Map(),
      focusedSessionId: null,
    })
  },

  clearSessionProgress: (sessionId: string) => {
    set((state) => {
      const newMap = new Map(state.agentProgressById)
      newMap.delete(sessionId)

      // If the cleared session was focused, move focus to next active session
      let newFocusedSessionId = state.focusedSessionId
      if (state.focusedSessionId === sessionId) {
        // Find next active (non-snoozed) session, preferring most recent
        const candidates = Array.from(newMap.entries())
          .filter(([_, p]) => !p.isSnoozed)
          .sort((a, b) => {
            const ta = a[1].conversationHistory?.[0]?.timestamp || 0
            const tb = b[1].conversationHistory?.[0]?.timestamp || 0
            return tb - ta
          })
        newFocusedSessionId = candidates[0]?.[0] || null
      }

      return {
        agentProgressById: newMap,
        focusedSessionId: newFocusedSessionId,
      }
    })
  },

  clearInactiveSessions: () => {
    set((state) => {
      const newMap = new Map<string, AgentProgressUpdate>()

      // Keep only active (not complete) sessions
      for (const [sessionId, progress] of state.agentProgressById.entries()) {
        if (!progress.isComplete) {
          newMap.set(sessionId, progress)
        }
      }

      // If the focused session was cleared, move focus to next active session
      let newFocusedSessionId = state.focusedSessionId
      if (state.focusedSessionId && !newMap.has(state.focusedSessionId)) {
        const candidates = Array.from(newMap.entries())
          .filter(([_, p]) => !p.isSnoozed)
          .sort((a, b) => {
            const ta = a[1].conversationHistory?.[0]?.timestamp || 0
            const tb = b[1].conversationHistory?.[0]?.timestamp || 0
            return tb - ta
          })
        newFocusedSessionId = candidates[0]?.[0] || null
      }

      return {
        agentProgressById: newMap,
        focusedSessionId: newFocusedSessionId,
      }
    })
  },

  setFocusedSessionId: (sessionId: string | null) => {
    set({ focusedSessionId: sessionId })
  },

  setScrollToSessionId: (sessionId: string | null) => {
    set({ scrollToSessionId: sessionId })
  },

  setSessionSnoozed: (sessionId: string, isSnoozed: boolean) => {
    set((state) => {
      const existingProgress = state.agentProgressById.get(sessionId)
      if (!existingProgress) return state

      const newMap = new Map(state.agentProgressById)
      newMap.set(sessionId, { ...existingProgress, isSnoozed })
      return { agentProgressById: newMap }
    })
  },

  getAgentProgress: () => {
    const state = get()
    if (!state.focusedSessionId) return null
    return state.agentProgressById.get(state.focusedSessionId) ?? null
  },

  // Message queue actions
  updateMessageQueue: (conversationId: string, queue: QueuedMessage[]) => {
    set((state) => {
      const newMap = new Map(state.messageQueuesByConversation)
      if (queue.length === 0) {
        newMap.delete(conversationId)
      } else {
        newMap.set(conversationId, queue)
      }
      return { messageQueuesByConversation: newMap }
    })
  },

  getMessageQueue: (conversationId: string) => {
    return get().messageQueuesByConversation.get(conversationId) || []
  },

  // View settings actions
  setViewMode: (mode: SessionViewMode) => {
    set({ viewMode: mode })
  },

  setFilter: (filter: SessionFilter) => {
    set({ filter })
  },

  setSortBy: (sortBy: SessionSortBy) => {
    set({ sortBy })
  },

  togglePinSession: (sessionId: string) => {
    set((state) => {
      const newPinned = new Set(state.pinnedSessionIds)
      if (newPinned.has(sessionId)) {
        newPinned.delete(sessionId)
      } else {
        newPinned.add(sessionId)
      }
      return { pinnedSessionIds: newPinned }
    })
  },

  isPinned: (sessionId: string) => {
    return get().pinnedSessionIds.has(sessionId)
  },
}))

// Computed selectors
export const useAgentProgress = () => {
  const focusedSessionId = useAgentStore((state) => state.focusedSessionId)
  const agentProgressById = useAgentStore((state) => state.agentProgressById)
  
  if (!focusedSessionId) return null
  return agentProgressById.get(focusedSessionId) ?? null
}

export const useIsAgentProcessing = () => {
  const agentProgress = useAgentProgress()
  return !!agentProgress && !agentProgress.isComplete
}

// Hook to get message queue for a specific conversation
export const useMessageQueue = (conversationId: string | undefined) => {
  const messageQueuesByConversation = useAgentStore((state) => state.messageQueuesByConversation)
  if (!conversationId) return []
  return messageQueuesByConversation.get(conversationId) || []
}
