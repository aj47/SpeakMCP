// Compilation fixes for TypeScript errors

// Ensure global type definitions
declare global {
  var vi: any
}

// Safe type casting utilities
export const cast = {
  string: (value: any, fallback = ''): string => 
    typeof value === 'string' ? value : fallback,
  
  number: (value: any, fallback = 0): number => 
    typeof value === 'number' ? value : fallback,
  
  boolean: (value: any, fallback = false): boolean => 
    typeof value === 'boolean' ? value : fallback,
  
  array: <T>(value: any, fallback: T[] = []): T[] => 
    Array.isArray(value) ? (value as T[]) : fallback,
  
  object: <T extends Record<string, unknown>>(
    value: any,
    defaultValue: T,
  ): T => 
    typeof value === 'object' && value !== null ? (value as T) : defaultValue,
}

// Safe property access
export const getSafe = <T>(
  obj: any,
  key: string,
  defaultValue: T,
): T => {
  if (obj && typeof obj === 'object' && key in obj) {
    return obj[key] as T
  }
  return defaultValue
}

// Safe function call
export const safeCall = <T>(
  fn: any,
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

// Global vi fix
export const vi = typeof globalThis !== 'undefined' 
  ? (globalThis as any).vi 
  : { mock: () => {}, fn: () => () => {} }
