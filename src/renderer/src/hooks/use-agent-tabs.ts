/**
 * Hook for managing agent tabs
 * Provides state and actions for the tabbed agent interface
 */

import { useState, useCallback, useEffect } from 'react'
import { AgentTab, AgentTabStatus, AgentTabState, AgentTabActions } from '@shared/agent-tab-types'
import { AgentProgressUpdate } from '@shared/types'

const MAX_TABS = 10 // Maximum number of tabs allowed

// Simple UUID generator
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function useAgentTabs(): AgentTabState & AgentTabActions {
  const [tabs, setTabs] = useState<AgentTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // Create a new tab
  const createTab = useCallback((title?: string): AgentTab => {
    // Check max tabs limit
    if (tabs.length >= MAX_TABS) {
      throw new Error(`Maximum of ${MAX_TABS} tabs allowed`)
    }

    const newTab: AgentTab = {
      id: generateId(),
      conversationId: null,
      title: title || `Agent ${tabs.length + 1}`,
      status: 'idle',
      progress: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)

    return newTab
  }, [tabs.length])

  // Close a tab
  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const filtered = prev.filter(tab => tab.id !== tabId)
      
      // If closing active tab, switch to another tab
      if (tabId === activeTabId) {
        const closedIndex = prev.findIndex(tab => tab.id === tabId)
        if (filtered.length > 0) {
          // Switch to the tab before the closed one, or the first tab
          const newActiveIndex = Math.max(0, closedIndex - 1)
          setActiveTabId(filtered[newActiveIndex]?.id || null)
        } else {
          setActiveTabId(null)
        }
      }
      
      return filtered
    })
  }, [activeTabId])

  // Switch to a different tab
  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    
    // Clear badge when switching to a tab
    setTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, badge: undefined } : tab
    ))
  }, [])

  // Update tab properties
  const updateTab = useCallback((tabId: string, updates: Partial<AgentTab>) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId
        ? { ...tab, ...updates, updatedAt: Date.now() }
        : tab
    ))
  }, [])

  // Update tab progress
  const updateTabProgress = useCallback((tabId: string, progress: AgentProgressUpdate) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== tabId) return tab

      // Determine status from progress
      let status: AgentTabStatus = 'processing'
      if (progress.isComplete) {
        status = 'complete'
      }

      // Add badge if tab is not active
      const badge = tab.id !== activeTabId && !progress.isComplete
        ? (tab.badge || 0) + 1
        : undefined

      return {
        ...tab,
        progress,
        status,
        badge,
        updatedAt: Date.now(),
      }
    }))
  }, [activeTabId])

  // Update tab status
  const updateTabStatus = useCallback((tabId: string, status: AgentTabStatus) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId
        ? { ...tab, status, updatedAt: Date.now() }
        : tab
    ))
  }, [])

  // Clear all tabs
  const clearAllTabs = useCallback(() => {
    setTabs([])
    setActiveTabId(null)
  }, [])

  // Get a specific tab
  const getTab = useCallback((tabId: string): AgentTab | undefined => {
    return tabs.find(tab => tab.id === tabId)
  }, [tabs])

  // Get the active tab
  const getActiveTab = useCallback((): AgentTab | undefined => {
    if (!activeTabId) return undefined
    return tabs.find(tab => tab.id === activeTabId)
  }, [tabs, activeTabId])

  // Auto-create first tab if none exist
  useEffect(() => {
    if (tabs.length === 0) {
      createTab('Agent 1')
    }
  }, []) // Only run on mount

  return {
    tabs,
    activeTabId,
    createTab,
    closeTab,
    switchTab,
    updateTab,
    updateTabProgress,
    updateTabStatus,
    clearAllTabs,
    getTab,
    getActiveTab,
  }
}

