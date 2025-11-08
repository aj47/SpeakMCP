import { describe, it, expect } from 'vitest'
import * as mod from './fixes'

describe('renderer lib: fixes', () => {
  it('safeQueryResult returns object or empty object cast', () => {
    expect(mod.safeQueryResult<{ x: number }>({ x: 1 })).toEqual({ x: 1 })
    expect(mod.safeQueryResult<{ x: number }>(null as any)).toEqual({})
  })

  it('safeArray returns array or []', () => {
    expect(mod.safeArray<number>([1,2,3])).toEqual([1,2,3])
    expect(mod.safeArray<number>(null as any)).toEqual([])
  })

  it('safeObject returns object or default', () => {
    const def = { a: 1 }
    expect(mod.safeObject<typeof def>({ a: 2 }, def)).toEqual({ a: 2 })
    expect(mod.safeObject<typeof def>(null as any, def)).toEqual(def)
  })

  it('safeGet returns property or default', () => {
    expect(mod.safeGet<number>({ a: 1 }, 'a', 0)).toBe(1)
    expect(mod.safeGet<number>({}, 'a', 0)).toBe(0)
  })

  it('safeSpread merges source onto target when source is object', () => {
    expect(mod.safeSpread({ b: 2 }, { a: 1 } as { a: number; b?: number })).toEqual({ a: 1, b: 2 })
    expect(mod.safeSpread(null as any, { a: 1 })).toEqual({ a: 1 })
  })
})

