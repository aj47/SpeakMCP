import { describe, it, expect, vi } from 'vitest'
import {
  parseKeyCombo,
  matchesKeyCombo,
  formatKeyComboForDisplay,
  validateKeyCombo,
  getEffectiveShortcut,
} from './key-utils'

describe('key-utils', () => {
  describe('parseKeyCombo', () => {
    it('parses modifiers and key', () => {
      expect(parseKeyCombo('ctrl-shift-t')).toEqual({
        ctrl: true,
        shift: true,
        alt: false,
        meta: false,
        key: 't',
      })

      expect(parseKeyCombo('Cmd-Alt-space')).toEqual({
        ctrl: false,
        shift: false,
        alt: true,
        meta: true,
        key: 'space',
      })
    })

    it('handles empty input', () => {
      expect(parseKeyCombo('')).toEqual({ ctrl: false, shift: false, alt: false, meta: false, key: '' })
    })
  })

  describe('matchesKeyCombo', () => {
    it('matches letter keys with KeyX normalization', () => {
      const event = { key: 'KeyT' }
      const modifiers = { ctrl: true, shift: true, alt: false, meta: false }
      expect(matchesKeyCombo(event, modifiers, 'ctrl-shift-t')).toBe(true)
    })

    it('matches special keys with mappings', () => {
      const event = { key: 'slash' }
      const modifiers = { ctrl: false, shift: false, alt: false, meta: false }
      expect(matchesKeyCombo(event, modifiers, 'slash')).toBe(true)
      expect(matchesKeyCombo({ key: 'space' }, modifiers, 'space')).toBe(true)
    })

    it('respects modifier mismatches', () => {
      const event = { key: 'KeyT' }
      const modifiers = { ctrl: true, shift: false, alt: false, meta: false }
      expect(matchesKeyCombo(event, modifiers, 'ctrl-shift-t')).toBe(false)
    })
  })

  describe('formatKeyComboForDisplay', () => {
    const originalPlatform = process.platform

    it('formats with Cmd on darwin', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin' as any)
      expect(formatKeyComboForDisplay('meta-space')).toBe('Cmd + SPACE')
    })

    it('formats with Meta on non-darwin', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as any)
      expect(formatKeyComboForDisplay('meta-slash')).toBe('Meta + SLASH')
      // restore
      vi.spyOn(process, 'platform', 'get').mockReturnValue(originalPlatform as any)
    })

    it('returns empty string for empty combo', () => {
      expect(formatKeyComboForDisplay('')).toBe('')
    })
  })

  describe('validateKeyCombo', () => {
    it('validates basic combos and rejects invalid/dangerous ones', () => {
      expect(validateKeyCombo('ctrl-t')).toEqual({ valid: true })
      expect(validateKeyCombo('f10')).toEqual({ valid: true })

      expect(validateKeyCombo('')).toEqual({ valid: false, error: 'Key combination cannot be empty' })
      expect(validateKeyCombo('t')).toEqual({
        valid: false,
        error: 'Key combination must include at least one modifier key (Ctrl, Shift, Alt, Meta) or be a function key',
      })
      expect(validateKeyCombo('ctrl-alt-delete')).toEqual({
        valid: false,
        error: 'This key combination is reserved by the system',
      })
      expect(validateKeyCombo('ctrl-shift-escape')).toEqual({
        valid: false,
        error: 'This key combination is reserved by the system',
      })
    })
  })

  describe('getEffectiveShortcut', () => {
    it('returns custom when type is custom, otherwise returns type', () => {
      expect(getEffectiveShortcut('custom', 'ctrl-k')).toBe('ctrl-k')
      expect(getEffectiveShortcut('ctrl-t', 'ctrl-k')).toBe('ctrl-t')
      expect(getEffectiveShortcut(undefined, undefined)).toBeUndefined()
    })
  })
})

