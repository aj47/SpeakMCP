// Global type fixes for TypeScript errors

// Safe type assertion utility
export const $ = <T>(value: unknown): T => value as T

// Safe property access with fallback
export const safeProp = <T>(obj: unknown, prop: string, fallback: T): T => {
  if (obj && typeof obj === 'object' && prop in obj) {
    return (obj as Record<string, unknown>)[prop] as T
  }
  return fallback
}

// Safe array access
export const safeArray = <T>(value: unknown, fallback: T[] = []): T[] => {
  return Array.isArray(value) ? (value as T[]) : fallback
}

// Safe string access
export const safeString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback
}

// Safe boolean access
export const safeBoolean = (value: unknown, fallback = false): boolean => {
  return typeof value === 'boolean' ? value : fallback
}

// Safe number access
export const safeNumber = (value: unknown, fallback = 0): number => {
  return typeof value === 'number' ? value : fallback
}

// Type assertion for config objects
export const safeConfig = <T extends Record<string, unknown>>(config: unknown): T => {
  return (config || {}) as T
}

// Type assertion for query results
export const safeQuery = <T>(result: { data?: unknown }): { data: T } => {
  return { data: result.data as T }
}

// Type assertion for arrays
export const safeArrayProp = <T>(obj: unknown, prop: string, fallback: T[] = []): T[] => {
  const value = safeProp(obj, prop, fallback)
  return Array.isArray(value) ? value : fallback
}
