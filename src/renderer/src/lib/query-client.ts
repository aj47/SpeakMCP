import { focusManager, QueryClient, useMutation, useQuery } from "@tanstack/react-query"
import { tipcClient } from "./tipc-client"

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
      networkMode: "always",
    },
  },
})

export const useMicrphoneStatusQuery = () =>
  useQuery({
    queryKey: ["microphone-status"],
    queryFn: async () => {
      return tipcClient.getMicrophoneStatus()
    },
  })

export const useConfigQuery = () => useQuery({
  queryKey: ["config"],
  queryFn: async () => {
    return tipcClient.getConfig()
  },
})

export const useAuthStateQuery = () => useQuery({
  queryKey: ["auth-state"],
  queryFn: async () => {
    return tipcClient.getAuthState()
  },
})



export const useSaveConfigMutation = () => useMutation({
  mutationFn: tipcClient.saveConfig,
  onSuccess() {
    queryClient.invalidateQueries({
      queryKey: ["config"],
    })
  },
})

export const useInitiateLoginMutation = () => useMutation({
  mutationFn: tipcClient.initiateLogin,
  onSuccess() {
    queryClient.invalidateQueries({
      queryKey: ["auth-state"],
    })
    queryClient.invalidateQueries({
      queryKey: ["config"],
    })
  },
  onError() {
    // The mutation state will automatically reset to not pending
    // This ensures the UI can show the retry button
  },
})

export const useLogoutMutation = () => useMutation({
  mutationFn: tipcClient.logout,
  onSuccess() {
    queryClient.invalidateQueries({
      queryKey: ["auth-state"],
    })
    queryClient.invalidateQueries({
      queryKey: ["config"],
    })
  },
})

export const useCancelLoginMutation = () => useMutation({
  mutationFn: tipcClient.cancelLogin,
})
