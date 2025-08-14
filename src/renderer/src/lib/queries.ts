import {
  focusManager,
  QueryClient,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { tipcClient } from "./tipc-client"

// Create a properly typed query client
focusManager.setEventListener((handleFocus) => {
  const handler = () => handleFocus()
  window.addEventListener("focus", handler)
  return () => {
    window.removeEventListener("focus", handler)
  }
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

// Type-safe query hooks
export const useMicrophoneStatusQuery = () => {
  return useQuery({
    queryKey: ["microphone-status"],
    queryFn: async () => {
      return await tipcClient.getMicrophoneStatus()
    },
  })
}

export const useConfigQuery = () => {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      return await tipcClient.getConfig()
    },
  })
}

export const useConversationHistoryQuery = () => {
  return useQuery({
    queryKey: ["conversation-history"],
    queryFn: async () => {
      return await tipcClient.getConversationHistory()
    },
  })
}

export const useConversationQuery = (conversationId: string | null) => {
  return useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: async () => {
      if (!conversationId) return null
      return await tipcClient.loadConversation({ conversationId })
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
      queryClient.invalidateQueries({ queryKey: ["conversation-history"] })
    },
  })
}

export const useUpdateConfigMutation = () => {
  return useMutation({
    mutationFn: async ({ config }: { config: any }) => {
      await tipcClient.updateConfig({ config })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] })
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
      return await tipcClient.createConversation({
        firstMessage,
        role,
      })
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

export const useLoadMcpConfigFile = () => {
  return useMutation({
    mutationFn: async () => {
      return await tipcClient.loadMcpConfigFile()
    },
  })
}

export const useSaveMcpConfigFile = () => {
  return useMutation({
    mutationFn: async ({ config }: { config: any }) => {
      await tipcClient.saveMcpConfigFile({ config })
    },
  })
}

export const useMcpServerStatus = () => {
  return useQuery({
    queryKey: ["mcp-server-status"],
    queryFn: async () => {
      return await tipcClient.getMcpServerStatus()
    },
  })
}

export const useMcpInitializationStatus = () => {
  return useQuery({
    queryKey: ["mcp-initialization-status"],
    queryFn: async () => {
      return await tipcClient.getMcpInitializationStatus()
    },
  })
}
