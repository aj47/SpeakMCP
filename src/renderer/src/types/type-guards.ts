// Type guards for handling union types and unknown types

// Generic type guard for objects
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Type guard for arrays
export function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value)
}

// Type guard for strings
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

// Type guard for numbers
export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

// Type guard for booleans
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

// Safe property accessor for unknown types
export function safeGet<T>(obj: unknown, key: string, defaultValue: T): T {
  if (isObject(obj) && key in obj) {
    return obj[key] as T
  }
  return defaultValue
}

// Safe array accessor
export function safeArray<T>(value: unknown, defaultValue: T[] = []): T[] {
  return isArray<T>(value) ? value : defaultValue
}

// Safe string accessor
export function safeString(value: unknown, defaultValue: string = ''): string {
  return isString(value) ? value : defaultValue
}

// Safe number accessor
export function safeNumber(value: unknown, defaultValue: number = 0): number {
  return isNumber(value) ? value : defaultValue
}

// Safe boolean accessor
export function safeBoolean(value: unknown, defaultValue: boolean = false): boolean {
  return isBoolean(value) ? value : defaultValue
}
