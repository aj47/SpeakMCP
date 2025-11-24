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
      newMap.set(sessionId, update)

      // Auto-focus this session if no session is currently focused
      // AND it's not snoozed AND not complete
      let newFocusedSessionId = state.focusedSessionId
      if (!state.focusedSessionId && !update.isSnoozed && !update.isComplete) {
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

