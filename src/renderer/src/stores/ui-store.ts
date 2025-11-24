import { create } from 'zustand'

interface UIState {
  // UI visibility
  showContinueButton: boolean
  isWaitingForResponse: boolean
  
  // Actions
  setShowContinueButton: (show: boolean) => void
  setIsWaitingForResponse: (waiting: boolean) => void
  reset: () => void
}

export const useUIStore = create<UIState>((set) => ({
  showContinueButton: false,
  isWaitingForResponse: false,
  
  setShowContinueButton: (show) => set({ showContinueButton: show }),
  setIsWaitingForResponse: (waiting) => set({ isWaitingForResponse: waiting }),
  reset: () => set({ showContinueButton: false, isWaitingForResponse: false }),
}))

