import React, { createContext, useContext, useState, useCallback, ReactNode } from "react"
import { Conversation, ConversationMessage } from "@shared/types"
import {
  useCreateConversationMutation,
  useAddMessageToConversationMutation,
  useSaveConversationMutation,
  useConversationQuery
} from "@renderer/lib/query-client"

interface ConversationContextType {
  // Current conversation state
  currentConversation: Conversation | null
  currentConversationId: string | null
  isConversationActive: boolean

  // Conversation management
  startNewConversation: (firstMessage: string, role?: "user" | "assistant") => Promise<Conversation | null>
  continueConversation: (conversationId: string) => void
  addMessage: (content: string, role: "user" | "assistant" | "tool", toolCalls?: any[], toolResults?: any[]) => Promise<void>
  endConversation: () => void

  // UI state
  showContinueButton: boolean
  setShowContinueButton: (show: boolean) => void
  isWaitingForResponse: boolean
  setIsWaitingForResponse: (waiting: boolean) => void
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined)

interface ConversationProviderProps {
  children: ReactNode
}

export function ConversationProvider({ children }: ConversationProviderProps) {
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [showContinueButton, setShowContinueButton] = useState(false)
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false)

  // Queries and mutations
  const conversationQuery = useConversationQuery(currentConversationId)
  const createConversationMutation = useCreateConversationMutation()
  const addMessageMutation = useAddMessageToConversationMutation()
  const saveConversationMutation = useSaveConversationMutation()

  const currentConversation = conversationQuery.data || null
  const isConversationActive = !!currentConversation

  const startNewConversation = useCallback(async (
    firstMessage: string,
    role: "user" | "assistant" = "user"
  ): Promise<Conversation | null> => {
    try {
      const conversation = await createConversationMutation.mutateAsync({ firstMessage, role })
      setCurrentConversationId(conversation.id)
      setShowContinueButton(false)
      setIsWaitingForResponse(false)
      return conversation
    } catch (error) {
      console.error("Failed to start new conversation:", error)
      return null
    }
  }, [createConversationMutation])

  const continueConversation = useCallback((conversationId: string) => {
    setCurrentConversationId(conversationId)
    setShowContinueButton(false)
    setIsWaitingForResponse(false)
  }, [])

  const addMessage = useCallback(async (
    content: string,
    role: "user" | "assistant" | "tool",
    toolCalls?: Array<{ name: string; arguments: any }>,
    toolResults?: Array<{ success: boolean; content: string; error?: string }>
  ) => {
    if (!currentConversationId) {
      console.error("Cannot add message: no active conversation")
      return
    }

    try {
      await addMessageMutation.mutateAsync({
        conversationId: currentConversationId,
        content,
        role,
        toolCalls,
        toolResults
      })

      // Show continue button after assistant response
      if (role === "assistant") {
        setShowContinueButton(true)
        setIsWaitingForResponse(false)
      }
    } catch (error) {
      console.error("Failed to add message to conversation:", error)
      setIsWaitingForResponse(false)
    }
  }, [currentConversationId, addMessageMutation])

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
    setIsWaitingForResponse
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
    throw new Error("useConversation must be used within a ConversationProvider")
  }
  return context
}

// Hook for managing conversation state in components
export function useConversationState() {
  const {
    currentConversation,
    isConversationActive,
    showContinueButton,
    isWaitingForResponse
  } = useConversation()

  return {
    currentConversation,
    isConversationActive,
    showContinueButton,
    isWaitingForResponse,
    hasMessages: currentConversation?.messages.length ?? 0 > 0,
    lastMessage: currentConversation?.messages[currentConversation.messages.length - 1] || null
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
    setIsWaitingForResponse
  } = useConversation()

  return {
    startNewConversation,
    continueConversation,
    addMessage,
    endConversation,
    setShowContinueButton,
    setIsWaitingForResponse
  }
}
