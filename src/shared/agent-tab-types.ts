/**
 * Types for the tabbed agent interface
 */

import { AgentProgressUpdate } from "./types"

export type AgentTabStatus = 
  | 'idle'           // Tab created but no activity
  | 'recording'      // Currently recording voice input
  | 'processing'     // Agent is processing/executing tools
  | 'complete'       // Agent completed successfully
  | 'error'          // Agent encountered an error
  | 'stopped'        // Agent was stopped by user

export interface AgentTab {
  id: string                              // Unique tab ID
  conversationId: string | null           // Associated conversation ID
  title: string                           // Display title
  status: AgentTabStatus                  // Current status
  progress: AgentProgressUpdate | null    // Agent progress data
  createdAt: number                       // Timestamp when tab was created
  updatedAt: number                       // Last update timestamp
  error?: string                          // Error message if status is 'error'
  badge?: number                          // Badge count for unread updates
}

export interface AgentTabState {
  tabs: AgentTab[]
  activeTabId: string | null
}

export interface AgentTabActions {
  createTab: (title?: string) => AgentTab
  closeTab: (tabId: string) => void
  switchTab: (tabId: string) => void
  updateTab: (tabId: string, updates: Partial<AgentTab>) => void
  updateTabProgress: (tabId: string, progress: AgentProgressUpdate) => void
  updateTabStatus: (tabId: string, status: AgentTabStatus) => void
  clearAllTabs: () => void
  getTab: (tabId: string) => AgentTab | undefined
  getActiveTab: () => AgentTab | undefined
}

