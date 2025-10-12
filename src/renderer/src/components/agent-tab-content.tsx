/**
 * Tab content component for the tabbed agent interface
 * Displays different content based on tab status
 */

import { AgentTab } from '@shared/agent-tab-types'
import { cn } from '@renderer/lib/utils'
import { AgentProgress } from './agent-progress'
import { ConversationDisplay } from './conversation-display'
import { useConversationQuery } from '@renderer/lib/queries'
import { Loader2, CheckCircle2, AlertCircle, Mic } from 'lucide-react'
import { Button } from './ui/button'

interface AgentTabContentProps {
  tab: AgentTab
  className?: string
}

// Idle state - waiting for user to start recording
function IdleView({ tab }: { tab: AgentTab }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="rounded-full bg-muted/50 p-6">
            <Mic className="h-12 w-12 text-muted-foreground" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-medium">Ready to Start</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Press Ctrl+Alt to start recording
          </p>
        </div>
      </div>
    </div>
  )
}

// Recording state - show recording indicator
function RecordingView({ tab }: { tab: AgentTab }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="rounded-full bg-blue-500/20 p-6 animate-pulse">
            <Mic className="h-12 w-12 text-blue-500" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-medium">Recording...</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Release Ctrl+Alt to finish
          </p>
        </div>
      </div>
    </div>
  )
}

// Processing state - show agent progress
function ProcessingView({ tab }: { tab: AgentTab }) {
  if (!tab.progress) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mx-auto" />
          <div>
            <h3 className="text-lg font-medium">Processing...</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Agent is working on your request
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full p-4">
      <AgentProgress
        progress={tab.progress}
        variant="default"
        className="h-full"
      />
    </div>
  )
}

// Complete state - show conversation history
function CompleteView({ tab }: { tab: AgentTab }) {
  const { data: conversation, isLoading } = useConversationQuery(
    tab.conversationId || ''
  )

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!conversation || !tab.conversationId) {
    // Show final progress if available
    if (tab.progress) {
      return (
        <div className="h-full p-4">
          <AgentProgress
            progress={tab.progress}
            variant="default"
            className="h-full"
          />
        </div>
      )
    }

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
          <div>
            <h3 className="text-lg font-medium">Complete</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Agent finished successfully
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full p-4">
      <ConversationDisplay
        messages={conversation.messages}
        maxHeight="100%"
        className="h-full"
      />
    </div>
  )
}

// Error state - show error message
function ErrorView({ tab }: { tab: AgentTab }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-4 max-w-md">
        <div className="flex justify-center">
          <div className="rounded-full bg-red-500/20 p-6">
            <AlertCircle className="h-12 w-12 text-red-500" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-medium">Error</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {tab.error || 'An error occurred while processing your request'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // TODO: Implement retry logic
            console.log('Retry clicked')
          }}
        >
          Try Again
        </Button>
      </div>
    </div>
  )
}

// Stopped state - show stopped message
function StoppedView({ tab }: { tab: AgentTab }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="rounded-full bg-gray-500/20 p-6">
            <AlertCircle className="h-12 w-12 text-gray-500" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-medium">Stopped</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Agent was stopped by user
          </p>
        </div>
      </div>
    </div>
  )
}

export function AgentTabContent({ tab, className }: AgentTabContentProps) {
  return (
    <div className={cn('h-full overflow-hidden', className)}>
      {tab.status === 'idle' && <IdleView tab={tab} />}
      {tab.status === 'recording' && <RecordingView tab={tab} />}
      {tab.status === 'processing' && <ProcessingView tab={tab} />}
      {tab.status === 'complete' && <CompleteView tab={tab} />}
      {tab.status === 'error' && <ErrorView tab={tab} />}
      {tab.status === 'stopped' && <StoppedView tab={tab} />}
    </div>
  )
}

