import { FastifyPluginAsync } from 'fastify'
import { modelsService } from '../services/models-service.js'
import { z } from 'zod'

export const modelsRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/models/:providerId - Fetch available models for a provider
  server.get<{ Params: { providerId: string } }>('/models/:providerId', async (request, reply) => {
    const providerId = request.params.providerId
    
    if (!['openai', 'groq', 'gemini'].includes(providerId)) {
      return reply.status(400).send({ error: 'Invalid provider ID' })
    }

    try {
      const models = await modelsService.fetchModels(providerId)
      return models
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to fetch models',
      })
    }
  })

  // GET /api/models/:providerId/default - Get default models (no API call)
  server.get<{ Params: { providerId: string } }>('/models/:providerId/default', async (request) => {
    const providerId = request.params.providerId
    return modelsService.getDefaultModels(providerId)
  })

  // POST /api/models/preset - Fetch models for a custom preset
  server.post('/models/preset', async (request, reply) => {
    const body = z.object({
      presetId: z.string().min(1),
    }).parse(request.body)

    try {
      const models = await modelsService.fetchModelsForPreset(body.presetId)
      return models
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to fetch models for preset',
      })
    }
  })

  // GET /api/models - Get models for all providers
  server.get('/models', async () => {
    const [openai, groq, gemini] = await Promise.all([
      modelsService.fetchModels('openai').catch(() => modelsService.getDefaultModels('openai')),
      modelsService.fetchModels('groq').catch(() => modelsService.getDefaultModels('groq')),
      modelsService.fetchModels('gemini').catch(() => modelsService.getDefaultModels('gemini')),
    ])

    return {
      openai,
      groq,
      gemini,
    }
  })
}

