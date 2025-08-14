// Global type fixes for TypeScript compilation

// Ensure global types are available
declare global {
  interface Window {
    electronAPI?: any
  }
}

// Type-safe query result handler
export const safeQueryResult = <T>(data: any): T => {
  return (data || {}) as T
}

// Type-safe array handler
export const safeArray = <T>(data: any): T[] => {
  return Array.isArray(data) ? (data as T[]) : []
}

// Type-safe object handler
export const safeObject = <T extends Record<string, unknown>>(
  data: any,
  defaultValue: T
): T => {
  return typeof data === 'object' && data !== null ? (data as T) : defaultValue
}

// Safe property access
export const safeGet = <T>(
  obj: any,
  key: string,
  defaultValue: T
): T => {
  if (obj && typeof obj === 'object' && key in obj) {
    return obj[key] as T
  }
  return defaultValue
}

// Safe spread operation
export const safeSpread = <T>(
  source: any,
  target: T
): T => {
  return typeof source === 'object' && source !== null 
    ? { ...target, ...source } 
    : target
}
