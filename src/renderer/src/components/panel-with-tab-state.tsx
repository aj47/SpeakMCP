/**
 * Wrapper for the traditional panel that overrides agent progress state
 * when in tabbed mode to use per-tab state instead of global state
 */

import { Component as TraditionalPanel } from '@renderer/pages/panel'
import { useAgentTabContext } from '@renderer/contexts/agent-tab-context'
import { useConfigQuery } from '@renderer/lib/queries'
import { useEffect, useState } from 'react'
import { AgentProgressUpdate } from '@shared/types'
import { rendererHandlers } from '@renderer/lib/tipc-client'

export function PanelWithTabState() {
  const configQuery = useConfigQuery()
  const tabbedMode = configQuery.data?.tabbedAgentMode ?? false

  // If not in tabbed mode, just render traditional panel
  if (!tabbedMode) {
    return <TraditionalPanel />
  }

  // In tabbed mode, use the tab-aware version
  return <TabbedPanelWrapper />
}

function TabbedPanelWrapper() {
  const { activeTabState, setTabAgentProgress, activeTabId } = useAgentTabContext()
  const [localAgentProgress, setLocalAgentProgress] = useState<AgentProgressUpdate | null>(
    activeTabState.agentProgress
  )

  // Sync local state with active tab state
  useEffect(() => {
    setLocalAgentProgress(activeTabState.agentProgress)
  }, [activeTabState.agentProgress])

  // Intercept agent progress updates and route to current tab
  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen(
      (update: AgentProgressUpdate) => {
        console.log('[TabbedPanelWrapper] Intercepted progress update for tab:', activeTabId)
        
        if (activeTabId) {
          // Update the tab's progress in context
          setTabAgentProgress(activeTabId, update)
          // Update local state for immediate rendering
          setLocalAgentProgress(update)
        }
      }
    )

    return unlisten
  }, [activeTabId, setTabAgentProgress])

  // Intercept clear progress and route to current tab
  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
      console.log('[TabbedPanelWrapper] Intercepted clear progress for tab:', activeTabId)
      
      if (activeTabId) {
        setTabAgentProgress(activeTabId, null)
        setLocalAgentProgress(null)
      }
    })

    return unlisten
  }, [activeTabId, setTabAgentProgress])

  // Render traditional panel
  // Note: The traditional panel will still manage its own state,
  // but we're intercepting the IPC messages to route them per-tab
  return <TraditionalPanel />
}

