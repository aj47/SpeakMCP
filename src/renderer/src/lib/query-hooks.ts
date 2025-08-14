import { useQuery, useMutation } from "@tanstack/react-query"
import { tipcClient } from "./tipc-client"

// Type-safe query hooks
export const useConfigQuery = () => {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const result = await tipcClient.getConfig()
      return result
    },
  })
}

export const useConversationHistoryQuery = () => {
  return useQuery({
    queryKey: ["conversation-history"],
    queryFn: async () => {
      const result = await tipcClient.getConversationHistory()
      return result
    },
  })
}

export const useConversationQuery = (conversationId: string | null) => {
  return useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: async () => {
      if (!conversationId) return null
      const result = await tipcClient.loadConversation({ conversationId })
      return result
    },
    enabled: !!conversationId,
  })
}

export const useSaveConversationMutation = () => {
  return useMutation({
    mutationFn: async (conversation: any) => {
      await tipcClient.saveConversation({ conversation })
    },
  })
}

export const useUpdateConfigMutation = () => {
  return useMutation({
    mutationFn: async (config: any) => {
      await tipcClient.updateConfig({ config })
    },
  })
}
