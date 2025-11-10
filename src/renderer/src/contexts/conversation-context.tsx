import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
} from "react"
import {
  Conversation,
  ConversationMessage,
  AgentProgressUpdate,
} from "@shared/types"
import {
  useCreateConversationMutation,
  useAddMessageToConversationMutation,
  useSaveConversationMutation,
  useConversationQuery,
} from "@renderer/lib/query-client"
import { rendererHandlers, tipcClient } from "@renderer/lib/tipc-client"
import { logUI, logStateChange } from "@renderer/lib/debug"

interface ConversationContextType {
  // Current conversation state
  currentConversation: Conversation | null
  currentConversationId: string | null
  isConversationActive: boolean

  // Conversation management
  startNewConversation: (
    firstMessage: string,
    role?: "user" | "assistant",
  ) => Promise<Conversation | null>
  continueConversation: (conversationId: string) => void
  addMessage: (
    content: string,
    role: "user" | "assistant" | "tool",
    toolCalls?: any[],
    toolResults?: any[],
  ) => Promise<void>
  endConversation: () => void

  // UI state
  showContinueButton: boolean
  setShowContinueButton: (show: boolean) => void
  isWaitingForResponse: boolean
  setIsWaitingForResponse: (waiting: boolean) => void

  // Agent progress state (session-aware)
  agentProgress: AgentProgressUpdate | null
  agentProgressById: Map<string, AgentProgressUpdate>
  focusedSessionId: string | null
  setFocusedSessionId: (sessionId: string | null) => void
  isAgentProcessing: boolean
}

const ConversationContext = createContext<ConversationContextType | undefined>(
  undefined,
)

interface ConversationProviderProps {
  children: ReactNode
}

export function ConversationProvider({ children }: ConversationProviderProps) {
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null)
  const [showContinueButton, setShowContinueButton] = useState(false)
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false)

  // Store progress per session (Map<sessionId, AgentProgressUpdate>)
  const [agentProgressById, setAgentProgressById] = useState<Map<string, AgentProgressUpdate>>(new Map())

  // Track the focused session ID (for UI display)
  const [focusedSessionId, setFocusedSessionIdInternal] = useState<string | null>(null)

  // Wrap setFocusedSessionId with logging
  const setFocusedSessionId = useCallback((sessionId: string | null) => {
    logStateChange('ConversationContext', 'focusedSessionId', focusedSessionId, sessionId)
    setFocusedSessionIdInternal(sessionId)
  }, [focusedSessionId])

  // Computed: get the progress for the focused session ONLY
  // Don't show any progress if no session is focused (e.g., when snoozed)
  const agentProgress = focusedSessionId
    ? agentProgressById.get(focusedSessionId) ?? null
    : null

  // Log when agentProgress changes
  useEffect(() => {
    logUI('[ConversationContext] agentProgress changed:', {
      focusedSessionId,
      hasProgress: !!agentProgress,
      sessionId: agentProgress?.sessionId,
      isComplete: agentProgress?.isComplete,
      isSnoozed: agentProgress?.isSnoozed,
      totalSessions: agentProgressById.size,
      allSessionIds: Array.from(agentProgressById.keys())
    })
  }, [agentProgress, focusedSessionId, agentProgressById.size])

  // Queries and mutations
  const conversationQuery = useConversationQuery(currentConversationId)
  const createConversationMutation = useCreateConversationMutation()
  const addMessageMutation = useAddMessageToConversationMutation()
  const saveConversationMutation = useSaveConversationMutation()

  const currentConversation = conversationQuery.data || null
  const isConversationActive = !!currentConversation
  const isAgentProcessing = !!agentProgress && !agentProgress.isComplete

  // Define saveCompleteConversationHistory before useEffect that uses it
  const saveCompleteConversationHistory = useCallback(
    async (
      conversationId: string,
      conversationHistory: Array<{
        role: "user" | "assistant" | "tool"
        content: string
        toolCalls?: Array<{ name: string; arguments: any }>
        toolResults?: Array<{ success: boolean; content: string; error?: string }>
        timestamp?: number
      }>,
    ) => {
      try {
        // Load the conversation directly using the conversation ID
        // Don't use conversationQuery.refetch() because it's tied to currentConversationId which might be null
        const currentConv = await tipcClient.loadConversation({ conversationId })

        if (!currentConv) {
          return
        }

        // Convert conversation history to conversation messages
        // Preserve original timestamps from backend to maintain accurate message ordering
        const messages: ConversationMessage[] = conversationHistory.map(
          (entry, index) => ({
            id: `msg_${entry.timestamp || Date.now()}_${index}`,
            role: entry.role,
            content: entry.content,
            // Use timestamp from backend if available, otherwise fall back to current time
            timestamp: entry.timestamp || Date.now(),
            toolCalls: entry.toolCalls,
            toolResults: entry.toolResults,
          }),
        )

        // Create updated conversation with all messages
        const updatedConversation: Conversation = {
          ...currentConv,
          messages,
          updatedAt: Date.now(),
        }

        // Save the complete conversation
        await saveConversationMutation.mutateAsync({
          conversation: updatedConversation,
        })
      } catch (error) {
        // Silently handle error
      }
    },
    [saveConversationMutation],
  )

  // Listen for agent progress updates
  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen(
      (update: AgentProgressUpdate) => {
        const sessionId = update.sessionId

        logUI('[ConversationContext] Received progress update:', {
          sessionId,
          iteration: `${update.currentIteration}/${update.maxIterations}`,
          isComplete: update.isComplete,
          isSnoozed: update.isSnoozed,
          stepsCount: update.steps.length
        })

        // Update the progress map for this specific session
        setAgentProgressById((prevMap) => {
          const newMap = new Map(prevMap)
          const prevProgress = newMap.get(sessionId)

          // Only update if the progress has actually changed to prevent flashing
          if (!prevProgress) {
            logUI('[ConversationContext] New session progress:', sessionId)
            newMap.set(sessionId, update)
            return newMap
          }

          // Compare key properties to determine if update is needed
          const hasChanged =
            prevProgress.isComplete !== update.isComplete ||
            prevProgress.currentIteration !== update.currentIteration ||
            prevProgress.steps.length !== update.steps.length ||
            JSON.stringify(prevProgress.steps) !==
              JSON.stringify(update.steps) ||
            prevProgress.finalContent !== update.finalContent ||
            prevProgress.isSnoozed !== update.isSnoozed

          if (hasChanged) {
            logUI('[ConversationContext] Progress changed for session:', sessionId)
            newMap.set(sessionId, update)

            // If session was unsnoozed (snoozed -> not snoozed) and is complete,
            // schedule cleanup since it's now visible and user can see it's done
            if (prevProgress.isSnoozed && !update.isSnoozed && update.isComplete) {
              logUI('[ConversationContext] Unsnoozed completed session, will cleanup in 5s:', sessionId)
              setTimeout(() => {
                logUI('[ConversationContext] Cleaning up unsnoozed completed session:', sessionId)
                setAgentProgressById((prevMap) => {
                  const newMap = new Map(prevMap)
                  const current = newMap.get(sessionId)
                  // Only delete if still not snoozed and complete
                  if (current && !current.isSnoozed && current.isComplete) {
                    newMap.delete(sessionId)
                  }
                  return newMap
                })
              }, 5000)
            }

            return newMap
          }

          return prevMap
        })

        // Auto-focus this session if no session is currently focused AND it's not snoozed
        // Snoozed sessions run in background without stealing focus
        // Only auto-focus active, non-snoozed sessions. Do not re-focus completed sessions.
        if (!update.isSnoozed && !update.isComplete) {
          setFocusedSessionIdInternal((prev) => {
            if (prev) return prev
            logUI('[ConversationContext] Auto-focusing session:', sessionId)
            return sessionId
          })
        }

        // Clean up completed sessions from the map after a delay
        // BUT: Don't delete snoozed sessions - they need to be restorable from the sidebar
        if (update.isComplete && !update.isSnoozed) {
          logUI('[ConversationContext] Session completed (not snoozed), will cleanup in 5s:', sessionId)
          setTimeout(() => {
            logUI('[ConversationContext] Cleaning up completed session:', sessionId)
            setAgentProgressById((prevMap) => {
              const newMap = new Map(prevMap)
              // Double-check it's still not snoozed before deleting
              const current = newMap.get(sessionId)
              if (current && !current.isSnoozed) {
                newMap.delete(sessionId)
              }
              return newMap
            })
            // Clear focus if this was the focused session
            setFocusedSessionIdInternal((prev) => {
              if (prev === sessionId) {
                logUI('[ConversationContext] Clearing focus for completed session:', sessionId)
                return null
              }
              return prev
            })
          }, 5000) // Keep completed sessions visible for 5 seconds
        }

        // Save complete conversation history when agent completes
        // Use conversation ID from the update (sent by backend) instead of local state
        // This ensures we save even if the frontend context doesn't have the ID set
        if (update.isComplete &&
            update.conversationId &&
            update.conversationHistory &&
            update.conversationHistory.length > 0) {
          saveCompleteConversationHistory(update.conversationId, update.conversationHistory).catch(() => {
            // Silently handle error
          })
        }
      },
    )

    return unlisten
  }, [saveCompleteConversationHistory])

  // Listen for agent progress clear
  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
      logUI('[ConversationContext] Clearing all agent progress')
      // Clear all agent progress
      setAgentProgressById(new Map())
      setFocusedSessionIdInternal(null)
    })

    return unlisten
  }, [])

  // Listen for session-scoped progress clear (dismiss a single session)
  useEffect(() => {
    const unlisten = (rendererHandlers as any).clearAgentSessionProgress?.listen?.((sessionId: string) => {
      logUI('[ConversationContext] Clearing agent progress for session:', sessionId)
      // Remove the session and adjust focus to the next available active (non-snoozed) session
      setAgentProgressById((prevMap) => {
        const newMap = new Map(prevMap)
        newMap.delete(sessionId)

        // Determine next focus if current focus was removed
        setFocusedSessionIdInternal((prev) => {
          if (prev !== sessionId) return prev
          const candidates = Array.from(newMap.entries())
            .filter(([_, p]) => !p.isSnoozed)
            .sort((a, b) => {
              const ta = a[1].conversationHistory?.[0]?.timestamp || 0
              const tb = b[1].conversationHistory?.[0]?.timestamp || 0
              return tb - ta
            })
          const nextId = candidates[0]?.[0] || null
          logUI('[ConversationContext] Focus moved to next session after dismiss:', nextId)
          return nextId
        })

        return newMap
      })
    })

    return unlisten
  }, [])


  // Cross-window: focus a specific agent session when requested by main or other windows
  useEffect(() => {
    const unlisten = (rendererHandlers as any).focusAgentSession?.listen?.((sessionId: string) => {
      logUI('[ConversationContext] External focusAgentSession received:', sessionId)
      setFocusedSessionId(sessionId)
    })
    return unlisten
  }, [setFocusedSessionId])

  const startNewConversation = useCallback(
    async (
      firstMessage: string,
      role: "user" | "assistant" = "user",
    ): Promise<Conversation | null> => {
      try {
        const conversation = await createConversationMutation.mutateAsync({
          firstMessage,
          role,
        })
        setCurrentConversationId(conversation.id)
        setShowContinueButton(false)
        setIsWaitingForResponse(false)
        return conversation
      } catch (error) {
        return null
      }
    },
    [createConversationMutation],
  )

  const continueConversation = useCallback((conversationId: string) => {
    setCurrentConversationId(conversationId)
    setShowContinueButton(false)
    setIsWaitingForResponse(false)
  }, [])

  const addMessage = useCallback(
    async (
      content: string,
      role: "user" | "assistant" | "tool",
      toolCalls?: Array<{ name: string; arguments: any }>,
      toolResults?: Array<{
        success: boolean
        content: string
        error?: string
      }>,
    ) => {
      if (!currentConversationId) {
        return
      }

      try {
        await addMessageMutation.mutateAsync({
          conversationId: currentConversationId,
          content,
          role,
          toolCalls,
          toolResults,
        })

        // Show continue button after assistant response
        if (role === "assistant") {
          setShowContinueButton(true)
          setIsWaitingForResponse(false)
        }
      } catch (error) {
        setIsWaitingForResponse(false)
      }
    },
    [currentConversationId, addMessageMutation],
  )

  const endConversation = useCallback(() => {
    setCurrentConversationId(null)
    setShowContinueButton(false)
    setIsWaitingForResponse(false)
  }, [])

  const contextValue: ConversationContextType = {
    currentConversation,
    currentConversationId,
    isConversationActive,
    startNewConversation,
    continueConversation,
    addMessage,
    endConversation,
    showContinueButton,
    setShowContinueButton,
    isWaitingForResponse,
    setIsWaitingForResponse,
    agentProgress,
    agentProgressById,
    focusedSessionId,
    setFocusedSessionId,
    isAgentProcessing,
  }

  return (
    <ConversationContext.Provider value={contextValue}>
      {children}
    </ConversationContext.Provider>
  )
}

export function useConversation() {
  const context = useContext(ConversationContext)
  if (context === undefined) {
    throw new Error(
      "useConversation must be used within a ConversationProvider",
    )
  }
  return context
}

// Hook for managing conversation state in components
export function useConversationState() {
  const {
    currentConversation,
    isConversationActive,
    showContinueButton,
    isWaitingForResponse,
    agentProgress,
    isAgentProcessing,
  } = useConversation()

  return {
    currentConversation,
    isConversationActive,
    showContinueButton,
    isWaitingForResponse,
    agentProgress,
    isAgentProcessing,
    hasMessages: currentConversation?.messages.length ?? 0 > 0,
    lastMessage:
      currentConversation?.messages[currentConversation.messages.length - 1] ||
      null,
  }
}

// Hook for conversation actions
export function useConversationActions() {
  const {
    startNewConversation,
    continueConversation,
    addMessage,
    endConversation,
    setShowContinueButton,
    setIsWaitingForResponse,
  } = useConversation()

  return {
    startNewConversation,
    continueConversation,
    addMessage,
    endConversation,
    setShowContinueButton,
    setIsWaitingForResponse,
  }
}
