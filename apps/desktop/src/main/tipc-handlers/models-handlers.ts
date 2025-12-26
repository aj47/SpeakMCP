import { tipc } from "@egoist/tipc/main"

const t = tipc.create()

export const modelsHandlers = {
  // Models Management
  fetchAvailableModels: t.procedure
    .input<{ providerId: string }>()
    .action(async ({ input }) => {
      const { fetchAvailableModels } = await import("../models-service")
      return fetchAvailableModels(input.providerId)
    }),

  // Fetch models for a specific preset (base URL + API key)
  fetchModelsForPreset: t.procedure
    .input<{ baseUrl: string; apiKey: string }>()
    .action(async ({ input }) => {
      const { fetchModelsForPreset } = await import("../models-service")
      return fetchModelsForPreset(input.baseUrl, input.apiKey)
    }),
}
