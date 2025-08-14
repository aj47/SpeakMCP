// Type-safe utilities for React Query results and component state

// Type guard for query results
export const isValidQueryResult = <T>(
  result: unknown,
): result is { data: T; isLoading: boolean; isError: boolean } => {
  return (
    typeof result === 'object' &&
    result !== null &&
    'data' in result &&
    'isLoading' in result &&
    'isError' in result
  )
}

// Safe property access with fallback
export const safeGet = <T>(
  obj: unknown,
  path: string,
  fallback: T,
): T => {
  if (typeof obj !== 'object' || obj === null) return fallback
  
  const keys = path.split('.')
  let current = obj
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as any)[key]
    } else {
      return fallback
    }
  }
  
  return current as T
}

// Type assertion helper
export const assertType = <T>(value: unknown): T => {
  return value as T
}

// Safe spread for objects
export const safeSpread = <T extends Record<string, unknown>>(
  obj: unknown,
  defaultObj: T,
): T => {
  if (typeof obj === 'object' && obj !== null) {
    return { ...defaultObj, ...obj } as T
  }
  return defaultObj
}
