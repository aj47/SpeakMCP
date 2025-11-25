import { create } from 'zustand'

interface ConversationState {
  currentConversationId: string | null

  setCurrentConversationId: (id: string | null) => void
  continueConversation: (conversationId: string) => void
  endConversation: () => void
  markConversationCompleted: (conversationId: string) => void
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  currentConversationId: null,

  setCurrentConversationId: (id) => set({ currentConversationId: id }),

  continueConversation: (conversationId) => set({ currentConversationId: conversationId }),

  endConversation: () => set({ currentConversationId: null }),

  // Clear current conversation if it matches the completed one
  // No longer stores lastCompletedConversationId to prevent message leaking
  markConversationCompleted: (conversationId) => set((state) => ({
    currentConversationId: state.currentConversationId === conversationId ? null : state.currentConversationId,
  })),
}))

