import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { configService } from '../services/config-service.js'
import { ValidationError } from '../middleware/error-handler.js'

const ConfigPatchSchema = z.object({
  // API Keys (allow setting, but will be redacted in responses)
  openaiApiKey: z.string().optional(),
  openaiBaseUrl: z.string().url().optional().or(z.literal('')),
  groqApiKey: z.string().optional(),
  groqBaseUrl: z.string().url().optional().or(z.literal('')),
  geminiApiKey: z.string().optional(),
  geminiBaseUrl: z.string().url().optional().or(z.literal('')),
  
  // STT Settings
  sttProviderId: z.enum(['openai', 'groq']).optional(),
  sttLanguage: z.string().optional(),
  
  // TTS Settings
  ttsEnabled: z.boolean().optional(),
  ttsProviderId: z.enum(['openai', 'groq', 'gemini']).optional(),
  
  // Agent Settings
  mcpToolsProviderId: z.enum(['openai', 'groq', 'gemini']).optional(),
  mcpToolsOpenaiModel: z.string().optional(),
  mcpToolsGroqModel: z.string().optional(),
  mcpToolsGeminiModel: z.string().optional(),
  mcpToolsSystemPrompt: z.string().optional(),
  mcpCustomSystemPrompt: z.string().optional(),
  
  // MCP Settings
  mcpMaxIterations: z.number().int().min(1).max(100).optional(),
  mcpRequireApprovalBeforeToolCall: z.boolean().optional(),
  mcpMessageQueueEnabled: z.boolean().optional(),
  mcpRuntimeDisabledServers: z.array(z.string()).optional(),
  mcpDisabledTools: z.array(z.string()).optional(),
  
  // Current profile
  currentProfileId: z.string().optional(),
  currentModelPresetId: z.string().optional(),
}).strict()

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/config
  fastify.get('/', async () => {
    const config = await configService.getRedacted()
    return { config }
  })

  // PATCH /api/config
  fastify.patch('/', async (request) => {
    const parseResult = ConfigPatchSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid configuration', parseResult.error.errors)
    }

    const updated = await configService.update(parseResult.data)
    const redacted = await configService.getRedacted()
    
    return {
      success: true,
      config: redacted,
    }
  })
}
