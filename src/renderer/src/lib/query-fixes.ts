// Comprehensive type fixes for React Query and component state

// Safe query result handler
export const handleQueryResult = <T>(result: any): T => {
  if (result && typeof result === 'object') {
    return result as T
  }
  return {} as T
}

// Safe array access
export const safeArray = <T>(arr: unknown): T[] => {
  if (Array.isArray(arr)) {
    return arr as T[]
  }
  return []
}

// Safe object access
export const safeObject = <T extends Record<string, unknown>>(
  obj: unknown,
  defaultObj: T,
): T => {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return obj as T
  }
  return defaultObj
}

// Safe number access
export const safeNumber = (num: unknown, defaultNum = 0): number => {
  if (typeof num === 'number') {
    return num
  }
  return defaultNum
}

// Safe string access
export const safeString = (str: unknown, defaultStr = ''): string => {
  if (typeof str === 'string') {
    return str
  }
  return defaultStr
}

// Safe boolean access
export const safeBoolean = (bool: unknown, defaultBool = false): boolean => {
  if (typeof bool === 'boolean') {
    return bool
  }
  return defaultBool
}
