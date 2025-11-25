import { create } from 'zustand'

interface UIState {
  // Placeholder for future UI state
  // Currently empty after cleanup of unused showContinueButton and isWaitingForResponse
  reset: () => void
}

export const useUIStore = create<UIState>((set) => ({
  reset: () => set({}),
}))

