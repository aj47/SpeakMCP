import { describe, it, expect } from 'vitest'
import { safe } from './final-fixes'

describe('renderer lib: final-fixes', () => {
  it('primitive guards', () => {
    expect(safe.string('x')).toBe('x')
    expect(safe.string(1 as any, 'f')).toBe('f')

    expect(safe.number(2)).toBe(2)
    expect(safe.number('n' as any, 7)).toBe(7)

    expect(safe.boolean(true)).toBe(true)
    expect(safe.boolean('t' as any, false)).toBe(false)
  })

  it('array/object/get helpers', () => {
    expect(safe.array<number>([1,2,3])).toEqual([1,2,3])
    expect(safe.array<number>(null as any, [9])).toEqual([9])

    const def = { a: 1 }
    expect(safe.object<typeof def>({ a: 2 }, def)).toEqual({ a: 2 })
    expect(safe.object<typeof def>(null as any, def)).toEqual(def)

    expect(safe.get<number>({ a: 1 }, 'a', 0)).toBe(1)
    expect(safe.get<number>({}, 'a', 0)).toBe(0)
  })

  it('length/filter/map helpers', () => {
    expect(safe.length([1,2,3])).toBe(3)
    expect(safe.length(null as any)).toBe(0)

    expect(safe.filter<number>([1,2,3,4], (n) => n % 2 === 0)).toEqual([2,4])
    expect(safe.filter<number>(null as any, (n) => n > 0)).toEqual([])

    expect(safe.map<number, number>([1,2,3], (n) => n * 2)).toEqual([2,4,6])
    expect(safe.map<number, number>(null as any, (n) => n * 2)).toEqual([])
  })
})

