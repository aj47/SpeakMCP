import { FastifyPluginAsync } from 'fastify'
import { profileService, ProfileMcpConfigSchema, ProfileModelConfigSchema } from '../services/profile-service.js'
import { z } from 'zod'

const CreateProfileBody = z.object({
  name: z.string().min(1),
  guidelines: z.string().default(''),
  systemPrompt: z.string().optional(),
  mcpServerConfig: ProfileMcpConfigSchema.optional(),
  modelConfig: ProfileModelConfigSchema.optional(),
})

const UpdateProfileBody = z.object({
  name: z.string().min(1).optional(),
  guidelines: z.string().optional(),
  systemPrompt: z.string().optional().nullable(),
  mcpServerConfig: ProfileMcpConfigSchema.optional().nullable(),
  modelConfig: ProfileModelConfigSchema.optional().nullable(),
})

const ImportProfileBody = z.object({
  name: z.string().min(1),
  guidelines: z.string().optional(),
  systemPrompt: z.string().optional(),
  mcpServerConfig: ProfileMcpConfigSchema.optional(),
  modelConfig: ProfileModelConfigSchema.optional(),
})

export const profileRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/profiles - List all profiles
  server.get('/profiles', async () => {
    return profileService.list()
  })

  // GET /api/profiles/current - Get current active profile
  server.get('/profiles/current', async (request, reply) => {
    const profile = profileService.getCurrent()
    if (!profile) {
      return reply.status(404).send({ error: 'No current profile set' })
    }
    return profile
  })

  // POST /api/profiles - Create new profile
  server.post('/profiles', async (request, reply) => {
    const body = CreateProfileBody.parse(request.body)
    const profile = profileService.create(
      body.name,
      body.guidelines,
      body.systemPrompt,
      body.mcpServerConfig,
      body.modelConfig
    )
    return reply.status(201).send(profile)
  })

  // GET /api/profiles/:id - Get single profile
  server.get<{ Params: { id: string } }>('/profiles/:id', async (request, reply) => {
    const profile = profileService.get(request.params.id)
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })

  // PATCH /api/profiles/:id - Update profile
  server.patch<{ Params: { id: string } }>('/profiles/:id', async (request, reply) => {
    const body = UpdateProfileBody.parse(request.body)
    
    // Convert null to undefined for optional fields
    const updates: any = {}
    if (body.name !== undefined) updates.name = body.name
    if (body.guidelines !== undefined) updates.guidelines = body.guidelines
    if (body.systemPrompt !== undefined) updates.systemPrompt = body.systemPrompt ?? undefined
    if (body.mcpServerConfig !== undefined) updates.mcpServerConfig = body.mcpServerConfig ?? undefined
    if (body.modelConfig !== undefined) updates.modelConfig = body.modelConfig ?? undefined

    const profile = profileService.update(request.params.id, updates)
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })

  // PUT /api/profiles/:id - Replace profile
  server.put<{ Params: { id: string } }>('/profiles/:id', async (request, reply) => {
    const body = CreateProfileBody.parse(request.body)
    const profile = profileService.update(request.params.id, {
      name: body.name,
      guidelines: body.guidelines,
      systemPrompt: body.systemPrompt,
      mcpServerConfig: body.mcpServerConfig,
      modelConfig: body.modelConfig,
    })
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })

  // DELETE /api/profiles/:id - Delete profile
  server.delete<{ Params: { id: string } }>('/profiles/:id', async (request, reply) => {
    const deleted = profileService.delete(request.params.id)
    if (!deleted) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return { success: true }
  })

  // POST /api/profiles/:id/activate - Set as current profile
  server.post<{ Params: { id: string } }>('/profiles/:id/activate', async (request, reply) => {
    const profile = profileService.setCurrentProfile(request.params.id)
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })

  // POST /api/profiles/deactivate - Clear current profile
  server.post('/profiles/deactivate', async () => {
    profileService.clearCurrentProfile()
    return { success: true }
  })

  // GET /api/profiles/:id/export - Export profile
  server.get<{ Params: { id: string } }>('/profiles/:id/export', async (request, reply) => {
    const exported = profileService.export(request.params.id)
    if (!exported) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return exported
  })

  // POST /api/profiles/import - Import profile
  server.post('/profiles/import', async (request, reply) => {
    const body = ImportProfileBody.parse(request.body)
    const profile = profileService.import(body)
    return reply.status(201).send(profile)
  })

  // PATCH /api/profiles/:id/mcp-config - Update only MCP config
  server.patch<{ Params: { id: string } }>('/profiles/:id/mcp-config', async (request, reply) => {
    const body = ProfileMcpConfigSchema.parse(request.body)
    const profile = profileService.update(request.params.id, { mcpServerConfig: body })
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })

  // PATCH /api/profiles/:id/model-config - Update only model config
  server.patch<{ Params: { id: string } }>('/profiles/:id/model-config', async (request, reply) => {
    const body = ProfileModelConfigSchema.parse(request.body)
    const profile = profileService.update(request.params.id, { modelConfig: body })
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })
}

