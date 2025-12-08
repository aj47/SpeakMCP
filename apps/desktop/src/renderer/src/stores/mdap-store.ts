import { create } from 'zustand'
import { MDAPProgressUpdate } from '@shared/types'

interface MDAPState {
  // State
  mdapProgressById: Map<string, MDAPProgressUpdate>
  focusedMdapSessionId: string | null

  // Actions
  updateMdapProgress: (update: MDAPProgressUpdate) => void
  clearMdapProgress: () => void
  clearMdapSession: (sessionId: string) => void
  setFocusedMdapSession: (sessionId: string | null) => void
  getMdapProgress: (sessionId: string) => MDAPProgressUpdate | null
  getAllMdapSessions: () => MDAPProgressUpdate[]
  getActiveMdapSessions: () => MDAPProgressUpdate[]
  getCompletedMdapSessions: () => MDAPProgressUpdate[]
}

export const useMDAPStore = create<MDAPState>((set, get) => ({
  mdapProgressById: new Map(),
  focusedMdapSessionId: null,

  updateMdapProgress: (update: MDAPProgressUpdate) => {
    set((state) => {
      const newMap = new Map(state.mdapProgressById)
      const isNewSession = !newMap.has(update.sessionId)
      newMap.set(update.sessionId, update)

      // Auto-focus new sessions
      let newFocusedSessionId = state.focusedMdapSessionId
      if (isNewSession && !state.focusedMdapSessionId && !update.isComplete) {
        newFocusedSessionId = update.sessionId
      }

      return {
        mdapProgressById: newMap,
        focusedMdapSessionId: newFocusedSessionId,
      }
    })
  },

  clearMdapProgress: () => {
    set({
      mdapProgressById: new Map(),
      focusedMdapSessionId: null,
    })
  },

  clearMdapSession: (sessionId: string) => {
    set((state) => {
      const newMap = new Map(state.mdapProgressById)
      newMap.delete(sessionId)

      let newFocusedSessionId = state.focusedMdapSessionId
      if (state.focusedMdapSessionId === sessionId) {
        // Find next active session
        const activeSessions = Array.from(newMap.values()).filter(s => !s.isComplete)
        newFocusedSessionId = activeSessions[0]?.sessionId || null
      }

      return {
        mdapProgressById: newMap,
        focusedMdapSessionId: newFocusedSessionId,
      }
    })
  },

  setFocusedMdapSession: (sessionId: string | null) => {
    set({ focusedMdapSessionId: sessionId })
  },

  getMdapProgress: (sessionId: string) => {
    return get().mdapProgressById.get(sessionId) || null
  },

  getAllMdapSessions: () => {
    return Array.from(get().mdapProgressById.values())
  },

  getActiveMdapSessions: () => {
    return Array.from(get().mdapProgressById.values()).filter(s => !s.isComplete)
  },

  getCompletedMdapSessions: () => {
    return Array.from(get().mdapProgressById.values()).filter(s => s.isComplete)
  },
}))

// Computed selectors
export const useFocusedMDAPProgress = () => {
  const focusedMdapSessionId = useMDAPStore((state) => state.focusedMdapSessionId)
  const mdapProgressById = useMDAPStore((state) => state.mdapProgressById)

  if (!focusedMdapSessionId) return null
  return mdapProgressById.get(focusedMdapSessionId) ?? null
}

export const useIsMDAPProcessing = () => {
  const mdapProgressById = useMDAPStore((state) => state.mdapProgressById)
  return Array.from(mdapProgressById.values()).some(s => !s.isComplete)
}
