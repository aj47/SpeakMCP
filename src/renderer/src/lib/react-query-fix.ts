// Comprehensive React Query type fixes

// Safe query result handler
export const safeQueryResult = <T>(data: any): T => {
  return (data || {}) as T
}

// Safe array handler
export const safeArray = <T>(data: any): T[] => {
  return Array.isArray(data) ? (data as T[]) : []
}

// Safe object handler
export const safeObject = <T extends Record<string, unknown>>(
  data: any,
  defaultValue: T,
): T => {
  return typeof data === 'object' && data !== null ? (data as T) : defaultValue
}

// Safe property access
export const safeProp = <T>(
  obj: any,
  prop: string,
  defaultValue: T,
): T => {
  if (obj && typeof obj === 'object' && prop in obj) {
    return obj[prop] as T
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

// Safe spread operation
export const safeSpread = <T>(
  source: any,
  target: T,
): T => {
  return typeof source === 'object' && source !== null 
    ? { ...target, ...source } 
    : target
}
