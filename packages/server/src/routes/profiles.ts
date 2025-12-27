import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { profileService } from '../services/profile-service.js'
import { mcpService } from '../services/mcp-service.js'
import { NotFoundError, ValidationError } from '../middleware/error-handler.js'

const CreateProfileSchema = z.object({
  name: z.string().min(1).max(100),
  guidelines: z.string().default(''),
  systemPrompt: z.string().optional(),
})

const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  guidelines: z.string().optional(),
  systemPrompt: z.string().optional(),
})

const McpServerConfigSchema = z.object({
  disabledServers: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
  allServersDisabledByDefault: z.boolean().optional(),
  enabledServers: z.array(z.string()).optional(),
})

const ModelConfigSchema = z.object({
  mcpToolsProviderId: z.enum(['openai', 'groq', 'gemini']).optional(),
  mcpToolsOpenaiModel: z.string().optional(),
  mcpToolsGroqModel: z.string().optional(),
  mcpToolsGeminiModel: z.string().optional(),
  currentModelPresetId: z.string().optional(),
  sttProviderId: z.enum(['openai', 'groq']).optional(),
  transcriptPostProcessingProviderId: z.enum(['openai', 'groq', 'gemini']).optional(),
  ttsProviderId: z.enum(['openai', 'groq', 'gemini']).optional(),
})

export const profileRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/profiles - List all profiles
  fastify.get('/', async () => {
    const profiles = profileService.getProfiles()
    const currentProfile = profileService.getCurrentProfile()
    
    return {
      profiles: profiles.map(p => ({
        id: p.id,
        name: p.name,
        isDefault: p.isDefault,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      currentProfileId: currentProfile?.id,
    }
  })

  // GET /api/profiles/current - Get current profile details
  fastify.get('/current', async () => {
    const profile = profileService.getCurrentProfile()
    if (!profile) {
      throw new NotFoundError('No current profile set')
    }
    return { profile }
  })

  // GET /api/profiles/:id - Get profile by ID
  fastify.get<{ Params: { id: string } }>('/:id', async (request) => {
    const profile = profileService.getProfile(request.params.id)
    if (!profile) {
      throw new NotFoundError(`Profile ${request.params.id} not found`)
    }
    return { profile }
  })

  // POST /api/profiles - Create new profile
  fastify.post('/', async (request) => {
    const parseResult = CreateProfileSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid profile data', parseResult.error.errors)
    }

    const { name, guidelines, systemPrompt } = parseResult.data
    const profile = profileService.createProfile(name, guidelines, systemPrompt)
    
    return { profile }
  })

  // PATCH /api/profiles/:id - Update profile
  fastify.patch<{ Params: { id: string } }>('/:id', async (request) => {
    const parseResult = UpdateProfileSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid profile data', parseResult.error.errors)
    }

    try {
      const profile = profileService.updateProfile(request.params.id, parseResult.data)
      return { profile }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(error.message)
      }
      throw error
    }
  })

  // DELETE /api/profiles/:id - Delete profile
  fastify.delete<{ Params: { id: string } }>('/:id', async (request) => {
    try {
      const deleted = profileService.deleteProfile(request.params.id)
      if (!deleted) {
        throw new NotFoundError(`Profile ${request.params.id} not found`)
      }
      return { success: true }
    } catch (error) {
      if (error instanceof Error && error.message.includes('default')) {
        throw new ValidationError(error.message)
      }
      throw error
    }
  })

  // POST /api/profiles/:id/activate - Set current profile
  fastify.post<{ Params: { id: string } }>('/:id/activate', async (request) => {
    try {
      const profile = profileService.setCurrentProfile(request.params.id)
      
      // Apply the profile's MCP configuration
      mcpService.applyProfileMcpConfig(
        profile.mcpServerConfig?.disabledServers,
        profile.mcpServerConfig?.disabledTools,
        profile.mcpServerConfig?.allServersDisabledByDefault,
        profile.mcpServerConfig?.enabledServers
      )

      return { success: true, profile }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(error.message)
      }
      throw error
    }
  })

  // GET /api/profiles/:id/export - Export profile
  fastify.get<{ Params: { id: string } }>('/:id/export', async (request, reply) => {
    try {
      const exportData = profileService.exportProfile(request.params.id)
      reply.header('Content-Type', 'application/json')
      reply.header('Content-Disposition', `attachment; filename="profile-${request.params.id}.json"`)
      return exportData
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(error.message)
      }
      throw error
    }
  })

  // POST /api/profiles/import - Import profile
  fastify.post('/import', async (request) => {
    const body = request.body as { profileJson?: string }
    
    if (!body.profileJson || typeof body.profileJson !== 'string') {
      throw new ValidationError('Missing or invalid profileJson')
    }

    try {
      const profile = profileService.importProfile(body.profileJson)
      return { profile }
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Failed to import profile')
    }
  })

  // PUT /api/profiles/:id/mcp-config - Update MCP configuration
  fastify.put<{ Params: { id: string } }>('/:id/mcp-config', async (request) => {
    const parseResult = McpServerConfigSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid MCP config', parseResult.error.errors)
    }

    try {
      const profile = profileService.updateProfileMcpConfig(request.params.id, parseResult.data)
      return { profile }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(error.message)
      }
      throw error
    }
  })

  // PUT /api/profiles/:id/model-config - Update model configuration
  fastify.put<{ Params: { id: string } }>('/:id/model-config', async (request) => {
    const parseResult = ModelConfigSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid model config', parseResult.error.errors)
    }

    try {
      const profile = profileService.updateProfileModelConfig(request.params.id, parseResult.data)
      return { profile }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(error.message)
      }
      throw error
    }
  })
}
