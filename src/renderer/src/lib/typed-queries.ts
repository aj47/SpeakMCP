// Type-safe React Query hooks with proper return types

import { useQuery, useMutation } from "@tanstack/react-query"
import { tipcClient } from "./tipc-client"

// Type-safe query result handler
const handleQueryResult = <T>(result: any): T => {
  if (result && typeof result === 'object') {
    return result as T
  }
  return {} as T
}

// Type-safe array handler
const handleArrayResult = <T>(result: any): T[] => {
  if (Array.isArray(result)) {
    return result as T[]
  }
  return []
}

// Type-safe query hooks
export const useMicrophoneStatusQuery = () => {
  return useQuery({
    queryKey: ["microphone-status"],
    queryFn: async () => {
      const result = await tipcClient.getMicrophoneStatus()
      return handleQueryResult(result)
    },
  })
}

export const useConfigQuery = () => {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const result = await tipcClient.getConfig()
      return handleQueryResult(result)
    },
  })
}

export const useConversationHistoryQuery = () => {
  return useQuery({
    queryKey: ["conversation-history"],
    queryFn: async () => {
      const result = await tipcClient.getConversationHistory()
      return handleArrayResult(result)
    },
  })
}

export const useConversationQuery = (conversationId: string | null) => {
  return useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: async () => {
      if (!conversationId) return null
      const result = await tipcClient.loadConversation({ conversationId })
      return handleQueryResult(result)
    },
    enabled: !!conversationId,
  })
}

export const useSaveConversationMutation = () => {
  return useMutation({
    mutationFn: async ({ conversation }: { conversation: any }) => {
      await tipcClient.saveConversation({ conversation })
    },
  })
}

export const useUpdateConfigMutation = () => {
  return useMutation({
    mutationFn: async ({ config }: { config: any }) => {
      await tipcClient.updateConfig({ config })
    },
  })
}

export const useMcpServerStatus = () => {
  return useQuery({
    queryKey: ["mcp-server-status"],
    queryFn: async () => {
      const result = await tipcClient.getMcpServerStatus()
      return handleQueryResult(result)
    },
  })
}

export const useMcpInitializationStatus = () => {
  return useQuery({
    queryKey: ["mcp-initialization-status"],
    queryFn: async () => {
      const result = await tipcClient.getMcpInitializationStatus()
      return handleQueryResult(result)
    },
  })
}
