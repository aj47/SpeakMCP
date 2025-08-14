// Type-safe query result handling for React Query

import { useQuery, useMutation } from "@tanstack/react-query"
import { tipcClient } from "./tipc-client"

// Type-safe query hooks with proper return types
export const useMicrophoneStatusQuery = () => {
  return useQuery({
    queryKey: ["microphone-status"],
    queryFn: async () => {
      const result = await tipcClient.getMicrophoneStatus()
      return result || {}
    },
  })
}

export const useConfigQuery = () => {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const result = await tipcClient.getConfig()
      return result || {}
    },
  })
}

export const useConversationHistoryQuery = () => {
  return useQuery({
    queryKey: ["conversation-history"],
    queryFn: async () => {
      const result = await tipcClient.getConversationHistory()
      return Array.isArray(result) ? result : []
    },
  })
}

export const useConversationQuery = (conversationId: string | null) => {
  return useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: async () => {
      if (!conversationId) return null
      const result = await tipcClient.loadConversation({ conversationId })
      return result || null
    },
    enabled: !!conversationId,
  })
}

export const useSaveConversationMutation = () => {
  return useMutation({
    mutationFn: async ({ conversation }: { conversation: any }) => {
      await tipcClient.saveConversation({ conversation })
    },
    onSuccess: () => {
      // Invalidate relevant queries
    },
  })
}

export const useCreateConversationMutation = () => {
  return useMutation({
    mutationFn: async ({
      firstMessage,
      role,
    }: {
      firstMessage: string
      role?: "user" | "assistant"
    }) => {
      const result = await tipcClient.createConversation({ firstMessage, role })
      return result || {}
    },
  })
}

export const useDeleteConversationMutation = () => {
  return useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string }) => {
      await tipcClient.deleteConversation({ conversationId })
    },
  })
}

export const useMcpServerStatus = () => {
  return useQuery({
    queryKey: ["mcp-server-status"],
    queryFn: async () => {
      const result = await tipcClient.getMcpServerStatus()
      return result || {}
    },
  })
}

export const useMcpInitializationStatus = () => {
  return useQuery({
    queryKey: ["mcp-initialization-status"],
    queryFn: async () => {
      const result = await tipcClient.getMcpInitializationStatus()
      return result || {}
    },
  })
}
