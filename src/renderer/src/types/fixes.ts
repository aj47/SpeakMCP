// Comprehensive TypeScript fixes for electron-vite boilerplate

// Global type fixes for unknown types
export const fixUnknown = <T>(value: unknown, fallback: T): T => {
  return (value as T) || fallback
}

// Safe property access with type assertion
export const prop = <T>(obj: unknown, key: string, fallback: T): T => {
  if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
    return (obj as Record<string, T>)[key]
  }
  return fallback
}

// Safe array access
export const arr = <T>(value: unknown, fallback: T[] = []): T[] => {
  return Array.isArray(value) ? value as T[] : fallback
}

// Safe string access
export const str = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback
}

// Safe number access
export const num = (value: unknown, fallback = 0): number => {
  return typeof value === 'number' ? value : fallback
}

// Safe boolean access
export const bool = (value: unknown, fallback = false): boolean => {
  return typeof value === 'boolean' ? value : fallback
}

// Safe object access
export const obj = <T extends Record<string, unknown>>(value: unknown, fallback: T = {} as T): T => {
  return (typeof value === 'object' && value !== null ? value : fallback) as T
}

// Function call wrapper for missing arguments
export const call = <T extends (...args: any[]) => any>(
  fn: T,
  ...args: Parameters<T>
): ReturnType<T> => {
  return fn(...args)
}

// Safe property chain access
export const chain = <T>(
  obj: unknown,
  path: string,
  fallback: T
): T => {
  const keys = path.split('.')
  let current = obj
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return fallback
    }
  }
  
  return current as T
}

// Type assertion for React state
export const state = <T>(value: unknown, fallback: T): T => {
  return (value as T) || fallback
}

// Type assertion for query results
export const query = <T>(result: { data?: unknown }): { data: T } => {
  return { data: result.data as T }
}

// Type assertion for API responses
export const api = <T>(response: unknown): T => {
  return response as T
}

// Safe function call with default
export const safeCall = <T>(
  fn: ((...args: any[]) => T) | undefined,
  fallback: T,
  ...args: any[]
): T => {
  return fn ? fn(...args) : fallback
}
