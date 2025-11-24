import { useMutation } from "@tanstack/react-query"
import { tipcClient } from "~/lib/tipc-client"
import { useConversationStore } from "@renderer/stores"
import {
  useConversationQuery,
  useCreateConversationMutation,
  useAddMessageToConversationMutation,
} from "@renderer/lib/queries"

interface UseInputProcessingOptions {
  onError?: (error: Error) => void
  onSuccess?: () => void
}

/**
 * Shared hook for handling both text and voice input processing.
 * Consolidates the common mutation logic and state management.
 */
export function useInputProcessing(options: UseInputProcessingOptions = {}) {
  const currentConversationId = useConversationStore((s) => s.currentConversationId)
  const setCurrentConversationId = useConversationStore((s) => s.setCurrentConversationId)
  const conversationQuery = useConversationQuery(currentConversationId)
  const createConversationMutation = useCreateConversationMutation()
  const addMessageMutation = useAddMessageToConversationMutation()

  const currentConversation = conversationQuery.data
  const isConversationActive = !!currentConversationId

  // Regular text input mutation (fallback)
  const textInputMutation = useMutation({
    mutationFn: async ({ text }: { text: string }) => {
      await tipcClient.createTextInput({ text })
    },
    onError: options.onError,
    onSuccess: options.onSuccess,
  })

  // MCP text input mutation (primary)
  const mcpTextInputMutation = useMutation({
    mutationFn: async ({
      text,
      conversationId,
    }: {
      text: string
      conversationId?: string
    }) => {
      await tipcClient.createMcpTextInput({ text, conversationId })
    },
    onError: options.onError,
    onSuccess: options.onSuccess,
  })

  // MCP voice input mutation
  const mcpTranscribeMutation = useMutation({
    mutationFn: async ({
      blob,
      duration,
      transcript,
    }: {
      blob: Blob
      duration: number
      transcript?: string
    }) => {
      const arrayBuffer = await blob.arrayBuffer()

      // Track the conversation ID to use (may be new or existing)
      let conversationIdToUse = currentConversationId

      // If we have a transcript, start a conversation with it
      if (transcript && !isConversationActive) {
        const newConversation = await createConversationMutation.mutateAsync({
          firstMessage: transcript,
          role: "user",
        })
        conversationIdToUse = newConversation.id
        setCurrentConversationId(newConversation.id)
      }

      const result = await tipcClient.createMcpRecording({
        recording: arrayBuffer,
        duration,
        conversationId: conversationIdToUse || undefined,
      })

      return result
    },
    onError: options.onError,
    onSuccess: options.onSuccess,
  })

  // Unified text processing function
  const processText = async (text: string) => {
    let conversationId = currentConversationId

    // Start new conversation or add to existing one
    if (!isConversationActive) {
      const newConversation = await createConversationMutation.mutateAsync({
        firstMessage: text,
        role: "user",
      })
      conversationId = newConversation.id
      setCurrentConversationId(newConversation.id)
    } else if (conversationId) {
      await addMessageMutation.mutateAsync({
        conversationId,
        content: text,
        role: "user",
      })
    }

    // Always try to use MCP processing first if available
    try {
      const config = await tipcClient.getConfig()
      if (config.mcpToolsEnabled) {
        mcpTextInputMutation.mutate({
          text,
          conversationId,
        })
      } else {
        textInputMutation.mutate({ text })
      }
    } catch (error) {
      textInputMutation.mutate({ text })
    }
  }

  // Unified voice processing function
  const processVoice = (blob: Blob, duration: number, transcript?: string) => {
    mcpTranscribeMutation.mutate({
      blob,
      duration,
      transcript,
    })
  }

  const isProcessing =
    textInputMutation.isPending ||
    mcpTextInputMutation.isPending ||
    mcpTranscribeMutation.isPending

  return {
    processText,
    processVoice,
    isProcessing,
    mutations: {
      textInput: textInputMutation,
      mcpTextInput: mcpTextInputMutation,
      mcpTranscribe: mcpTranscribeMutation,
    },
  }
}
