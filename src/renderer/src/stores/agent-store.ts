import { create } from 'zustand'
import { AgentProgressUpdate } from '@shared/types'

interface AgentState {
  // State
  agentProgressById: Map<string, AgentProgressUpdate>
  focusedSessionId: string | null

  // Actions
  updateSessionProgress: (update: AgentProgressUpdate) => void
  clearAllProgress: () => void
  clearSessionProgress: (sessionId: string) => void
  setFocusedSessionId: (sessionId: string | null) => void
  getAgentProgress: () => AgentProgressUpdate | null
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agentProgressById: new Map(),
  focusedSessionId: null,

  updateSessionProgress: (update: AgentProgressUpdate) => {
    const sessionId = update.sessionId

    set((state) => {
      const newMap = new Map(state.agentProgressById)
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

      // Auto-focus this session if no session is currently focused
      // AND it's not snoozed AND not complete
      let newFocusedSessionId = state.focusedSessionId
      if (!state.focusedSessionId && !mergedUpdate.isSnoozed && !mergedUpdate.isComplete) {
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

  setFocusedSessionId: (sessionId: string | null) => {
    set({ focusedSessionId: sessionId })
  },

  getAgentProgress: () => {
    const state = get()
    if (!state.focusedSessionId) return null
    return state.agentProgressById.get(state.focusedSessionId) ?? null
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

