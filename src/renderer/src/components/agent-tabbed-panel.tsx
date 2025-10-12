/**
 * Main tabbed panel component for agent interface
 * Wraps the traditional panel with tabs for multi-agent support
 */

import { useEffect } from 'react'
import { AgentTabBar } from './agent-tab-bar'
import { cn } from '@renderer/lib/utils'
import { useAgentTabs } from '@renderer/hooks/use-agent-tabs'
import { Component as TraditionalPanel } from '@renderer/pages/panel'
import { AgentTabProvider, useAgentTabContext } from '@renderer/contexts/agent-tab-context'

interface AgentTabbedPanelProps {
  className?: string
}

// Inner component that uses the context
function AgentTabbedPanelInner({ className }: AgentTabbedPanelProps) {
  const {
    tabs,
    activeTabId,
    createTab,
    closeTab,
    switchTab,
  } = useAgentTabs()

  const { setActiveTabId } = useAgentTabContext()

  // Sync active tab ID with context
  useEffect(() => {
    if (activeTabId) {
      setActiveTabId(activeTabId)
      console.log('[Tabbed Panel] Active tab changed:', activeTabId)
    }
  }, [activeTabId, setActiveTabId])

  // Handle new tab creation
  const handleNewTab = () => {
    try {
      const newTab = createTab()
      console.log('[Tabbed Panel] Created new tab:', newTab.id)
    } catch (error) {
      console.error('[Tabbed Panel] Failed to create tab:', error)
      // TODO: Show error toast
    }
  }

  // Handle tab close
  const handleCloseTab = (tabId: string) => {
    closeTab(tabId)
    console.log('[Tabbed Panel] Closed tab:', tabId)
  }

  // Handle tab switch
  const handleSwitchTab = (tabId: string) => {
    switchTab(tabId)
    console.log('[Tabbed Panel] Switched to tab:', tabId)
  }

  // Keyboard shortcuts for tab management
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts if not in an input field
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return
      }

      // Cmd/Ctrl + T: New tab
      if ((e.metaKey || e.ctrlKey) && e.key === 't' && !e.shiftKey) {
        e.preventDefault()
        handleNewTab()
        return
      }

      // Cmd/Ctrl + W: Close tab (only if more than one tab)
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && tabs.length > 1) {
        e.preventDefault()
        if (activeTabId) {
          handleCloseTab(activeTabId)
        }
        return
      }

      // Cmd/Ctrl + 1-9: Jump to tab
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const index = parseInt(e.key) - 1
        if (tabs[index]) {
          handleSwitchTab(tabs[index].id)
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tabs, activeTabId, handleNewTab, handleCloseTab, handleSwitchTab])

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Tab Bar */}
      <AgentTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={handleSwitchTab}
        onTabClose={handleCloseTab}
        onNewTab={handleNewTab}
      />

      {/* Traditional Panel Content - Render per tab to maintain separate state */}
      <div className="flex-1 overflow-hidden">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={cn(
              'h-full',
              tab.id === activeTabId ? 'block' : 'hidden'
            )}
          >
            <TraditionalPanel />
          </div>
        ))}
      </div>
    </div>
  )
}

// Main export with context provider
export function AgentTabbedPanel({ className }: AgentTabbedPanelProps) {
  return (
    <AgentTabProvider>
      <AgentTabbedPanelInner className={className} />
    </AgentTabProvider>
  )
}

