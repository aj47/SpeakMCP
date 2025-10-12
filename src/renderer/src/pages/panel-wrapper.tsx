/**
 * Panel wrapper that conditionally renders traditional panel or tabbed interface
 * based on configuration
 */

import { useConfigQuery } from '@renderer/lib/queries'
import { AgentTabbedPanel } from '@renderer/components/agent-tabbed-panel'
import { Component as TraditionalPanel } from './panel'
import { Loader2 } from 'lucide-react'

export function Component() {
  const configQuery = useConfigQuery()

  // Show loading state while config is loading
  if (configQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Check if tabbed mode is enabled
  const tabbedMode = configQuery.data?.tabbedAgentMode ?? false

  // Debug logging
  console.log('[Panel Wrapper] Config loaded:', {
    tabbedMode,
    fullConfig: configQuery.data
  })

  // Render appropriate interface
  if (tabbedMode) {
    console.log('[Panel Wrapper] Rendering AgentTabbedPanel')
    return <AgentTabbedPanel />
  }

  console.log('[Panel Wrapper] Rendering TraditionalPanel')
  return <TraditionalPanel />
}

