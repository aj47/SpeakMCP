import { describe, it, expect } from 'vitest'
import {
  parseKeyCombo,
  matchesKeyCombo,
  formatKeyComboForDisplay,
  validateKeyCombo,
  getEffectiveShortcut,
  ParsedKeyCombo,
} from './key-utils'

describe('parseKeyCombo', () => {
  it('should parse empty string', () => {
    const result = parseKeyCombo('')
    expect(result).toEqual({ ctrl: false, shift: false, alt: false, meta: false, key: '' })
  })

  it('should parse single key without modifiers', () => {
    const result = parseKeyCombo('t')
    expect(result).toEqual({ ctrl: false, shift: false, alt: false, meta: false, key: 't' })
  })

  it('should parse ctrl modifier', () => {
    const result = parseKeyCombo('ctrl-t')
    expect(result).toEqual({ ctrl: true, shift: false, alt: false, meta: false, key: 't' })
  })

  it('should parse shift modifier', () => {
    const result = parseKeyCombo('shift-a')
    expect(result).toEqual({ ctrl: false, shift: true, alt: false, meta: false, key: 'a' })
  })

  it('should parse alt modifier', () => {
    const result = parseKeyCombo('alt-space')
    expect(result).toEqual({ ctrl: false, shift: false, alt: true, meta: false, key: 'space' })
  })

  it('should parse meta modifier', () => {
    const result = parseKeyCombo('meta-k')
    expect(result).toEqual({ ctrl: false, shift: false, alt: false, meta: true, key: 'k' })
  })

  it('should parse cmd as meta modifier', () => {
    const result = parseKeyCombo('cmd-k')
    expect(result).toEqual({ ctrl: false, shift: false, alt: false, meta: true, key: 'k' })
  })

  it('should parse multiple modifiers', () => {
    const result = parseKeyCombo('ctrl-shift-t')
    expect(result).toEqual({ ctrl: true, shift: true, alt: false, meta: false, key: 't' })
  })

  it('should parse all modifiers', () => {
    const result = parseKeyCombo('ctrl-shift-alt-meta-x')
    expect(result).toEqual({ ctrl: true, shift: true, alt: true, meta: true, key: 'x' })
  })

  it('should handle uppercase input by converting to lowercase', () => {
    const result = parseKeyCombo('CTRL-SHIFT-T')
    expect(result).toEqual({ ctrl: true, shift: true, alt: false, meta: false, key: 't' })
  })

  it('should parse function keys', () => {
    const result = parseKeyCombo('f1')
    expect(result).toEqual({ ctrl: false, shift: false, alt: false, meta: false, key: 'f1' })
  })

  it('should parse function key with modifier', () => {
    const result = parseKeyCombo('ctrl-f12')
    expect(result).toEqual({ ctrl: true, shift: false, alt: false, meta: false, key: 'f12' })
  })

  it('should parse special keys', () => {
    const result = parseKeyCombo('ctrl-escape')
    expect(result).toEqual({ ctrl: true, shift: false, alt: false, meta: false, key: 'escape' })
  })
})

describe('matchesKeyCombo', () => {
  it('should return false for empty combo', () => {
    const result = matchesKeyCombo({ key: 't' }, { ctrl: false, shift: false, alt: false }, '')
    expect(result).toBe(false)
  })

  it('should match simple key with matching modifiers', () => {
    const result = matchesKeyCombo(
      { key: 't' },
      { ctrl: true, shift: false, alt: false },
      'ctrl-t'
    )
    expect(result).toBe(true)
  })

  it('should not match when ctrl modifier differs', () => {
    const result = matchesKeyCombo(
      { key: 't' },
      { ctrl: false, shift: false, alt: false },
      'ctrl-t'
    )
    expect(result).toBe(false)
  })

  it('should not match when shift modifier differs', () => {
    const result = matchesKeyCombo(
      { key: 't' },
      { ctrl: true, shift: true, alt: false },
      'ctrl-t'
    )
    expect(result).toBe(false)
  })

  it('should not match when alt modifier differs', () => {
    const result = matchesKeyCombo(
      { key: 't' },
      { ctrl: true, shift: false, alt: true },
      'ctrl-t'
    )
    expect(result).toBe(false)
  })

  it('should handle meta modifier', () => {
    const result = matchesKeyCombo(
      { key: 'k' },
      { ctrl: false, shift: false, alt: false, meta: true },
      'meta-k'
    )
    expect(result).toBe(true)
  })

  it('should convert KeyT format to t', () => {
    const result = matchesKeyCombo(
      { key: 'KeyT' },
      { ctrl: true, shift: false, alt: false },
      'ctrl-t'
    )
    expect(result).toBe(true)
  })

  it('should match space key', () => {
    const result = matchesKeyCombo(
      { key: 'space' },
      { ctrl: true, shift: false, alt: false },
      'ctrl- '
    )
    expect(result).toBe(true)
  })

  it('should match slash key', () => {
    const result = matchesKeyCombo(
      { key: 'slash' },
      { ctrl: true, shift: false, alt: false },
      'ctrl-/'
    )
    expect(result).toBe(true)
  })

  it('should match escape key', () => {
    const result = matchesKeyCombo(
      { key: 'escape' },
      { ctrl: true, shift: true, alt: false },
      'ctrl-shift-escape'
    )
    expect(result).toBe(true)
  })

  it('should match function keys', () => {
    const result = matchesKeyCombo(
      { key: 'f1' },
      { ctrl: false, shift: false, alt: false },
      'f1'
    )
    expect(result).toBe(true)
  })

  it('should match fn key', () => {
    const result = matchesKeyCombo(
      { key: 'function' },
      { ctrl: false, shift: false, alt: false },
      'fn'
    )
    expect(result).toBe(true)
  })

  it('should match arrow keys', () => {
    const result = matchesKeyCombo(
      { key: 'arrowup' },
      { ctrl: true, shift: false, alt: false },
      'ctrl-up'
    )
    expect(result).toBe(true)
  })
})

describe('formatKeyComboForDisplay', () => {
  it('should return empty string for empty combo', () => {
    expect(formatKeyComboForDisplay('')).toBe('')
  })

  it('should format single key', () => {
    expect(formatKeyComboForDisplay('t')).toBe('T')
  })

  it('should format ctrl modifier', () => {
    expect(formatKeyComboForDisplay('ctrl-t')).toBe('Ctrl + T')
  })

  it('should format shift modifier', () => {
    expect(formatKeyComboForDisplay('shift-a')).toBe('Shift + A')
  })

  it('should format alt modifier', () => {
    expect(formatKeyComboForDisplay('alt-x')).toBe('Alt + X')
  })

  it('should format multiple modifiers', () => {
    expect(formatKeyComboForDisplay('ctrl-shift-t')).toBe('Ctrl + Shift + T')
  })

  it('should format space key', () => {
    expect(formatKeyComboForDisplay('ctrl- ')).toBe('Ctrl + Space')
  })

  it('should format escape key', () => {
    expect(formatKeyComboForDisplay('ctrl-escape')).toBe('Ctrl + Esc')
  })

  it('should format arrow keys with symbols', () => {
    expect(formatKeyComboForDisplay('ctrl-up')).toBe('Ctrl + ↑')
    expect(formatKeyComboForDisplay('ctrl-down')).toBe('Ctrl + ↓')
    expect(formatKeyComboForDisplay('ctrl-left')).toBe('Ctrl + ←')
    expect(formatKeyComboForDisplay('ctrl-right')).toBe('Ctrl + →')
  })

  it('should format function keys', () => {
    expect(formatKeyComboForDisplay('f1')).toBe('F1')
    expect(formatKeyComboForDisplay('ctrl-f12')).toBe('Ctrl + F12')
  })

  it('should format fn key', () => {
    expect(formatKeyComboForDisplay('fn')).toBe('Fn')
  })

  it('should format page navigation keys', () => {
    expect(formatKeyComboForDisplay('ctrl-pageup')).toBe('Ctrl + Page Up')
    expect(formatKeyComboForDisplay('ctrl-pagedown')).toBe('Ctrl + Page Down')
  })
})

describe('validateKeyCombo', () => {
  it('should reject empty combo', () => {
    const result = validateKeyCombo('')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('empty')
  })

  it('should reject key without modifier (non-function key)', () => {
    const result = validateKeyCombo('t')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('modifier')
  })

  it('should accept function keys without modifiers', () => {
    expect(validateKeyCombo('f1').valid).toBe(true)
    expect(validateKeyCombo('f12').valid).toBe(true)
  })

  it('should accept fn key without modifiers', () => {
    expect(validateKeyCombo('fn').valid).toBe(true)
  })

  it('should accept key with ctrl modifier', () => {
    expect(validateKeyCombo('ctrl-t').valid).toBe(true)
  })

  it('should accept key with shift modifier', () => {
    expect(validateKeyCombo('shift-a').valid).toBe(true)
  })

  it('should accept key with alt modifier', () => {
    expect(validateKeyCombo('alt-space').valid).toBe(true)
  })

  it('should accept key with meta modifier', () => {
    expect(validateKeyCombo('meta-k').valid).toBe(true)
  })

  it('should reject modifier-only combo without main key', () => {
    const result = validateKeyCombo('ctrl-shift')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('main key')
  })

  it('should reject dangerous combo: ctrl-alt-delete', () => {
    const result = validateKeyCombo('ctrl-alt-delete')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('reserved')
  })

  it('should reject dangerous combo: alt-f4', () => {
    const result = validateKeyCombo('alt-f4')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('reserved')
  })

  it('should reject dangerous combo: ctrl-w', () => {
    const result = validateKeyCombo('ctrl-w')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('reserved')
  })

  it('should reject dangerous combo: ctrl-q', () => {
    const result = validateKeyCombo('ctrl-q')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('reserved')
  })

  it('should handle case-insensitive dangerous combo check', () => {
    const result = validateKeyCombo('CTRL-ALT-DELETE')
    expect(result.valid).toBe(false)
  })
})

describe('getEffectiveShortcut', () => {
  it('should return custom shortcut when type is custom', () => {
    expect(getEffectiveShortcut('custom', 'ctrl-shift-x')).toBe('ctrl-shift-x')
  })

  it('should return shortcut type when not custom', () => {
    expect(getEffectiveShortcut('ctrl-t', 'ctrl-shift-x')).toBe('ctrl-t')
  })

  it('should return undefined shortcut type when undefined', () => {
    expect(getEffectiveShortcut(undefined, 'ctrl-shift-x')).toBeUndefined()
  })

  it('should return undefined for custom type with undefined custom shortcut', () => {
    expect(getEffectiveShortcut('custom', undefined)).toBeUndefined()
  })
})

