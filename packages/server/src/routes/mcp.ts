import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { mcpService } from '../services/mcp-service.js'
import { NotFoundError, ValidationError } from '../middleware/error-handler.js'

const ToggleServerSchema = z.object({
  enabled: z.boolean(),
})

const ToggleToolSchema = z.object({
  enabled: z.boolean(),
})

const ExecuteToolSchema = z.object({
  arguments: z.record(z.unknown()),
})

export const mcpRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/mcp/servers - List MCP servers with status
  fastify.get('/servers', async () => {
    const serverStatus = mcpService.getServerStatus()
    const servers = Object.entries(serverStatus)
      .filter(([name]) => name !== 'speakmcp-settings') // Filter out built-in
      .map(([name, status]) => ({
        name,
        connected: status.connected,
        toolCount: status.toolCount,
        enabled: status.enabled,
        runtimeEnabled: status.runtimeEnabled,
        configDisabled: status.configDisabled,
        error: status.error,
      }))

    return { servers }
  })

  // GET /api/mcp/initialization-status - Get initialization progress
  fastify.get('/initialization-status', async () => {
    // TODO: Track initialization progress
    return {
      isInitializing: false,
      progress: { current: 0, total: 0 },
    }
  })

  // PATCH /api/mcp/servers/:name - Enable/disable server
  fastify.patch<{ Params: { name: string } }>('/servers/:name', async (request) => {
    const parseResult = ToggleServerSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid request', parseResult.error.errors)
    }

    const success = await mcpService.setServerRuntimeEnabled(
      request.params.name,
      parseResult.data.enabled
    )

    if (!success) {
      throw new NotFoundError(`Server '${request.params.name}' not found`)
    }

    return {
      success: true,
      server: request.params.name,
      enabled: parseResult.data.enabled,
    }
  })

  // POST /api/mcp/servers/:name/restart - Restart server
  fastify.post<{ Params: { name: string } }>('/servers/:name/restart', async (request) => {
    try {
      await mcpService.restartServer(request.params.name)
      return { success: true }
    } catch (error) {
      throw new NotFoundError(`Server '${request.params.name}' not found`)
    }
  })

  // POST /api/mcp/servers/:name/stop - Stop server
  fastify.post<{ Params: { name: string } }>('/servers/:name/stop', async (request) => {
    const success = await mcpService.setServerRuntimeEnabled(request.params.name, false)
    if (!success) {
      throw new NotFoundError(`Server '${request.params.name}' not found`)
    }
    return { success: true }
  })

  // POST /api/mcp/servers/:name/test - Test server connection
  fastify.post<{ Params: { name: string } }>('/servers/:name/test', async (request) => {
    try {
      await mcpService.restartServer(request.params.name)
      return { success: true, connected: true }
    } catch (error) {
      return {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  })

  // GET /api/mcp/servers/:name/logs - Get server logs
  fastify.get<{ Params: { name: string } }>('/servers/:name/logs', async (request) => {
    const logs = mcpService.getServerLogs(request.params.name)
    return { logs }
  })

  // DELETE /api/mcp/servers/:name/logs - Clear server logs
  fastify.delete<{ Params: { name: string } }>('/servers/:name/logs', async (request) => {
    mcpService.clearServerLogs(request.params.name)
    return { success: true }
  })

  // GET /api/mcp/tools - List all tools with status
  fastify.get('/tools', async () => {
    const tools = mcpService.getAvailableTools()
    return {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        serverName: t.serverName,
        inputSchema: t.inputSchema,
      })),
    }
  })

  // PATCH /api/mcp/tools/:name - Enable/disable tool
  fastify.patch<{ Params: { name: string } }>('/tools/:name', async (request) => {
    const parseResult = ToggleToolSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid request', parseResult.error.errors)
    }

    await mcpService.setToolEnabled(request.params.name, parseResult.data.enabled)
    
    return {
      success: true,
      tool: request.params.name,
      enabled: parseResult.data.enabled,
    }
  })

  // POST /api/mcp/tools/:name/execute - Execute tool (internal use)
  fastify.post<{ Params: { name: string } }>('/tools/:name/execute', async (request) => {
    const parseResult = ExecuteToolSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw new ValidationError('Invalid request', parseResult.error.errors)
    }

    const result = await mcpService.executeToolCall({
      name: request.params.name,
      arguments: parseResult.data.arguments,
    })

    return { result }
  })

  // OAuth endpoints (stubs for now)
  
  // POST /api/mcp/oauth/:serverName/initiate - Start OAuth flow
  fastify.post<{ Params: { serverName: string } }>('/oauth/:serverName/initiate', async (request) => {
    // TODO: Implement OAuth flow
    return {
      success: false,
      error: 'OAuth not yet implemented',
    }
  })

  // POST /api/mcp/oauth/:serverName/complete - Complete OAuth
  fastify.post<{ Params: { serverName: string } }>('/oauth/:serverName/complete', async (request) => {
    return {
      success: false,
      error: 'OAuth not yet implemented',
    }
  })

  // GET /api/mcp/oauth/:serverName/status - Get OAuth status
  fastify.get<{ Params: { serverName: string } }>('/oauth/:serverName/status', async (request) => {
    return {
      authenticated: false,
      required: false,
    }
  })

  // POST /api/mcp/oauth/:serverName/revoke - Revoke OAuth tokens
  fastify.post<{ Params: { serverName: string } }>('/oauth/:serverName/revoke', async (request) => {
    return { success: true }
  })
}
