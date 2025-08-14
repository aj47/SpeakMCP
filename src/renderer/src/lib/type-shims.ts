// Type-safe shims for fixing TypeScript compilation issues

// Safe type casting for React Query results
export const castQueryResult = <T>(data: any): T => {
  return (data as T) || ({} as T)
}

// Safe array casting
export const castArray = <T>(data: any): T[] => {
  return Array.isArray(data) ? (data as T[]) : []
}

// Safe object casting
export const castObject = <T extends Record<string, unknown>>(
  data: any,
  defaultValue: T,
): T => {
  return typeof data === 'object' && data !== null ? (data as T) : defaultValue
}

// Safe primitive casting
export const castString = (data: any, defaultValue = ''): string => {
  return typeof data === 'string' ? data : defaultValue
}

export const castNumber = (data: any, defaultValue = 0): number => {
  return typeof data === 'number' ? data : defaultValue
}

export const castBoolean = (data: any, defaultValue = false): boolean => {
  return typeof data === 'boolean' ? data : defaultValue
}

// Safe property access with fallback
export const getSafe = <T>(
  obj: any,
  path: string,
  defaultValue: T,
): T => {
  if (!obj || typeof obj !== 'object') return defaultValue

  const keys = path.split('.')
  let current = obj

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key]
    } else {
      return defaultValue
    }
  }

  return current as T
}
