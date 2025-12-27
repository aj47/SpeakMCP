import { FastifyPluginAsync } from 'fastify'
import { diagnosticsService } from '../services/diagnostics-service.js'
import { z } from 'zod'

export const diagnosticsRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/diagnostics/report - Generate full diagnostic report
  server.get('/diagnostics/report', async () => {
    return diagnosticsService.generateReport()
  })

  // GET /api/diagnostics/health - Perform health check
  server.get('/diagnostics/health', async () => {
    return diagnosticsService.checkHealth()
  })

  // GET /api/diagnostics/errors - Get recent errors
  server.get('/diagnostics/errors', async (request) => {
    const query = z.object({
      limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 50),
      detailed: z.string().optional().transform(v => v === 'true'),
    }).parse(request.query)

    if (query.detailed) {
      return diagnosticsService.getErrorDetails(query.limit)
    }
    return diagnosticsService.getRecentErrors(query.limit)
  })

  // DELETE /api/diagnostics/errors - Clear error log
  server.delete('/diagnostics/errors', async () => {
    const count = diagnosticsService.clearErrors()
    return { cleared: count }
  })

  // POST /api/diagnostics/errors/cleanup - Clear old errors
  server.post('/diagnostics/errors/cleanup', async (request) => {
    const body = z.object({
      maxAgeDays: z.number().default(7),
    }).parse(request.body ?? {})

    const maxAgeMs = body.maxAgeDays * 24 * 60 * 60 * 1000
    const count = diagnosticsService.clearOldErrors(maxAgeMs)
    return { cleared: count }
  })

  // POST /api/diagnostics/log - Log an error/warning manually
  server.post('/diagnostics/log', async (request) => {
    const body = z.object({
      level: z.enum(['error', 'warning']).default('error'),
      message: z.string().min(1),
      stack: z.string().optional(),
      context: z.record(z.any()).optional(),
    }).parse(request.body)

    if (body.level === 'error') {
      diagnosticsService.logError(body.message, body.stack, body.context)
    } else {
      diagnosticsService.logWarning(body.message, body.context)
    }

    return { success: true }
  })
}

