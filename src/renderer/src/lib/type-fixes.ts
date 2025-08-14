// Type-safe utility functions for React Query and component state

// Type assertion helper for React Query results
export const assertType = <T>(value: unknown): T => {
  return value as T
}

// Safe type casting for component state
export const safeCast = <T>(value: unknown, defaultValue: T): T => {
  if (value === null || value === undefined) {
    return defaultValue
  }
  return value as T
}

// Type guard for objects
export const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Type guard for arrays
export const isArray = (value: unknown): value is unknown[] => {
  return Array.isArray(value)
}
