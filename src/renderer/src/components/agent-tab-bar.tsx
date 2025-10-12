/**
 * Tab bar component for the tabbed agent interface
 * Displays tabs with status indicators and controls
 */

import { AgentTab, AgentTabStatus } from '@shared/agent-tab-types'
import { cn } from '@renderer/lib/utils'
import { X, Plus, Mic, Loader2, CheckCircle2, AlertCircle, StopCircle, Minimize2 } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { tipcClient } from '@renderer/lib/tipc-client'

interface AgentTabBarProps {
  tabs: AgentTab[]
  activeTabId: string | null
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab: () => void
  className?: string
}

// Get icon for tab status
function getStatusIcon(status: AgentTabStatus) {
  switch (status) {
    case 'recording':
      return <Mic className="h-3 w-3" />
    case 'processing':
      return <Loader2 className="h-3 w-3 animate-spin" />
    case 'complete':
      return <CheckCircle2 className="h-3 w-3" />
    case 'error':
      return <AlertCircle className="h-3 w-3" />
    case 'stopped':
      return <StopCircle className="h-3 w-3" />
    default:
      return null
  }
}

// Get color for tab status
function getStatusColor(status: AgentTabStatus): string {
  switch (status) {
    case 'recording':
      return 'border-blue-500'
    case 'processing':
      return 'border-yellow-500'
    case 'complete':
      return 'border-green-500'
    case 'error':
      return 'border-red-500'
    case 'stopped':
      return 'border-gray-500'
    default:
      return 'border-transparent'
  }
}

// Get text color for tab status
function getStatusTextColor(status: AgentTabStatus): string {
  switch (status) {
    case 'recording':
      return 'text-blue-500'
    case 'processing':
      return 'text-yellow-500'
    case 'complete':
      return 'text-green-500'
    case 'error':
      return 'text-red-500'
    case 'stopped':
      return 'text-gray-500'
    default:
      return 'text-muted-foreground'
  }
}

interface TabProps {
  tab: AgentTab
  isActive: boolean
  onClick: () => void
  onClose: () => void
}

function Tab({ tab, isActive, onClick, onClose }: TabProps) {
  const statusIcon = getStatusIcon(tab.status)
  const statusColor = getStatusColor(tab.status)
  const statusTextColor = getStatusTextColor(tab.status)

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 px-3 py-2 rounded-t-lg cursor-pointer',
        'border-t-2 transition-all duration-200',
        'min-w-[120px] max-w-[200px]',
        'hover:bg-background/80',
        isActive
          ? cn('bg-background', statusColor)
          : 'bg-background/50 border-transparent'
      )}
      onClick={onClick}
    >
      {/* Status Icon */}
      {statusIcon && (
        <span className={cn('flex-shrink-0', statusTextColor)}>
          {statusIcon}
        </span>
      )}

      {/* Tab Title */}
      <span className="flex-1 truncate text-sm font-medium">
        {tab.title}
      </span>

      {/* Badge */}
      {tab.badge && tab.badge > 0 && (
        <Badge
          variant="secondary"
          className="h-5 min-w-[20px] px-1.5 text-xs"
        >
          {tab.badge > 9 ? '9+' : tab.badge}
        </Badge>
      )}

      {/* Close Button */}
      <button
        className={cn(
          'flex-shrink-0 w-5 h-5 rounded hover:bg-muted/50',
          'flex items-center justify-center',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'hover:text-destructive'
        )}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="Close tab"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export function AgentTabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  className,
}: AgentTabBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-1 bg-muted/20 border-b border-border/30',
        className
      )}
    >
      {/* Tabs Container */}
      <div className="flex gap-1 overflow-x-auto flex-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onClick={() => onTabClick(tab.id)}
            onClose={() => onTabClose(tab.id)}
          />
        ))}
      </div>

      {/* New Tab Button */}
      <Button
        variant="ghost"
        size="sm"
        className="flex-shrink-0 w-8 h-8 p-0"
        onClick={onNewTab}
        aria-label="New tab"
        title="New tab (Cmd/Ctrl+T)"
      >
        <Plus className="h-4 w-4" />
      </Button>

      {/* Minimize Panel Button */}
      <Button
        variant="ghost"
        size="sm"
        className="flex-shrink-0 w-8 h-8 p-0"
        onClick={() => {
          // Explicitly minimize the panel (hide it)
          tipcClient.minimizePanelWindow({})
        }}
        aria-label="Minimize panel"
        title="Minimize panel (Esc)"
      >
        <Minimize2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

