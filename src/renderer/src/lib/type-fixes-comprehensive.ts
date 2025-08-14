// Comprehensive type fixes for TypeScript compilation issues

// Safe type casting utilities
export const safeCast = {
  string: (value: unknown, fallback = ''): string => 
    typeof value === 'string' ? value : fallback,
  
  number: (value: unknown, fallback = 0): number => 
    typeof value === 'number' ? value : fallback,
  
  boolean: (value: unknown, fallback = false): boolean => 
    typeof value === 'boolean' ? value : fallback,
  
  array: <T>(value: unknown, fallback: T[] = []): T[] => 
    Array.isArray(value) ? (value as T[]) : fallback,
  
  object: <T extends Record<string, unknown>>(
    value: unknown, 
    fallback: T
  ): T => 
    typeof value === 'object' && value !== null && !Array.isArray(value) 
      ? (value as T) 
      : fallback,
}

// Safe property access
export const safeProp = <T>(
  obj: unknown, 
  prop: string, 
  fallback: T
): T => {
  if (typeof obj === 'object' && obj !== null && prop in obj) {
    return (obj as any)[prop] as T
  }
  return fallback
}

// Safe function call
export const safeCall = <T>(
  fn: unknown, 
  ...args: any[]
): T | undefined => {
  if (typeof fn === 'function') {
    try {
      return fn(...args) as T
    } catch {
      return undefined
    }
  }
  return undefined
}
