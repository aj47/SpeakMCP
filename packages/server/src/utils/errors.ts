export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static badRequest(message: string, code?: string): ApiError {
    return new ApiError(400, message, code)
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(401, message, 'UNAUTHORIZED')
  }

  static notFound(message = 'Not found'): ApiError {
    return new ApiError(404, message, 'NOT_FOUND')
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message, 'CONFLICT')
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, message, 'INTERNAL_ERROR')
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

