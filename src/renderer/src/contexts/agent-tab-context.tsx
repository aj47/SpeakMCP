/**
 * Context for managing per-tab agent state in tabbed mode
 * This allows each tab to have its own agent progress, recording state, etc.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { AgentProgressUpdate } from '@shared/types'
import { rendererHandlers } from '@renderer/lib/tipc-client'

interface TabAgentState {
  agentProgress: AgentProgressUpdate | null
  recording: boolean
  mcpMode: boolean
  conversationId: string | null
}

interface AgentTabContextValue {
  // Get state for a specific tab
  getTabState: (tabId: string) => TabAgentState
  
  // Update state for a specific tab
  setTabAgentProgress: (tabId: string, progress: AgentProgressUpdate | null) => void
  setTabRecording: (tabId: string, recording: boolean) => void
  setTabMcpMode: (tabId: string, mcpMode: boolean) => void
  setTabConversationId: (tabId: string, conversationId: string | null) => void
  
  // Active tab
  activeTabId: string | null
  setActiveTabId: (tabId: string | null) => void
  
  // Get active tab state
  activeTabState: TabAgentState
}

const defaultTabState: TabAgentState = {
  agentProgress: null,
  recording: false,
  mcpMode: false,
  conversationId: null,
}

const AgentTabContext = createContext<AgentTabContextValue | null>(null)

export function AgentTabProvider({ children }: { children: React.ReactNode }) {
  // Map of tabId -> TabAgentState
  const [tabStates, setTabStates] = useState<Map<string, TabAgentState>>(new Map())
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // Get state for a specific tab (or default if not found)
  const getTabState = useCallback((tabId: string): TabAgentState => {
    return tabStates.get(tabId) || { ...defaultTabState }
  }, [tabStates])

  // Update agent progress for a specific tab
  const setTabAgentProgress = useCallback((tabId: string, progress: AgentProgressUpdate | null) => {
    setTabStates(prev => {
      const newMap = new Map(prev)
      const currentState = newMap.get(tabId) || { ...defaultTabState }
      newMap.set(tabId, { ...currentState, agentProgress: progress })
      return newMap
    })
  }, [])

  // Update recording state for a specific tab
  const setTabRecording = useCallback((tabId: string, recording: boolean) => {
    setTabStates(prev => {
      const newMap = new Map(prev)
      const currentState = newMap.get(tabId) || { ...defaultTabState }
      newMap.set(tabId, { ...currentState, recording })
      return newMap
    })
  }, [])

  // Update MCP mode for a specific tab
  const setTabMcpMode = useCallback((tabId: string, mcpMode: boolean) => {
    setTabStates(prev => {
      const newMap = new Map(prev)
      const currentState = newMap.get(tabId) || { ...defaultTabState }
      newMap.set(tabId, { ...currentState, mcpMode })
      return newMap
    })
  }, [])

  // Update conversation ID for a specific tab
  const setTabConversationId = useCallback((tabId: string, conversationId: string | null) => {
    setTabStates(prev => {
      const newMap = new Map(prev)
      const currentState = newMap.get(tabId) || { ...defaultTabState }
      newMap.set(tabId, { ...currentState, conversationId })
      return newMap
    })
  }, [])

  // Get active tab state
  const activeTabState = activeTabId ? getTabState(activeTabId) : { ...defaultTabState }

  // Listen for agent progress updates and route to correct tab
  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen(
      (update: AgentProgressUpdate) => {
        console.log('[AgentTabContext] Progress update received:', {
          conversationId: update.conversationId,
          activeTabId,
          isComplete: update.isComplete
        })

        if (!activeTabId) {
          console.warn('[AgentTabContext] No active tab, ignoring progress update')
          return
        }

        // Route progress to active tab
        // In the future, we could route based on conversationId if we track that per tab
        setTabAgentProgress(activeTabId, update)

        // Update conversation ID if provided
        if (update.conversationId) {
          setTabConversationId(activeTabId, update.conversationId)
        }
      }
    )

    return unlisten
  }, [activeTabId, setTabAgentProgress, setTabConversationId])

  // Listen for recording start
  useEffect(() => {
    const unlisten = rendererHandlers.startMcpRecording.listen(() => {
      console.log('[AgentTabContext] Recording started for tab:', activeTabId)
      if (activeTabId) {
        setTabRecording(activeTabId, true)
        setTabMcpMode(activeTabId, true)
      }
    })

    return unlisten
  }, [activeTabId, setTabRecording, setTabMcpMode])

  // Listen for recording finish
  useEffect(() => {
    const unlisten = rendererHandlers.finishMcpRecording.listen(() => {
      console.log('[AgentTabContext] Recording finished for tab:', activeTabId)
      if (activeTabId) {
        setTabRecording(activeTabId, false)
      }
    })

    return unlisten
  }, [activeTabId, setTabRecording])

  // Listen for agent progress clear
  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
      console.log('[AgentTabContext] Clearing progress for tab:', activeTabId)
      if (activeTabId) {
        setTabAgentProgress(activeTabId, null)
        setTabMcpMode(activeTabId, false)
      }
    })

    return unlisten
  }, [activeTabId, setTabAgentProgress, setTabMcpMode])

  const value: AgentTabContextValue = {
    getTabState,
    setTabAgentProgress,
    setTabRecording,
    setTabMcpMode,
    setTabConversationId,
    activeTabId,
    setActiveTabId,
    activeTabState,
  }

  return (
    <AgentTabContext.Provider value={value}>
      {children}
    </AgentTabContext.Provider>
  )
}

export function useAgentTabContext() {
  const context = useContext(AgentTabContext)
  if (!context) {
    throw new Error('useAgentTabContext must be used within AgentTabProvider')
  }
  return context
}

// Hook to get the current tab's agent progress
export function useCurrentTabAgentProgress(): AgentProgressUpdate | null {
  const { activeTabState } = useAgentTabContext()
  return activeTabState.agentProgress
}

// Hook to check if current tab is recording
export function useCurrentTabRecording(): boolean {
  const { activeTabState } = useAgentTabContext()
  return activeTabState.recording
}

// Hook to check if current tab is in MCP mode
export function useCurrentTabMcpMode(): boolean {
  const { activeTabState } = useAgentTabContext()
  return activeTabState.mcpMode
}

