import { create } from 'zustand'
import { AgentProgressUpdate } from '@shared/types'

// View settings for the sessions dashboard
export type SessionViewMode = 'grid' | 'list'
export type SessionFilter = 'all' | 'active' | 'completed' | 'error'
export type SessionSortBy = 'recent' | 'oldest' | 'status'

interface AgentState {
  // State
  agentProgressById: Map<string, AgentProgressUpdate>
  focusedSessionId: string | null
  scrollToSessionId: string | null // Triggers scroll to a session tile when set

  // View settings for sessions dashboard
  viewMode: SessionViewMode
  filter: SessionFilter
  sortBy: SessionSortBy
  pinnedSessionIds: Set<string>

  // Actions
  updateSessionProgress: (update: AgentProgressUpdate) => void
  clearAllProgress: () => void
  clearSessionProgress: (sessionId: string) => void
  clearInactiveSessions: () => void
  setFocusedSessionId: (sessionId: string | null) => void
  setScrollToSessionId: (sessionId: string | null) => void
  setSessionSnoozed: (sessionId: string, isSnoozed: boolean) => void
  getAgentProgress: () => AgentProgressUpdate | null

  // View settings actions
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

  // View settings defaults
  viewMode: 'grid' as SessionViewMode,
  filter: 'all' as SessionFilter,
  sortBy: 'recent' as SessionSortBy,
  pinnedSessionIds: new Set<string>(),

  updateSessionProgress: (update: AgentProgressUpdate) => {
    const sessionId = update.sessionId

    set((state) => {
      const newMap = new Map(state.agentProgressById)
      // Use Map.has() for explicit key presence check - more robust than falsy check
      // since it correctly handles potential edge cases with stored values
      const isNewSession = !newMap.has(sessionId)
      const existingProgress = newMap.get(sessionId)

      // Merge with existing progress to preserve conversation history and steps
      // when they're not provided in the update (e.g., tool approval updates)
      let mergedUpdate = update
      if (existingProgress) {
        // Check if this is a partial update (empty conversationHistory or steps)
        const hasEmptyHistory = !update.conversationHistory || update.conversationHistory.length === 0
        const hasEmptySteps = !update.steps || update.steps.length === 0

        // If either is empty, merge with existing data to preserve state
        if (hasEmptyHistory || hasEmptySteps) {
          mergedUpdate = {
            ...existingProgress,
            ...update,
            // Preserve existing conversation history if the update has empty/missing history
            conversationHistory: hasEmptyHistory
              ? existingProgress.conversationHistory
              : update.conversationHistory,
            // Preserve existing steps if the update has empty steps
            steps: hasEmptySteps
              ? existingProgress.steps
              : update.steps,
          }
        }
      }

      newMap.set(sessionId, mergedUpdate)

      // Only auto-focus when a NEW session starts (not already in our map)
      // This prevents unexpected jumps when switching between sessions:
      // - If user snoozes session A, focusedSessionId becomes null
      // - A progress update from running session B should NOT auto-steal focus
      // - Only a genuinely new session should auto-focus
      // Also requires: not snoozed AND not complete
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

