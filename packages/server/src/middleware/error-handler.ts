import { FastifyError, FastifyRequest, FastifyReply } from 'fastify'
import { ZodError } from 'zod'
import { ApiError } from '../utils/errors.js'

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  request.log.error(error)

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    reply.status(400).send({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: error.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    })
    return
  }

  // Handle our custom API errors
  if (error instanceof ApiError) {
    reply.status(error.statusCode).send({
      error: error.message,
      code: error.code,
    })
    return
  }

  // Handle Fastify validation errors
  if (error.validation) {
    reply.status(400).send({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: error.validation,
    })
    return
  }

  // Default error response
  const statusCode = error.statusCode ?? 500
  reply.status(statusCode).send({
    error: statusCode >= 500 ? 'Internal server error' : error.message,
    code: 'INTERNAL_ERROR',
  })
}

