import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('renderer lib: utils.cn', () => {
  it('joins class names', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz')
  })

  it('merges conflicting tailwind classes preferring later', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', 'text-red-600')).toBe('text-red-600')
  })
})

