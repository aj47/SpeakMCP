import React, { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ConversationProvider } from "@renderer/contexts/conversation-context"
import { ThemeProvider } from "@renderer/contexts/theme-context"
import { ConversationDisplay } from "@renderer/components/conversation-display"
import { AgentProgress } from "@renderer/components/agent-progress"
import { useConversationQuery } from "@renderer/lib/queries"
import { useConversation } from "@renderer/contexts/conversation-context"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { X, Minimize2, Maximize2 } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { rendererHandlers } from "@renderer/lib/tipc-client"
import { AgentProgressUpdate } from "@shared/types"

interface AgentWindowContentProps {
  conversationId: string
}

function AgentWindowContent({ conversationId }: AgentWindowContentProps) {
  const { data: conversation, isLoading } = useConversationQuery(conversationId)
  const { continueConversation, agentProgress, isAgentProcessing } = useConversation()
  const [localAgentProgress, setLocalAgentProgress] = useState<AgentProgressUpdate | null>(null)

  // Set up conversation context for this window
  useEffect(() => {
    if (conversationId) {
      continueConversation(conversationId)
    }
  }, [conversationId, continueConversation])

  // Listen for agent progress updates
  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen((update: AgentProgressUpdate) => {
      setLocalAgentProgress(update)
    })

    return unlisten
  }, [])

  // Clear agent progress handler
  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
      setLocalAgentProgress(null)
    })

    return unlisten
  }, [])

  const handleCloseWindow = () => {
    tipcClient.closeAgentWindow({ conversationId })
  }

  const handleMinimizeWindow = () => {
    // Minimize the current window
    window.electronAPI?.minimizeWindow?.()
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading conversation...</p>
        </div>
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Conversation not found</p>
          <Button onClick={handleCloseWindow} className="mt-4">
            Close Window
          </Button>
        </div>
      </div>
    )
  }

  const currentAgentProgress = localAgentProgress || agentProgress

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Window Controls */}
      <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500"></div>
          <h1 className="text-sm font-medium truncate max-w-md">
            {conversation.title}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMinimizeWindow}
            className="h-6 w-6 p-0"
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCloseWindow}
            className="h-6 w-6 p-0"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {currentAgentProgress && isAgentProcessing ? (
          <div className="h-full p-4">
            <AgentProgress
              progress={currentAgentProgress}
              variant="default"
              className="h-full"
            />
          </div>
        ) : (
          <div className="h-full p-4">
            <ConversationDisplay
              messages={conversation.messages}
              maxHeight="100%"
              className="h-full"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function AgentWindow() {
  const [searchParams] = useSearchParams()
  const conversationId = searchParams.get("conversationId")

  if (!conversationId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No conversation ID provided</p>
        </div>
      </div>
    )
  }

  return (
    <ThemeProvider>
      <ConversationProvider>
        <AgentWindowContent conversationId={conversationId} />
      </ConversationProvider>
    </ThemeProvider>
  )
}

export const Component = AgentWindow
