import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super('NOT_FOUND', message, 404, details)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details)
    this.name = 'ValidationError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class McpError extends AppError {
  constructor(message: string, details?: unknown) {
    super('MCP_ERROR', message, 503, details)
    this.name = 'McpError'
  }
}

export class LlmError extends AppError {
  constructor(message: string, details?: unknown) {
    super('LLM_ERROR', message, 502, details)
    this.name = 'LlmError'
  }
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error(error)

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const response: ApiError = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
    }
    return reply.status(400).send(response)
  }

  // Handle custom AppError instances
  if (error instanceof AppError) {
    const response: ApiError = {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    }
    return reply.status(error.statusCode).send(response)
  }

  // Handle Fastify validation errors
  if ('validation' in error && error.validation) {
    const response: ApiError = {
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
      },
    }
    return reply.status(400).send(response)
  }

  // Handle generic errors
  const response: ApiError = {
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : error.message || 'An unexpected error occurred',
    },
  }
  return reply.status(500).send(response)
}
