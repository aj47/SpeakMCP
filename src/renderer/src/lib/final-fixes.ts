// Final comprehensive TypeScript fixes

// Type-safe utilities
export const safe = {
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

  get: <T>(obj: any, key: string, defaultValue: T): T => {
    if (obj && typeof obj === 'object' && key in obj) {
      return obj[key] as T
    }
    return defaultValue
  },

  length: (arr: any): number =>
    Array.isArray(arr) ? arr.length : 0,

  filter: <T>(arr: any, predicate: (item: T) => boolean): T[] =>
    Array.isArray(arr) ? arr.filter(predicate) : [],

  map: <T, U>(arr: any, mapper: (item: T) => U): U[] =>
    Array.isArray(arr) ? arr.map(mapper) : [],
}


