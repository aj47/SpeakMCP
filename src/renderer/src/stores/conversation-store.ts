import { create } from 'zustand'

interface ConversationState {
  currentConversationId: string | null
  lastCompletedConversationId: string | null

  setCurrentConversationId: (id: string | null) => void
  setLastCompletedConversationId: (id: string | null) => void
  continueConversation: (conversationId: string) => void
  endConversation: () => void
  markConversationCompleted: (conversationId: string) => void
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  currentConversationId: null,
  lastCompletedConversationId: null,

  setCurrentConversationId: (id) => set({ currentConversationId: id }),
  setLastCompletedConversationId: (id) => set({ lastCompletedConversationId: id }),
  
  continueConversation: (conversationId) => set({ currentConversationId: conversationId }),
  
  endConversation: () => set({ currentConversationId: null }),
  
  markConversationCompleted: (conversationId) => set((state) => ({
    lastCompletedConversationId: conversationId,
    currentConversationId: state.currentConversationId === conversationId ? null : state.currentConversationId,
  })),
}))

