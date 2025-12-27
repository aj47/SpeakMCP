import { FastifyPluginAsync } from 'fastify'
import { mcpService, McpServerConfigSchema } from '../services/mcp-service.js'
import { z } from 'zod'

const ServerConfigBody = McpServerConfigSchema

const ToggleBody = z.object({
  enabled: z.boolean(),
})

const ExecuteToolBody = z.object({
  arguments: z.record(z.any()).default({}),
})

export const mcpRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/mcp/servers - List all MCP servers with status
  server.get('/mcp/servers', async () => {
    return mcpService.getStatus()
  })

  // POST /api/mcp/servers/:name - Start/register server
  server.post<{ Params: { name: string } }>('/mcp/servers/:name', async (request, reply) => {
    const config = ServerConfigBody.parse(request.body)
    try {
      await mcpService.startServer(request.params.name, config)
      return { success: true, status: 'running' }
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to start server',
      })
    }
  })

  // GET /api/mcp/servers/:name - Get server details
  server.get<{ Params: { name: string } }>('/mcp/servers/:name', async (request, reply) => {
    const serverStatus = mcpService.getStatus().find(s => s.name === request.params.name)
    if (!serverStatus) {
      return reply.status(404).send({ error: 'Server not found' })
    }
    
    const server = mcpService.getServer(request.params.name)
    return {
      ...serverStatus,
      config: server?.config,
      tools: server?.tools ?? [],
    }
  })

  // POST /api/mcp/servers/:name/restart - Restart server
  server.post<{ Params: { name: string } }>('/mcp/servers/:name/restart', async (request, reply) => {
    try {
      await mcpService.restartServer(request.params.name)
      return { success: true }
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to restart server',
      })
    }
  })

  // POST /api/mcp/servers/:name/stop - Stop server
  server.post<{ Params: { name: string } }>('/mcp/servers/:name/stop', async (request) => {
    await mcpService.stopServer(request.params.name)
    return { success: true }
  })

  // PATCH /api/mcp/servers/:name - Toggle server enabled/disabled
  server.patch<{ Params: { name: string } }>('/mcp/servers/:name', async (request, reply) => {
    const body = ToggleBody.parse(request.body)
    mcpService.setServerEnabled(request.params.name, body.enabled)
    return { success: true, enabled: body.enabled }
  })

  // POST /api/mcp/servers/:name/toggle - Toggle server (alternative endpoint)
  server.post<{ Params: { name: string } }>('/mcp/servers/:name/toggle', async (request) => {
    const body = ToggleBody.parse(request.body)
    mcpService.setServerEnabled(request.params.name, body.enabled)
    return { success: true, enabled: body.enabled }
  })

  // GET /api/mcp/servers/:name/logs - Get server logs
  server.get<{ Params: { name: string } }>('/mcp/servers/:name/logs', async (request) => {
    return { logs: mcpService.getLogs(request.params.name) }
  })

  // DELETE /api/mcp/servers/:name/logs - Clear server logs
  server.delete<{ Params: { name: string } }>('/mcp/servers/:name/logs', async (request) => {
    mcpService.clearLogs(request.params.name)
    return { success: true }
  })

  // GET /api/mcp/tools - List all tools
  server.get('/mcp/tools', async () => {
    return mcpService.getAllTools()
  })

  // GET /api/mcp/tools/enabled - List only enabled tools
  server.get('/mcp/tools/enabled', async () => {
    return mcpService.getEnabledTools()
  })

  // PATCH /api/mcp/tools/:serverName/:toolName - Toggle tool
  server.patch<{ Params: { serverName: string; toolName: string } }>(
    '/mcp/tools/:serverName/:toolName',
    async (request) => {
      const body = ToggleBody.parse(request.body)
      mcpService.setToolEnabled(request.params.serverName, request.params.toolName, body.enabled)
      return { success: true, enabled: body.enabled }
    }
  )

  // POST /api/mcp/tools/:serverName/:toolName/toggle - Toggle tool (alternative)
  server.post<{ Params: { serverName: string; toolName: string } }>(
    '/mcp/tools/:serverName/:toolName/toggle',
    async (request) => {
      const body = ToggleBody.parse(request.body)
      mcpService.setToolEnabled(request.params.serverName, request.params.toolName, body.enabled)
      return { success: true, enabled: body.enabled }
    }
  )

  // POST /api/mcp/tools/:serverName/:toolName/execute - Execute a tool directly
  server.post<{ Params: { serverName: string; toolName: string } }>(
    '/mcp/tools/:serverName/:toolName/execute',
    async (request, reply) => {
      try {
        const body = ExecuteToolBody.parse(request.body)
        const result = await mcpService.executeTool(
          request.params.serverName,
          request.params.toolName,
          body.arguments
        )
        return result
      } catch (error) {
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Tool execution failed',
        })
      }
    }
  )

  // POST /api/mcp/tools/execute - Execute tool by name only
  server.post('/mcp/tools/execute', async (request, reply) => {
    const body = z.object({
      name: z.string(),
      arguments: z.record(z.any()).default({}),
    }).parse(request.body)

    try {
      const result = await mcpService.executeToolByName(body.name, body.arguments)
      return result
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Tool execution failed',
      })
    }
  })

  // POST /api/mcp/initialize - Initialize servers from config
  server.post('/mcp/initialize', async (request, reply) => {
    const body = z.object({
      servers: z.record(McpServerConfigSchema),
    }).parse(request.body)

    try {
      await mcpService.initializeFromConfig(body.servers)
      return { success: true, status: mcpService.getStatus() }
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Initialization failed',
      })
    }
  })

  // POST /api/mcp/shutdown - Shutdown all servers
  server.post('/mcp/shutdown', async () => {
    await mcpService.shutdown()
    return { success: true }
  })
}

