import { describe, it, expect } from 'vitest'

import * as mod from './type-guards'

describe('renderer lib: type-guards', () => {
  it('isValidQueryResult detects minimal shape', () => {
    expect(mod.isValidQueryResult({ data: 1, isLoading: false, isError: false })).toBe(true)
    expect(mod.isValidQueryResult({})).toBe(false)
    expect(mod.isValidQueryResult(null)).toBe(false)
  })

  it('safeGet traverses by path with fallback', () => {
    const obj = { a: { b: { c: 42 } } }
    expect(mod.safeGet<number>(obj, 'a.b.c', 0)).toBe(42)
    expect(mod.safeGet<string>(obj, 'a.b.x', 'nope')).toBe('nope')
    expect(mod.safeGet<string>(null as any, 'a', 'nope')).toBe('nope')
  })

  it('assertType returns the value unchanged', () => {
    const v = { x: 1 }
    expect(mod.assertType<typeof v>(v)).toBe(v)
  })

  it('safeSpread merges when source is object, else returns default', () => {
    const def = { a: 1, b: 2 }
    expect(mod.safeSpread({ b: 3, c: 4 }, def)).toEqual({ a: 1, b: 3, c: 4 })
    expect(mod.safeSpread(null as any, def)).toEqual(def)
  })
})

