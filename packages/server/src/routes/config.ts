import { FastifyPluginAsync } from 'fastify'
import { configService, AppConfigSchema } from '../services/config-service.js'
import { z } from 'zod'

export const configRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/config - Get all configuration
  server.get('/config', async () => {
    return configService.get()
  })

  // PATCH /api/config - Update configuration
  server.patch('/config', async (request) => {
    const patch = AppConfigSchema.partial().parse(request.body)
    return configService.update(patch)
  })

  // PUT /api/config - Replace configuration
  server.put('/config', async (request) => {
    const newConfig = AppConfigSchema.partial().parse(request.body)
    return configService.update(newConfig)
  })

  // GET /api/config/:key - Get single config key
  server.get<{ Params: { key: string } }>('/config/:key', async (request, reply) => {
    const key = request.params.key as keyof ReturnType<typeof configService.get>
    const config = configService.get()
    
    if (!(key in config)) {
      return reply.status(404).send({ error: `Config key '${key}' not found` })
    }
    
    return { [key]: config[key] }
  })

  // PUT /api/config/:key - Set single config key
  server.put<{ Params: { key: string } }>('/config/:key', async (request, reply) => {
    const key = request.params.key
    const body = z.object({ value: z.any() }).parse(request.body)
    
    // Validate the key exists in schema
    const schema = AppConfigSchema.shape
    if (!(key in schema)) {
      return reply.status(400).send({ error: `Invalid config key '${key}'` })
    }
    
    configService.update({ [key]: body.value } as any)
    return { success: true, [key]: body.value }
  })

  // DELETE /api/config/:key - Delete config key (reset to default)
  server.delete<{ Params: { key: string } }>('/config/:key', async (request, reply) => {
    const key = request.params.key
    
    // Validate the key exists in schema
    const schema = AppConfigSchema.shape
    if (!(key in schema)) {
      return reply.status(400).send({ error: `Invalid config key '${key}'` })
    }
    
    configService.deleteKey(key as keyof ReturnType<typeof configService.get>)
    return { success: true }
  })
}

