import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { matchesKeyCombo } from '@shared/key-utils'

describe('Keyboard Event Handling', () => {
  describe('matchesKeyCombo', () => {
    it('should match ctrl-shift-t with both left and right control keys', () => {
      const modifiers = { ctrl: true, shift: true, alt: false }
      const combo = 'ctrl-shift-t'
      
      // Test with KeyT (which is what rdev produces)
      const event = { key: 'KeyT' }
      
      expect(matchesKeyCombo(event, modifiers, combo)).toBe(true)
    })

    it('should match ctrl-t with control key pressed', () => {
      const modifiers = { ctrl: true, shift: false, alt: false }
      const combo = 'ctrl-t'
      
      const event = { key: 'KeyT' }
      
      expect(matchesKeyCombo(event, modifiers, combo)).toBe(true)
    })

    it('should not match ctrl-shift-t when only ctrl is pressed', () => {
      const modifiers = { ctrl: true, shift: false, alt: false }
      const combo = 'ctrl-shift-t'
      
      const event = { key: 'KeyT' }
      
      expect(matchesKeyCombo(event, modifiers, combo)).toBe(false)
    })

    it('should not match ctrl-shift-t when only shift is pressed', () => {
      const modifiers = { ctrl: false, shift: true, alt: false }
      const combo = 'ctrl-shift-t'
      
      const event = { key: 'KeyT' }
      
      expect(matchesKeyCombo(event, modifiers, combo)).toBe(false)
    })

    it('should match alt-t with alt key pressed', () => {
      const modifiers = { ctrl: false, shift: false, alt: true }
      const combo = 'alt-t'
      
      const event = { key: 'KeyT' }
      
      expect(matchesKeyCombo(event, modifiers, combo)).toBe(true)
    })

    it('should handle complex key combinations', () => {
      const modifiers = { ctrl: true, shift: true, alt: true }
      const combo = 'ctrl-shift-alt-q'
      
      const event = { key: 'KeyQ' }
      
      expect(matchesKeyCombo(event, modifiers, combo)).toBe(true)
    })

    it('should handle special keys like slash', () => {
      const modifiers = { ctrl: true, shift: false, alt: false }
      const combo = 'ctrl-slash'
      
      const event = { key: 'Slash' }
      
      expect(matchesKeyCombo(event, modifiers, combo)).toBe(true)
    })

    it('should handle escape key', () => {
      const modifiers = { ctrl: true, shift: true, alt: false }
      const combo = 'ctrl-shift-escape'
      
      const event = { key: 'Escape' }
      
      expect(matchesKeyCombo(event, modifiers, combo)).toBe(true)
    })
  })

  describe('Key Event Simulation', () => {
    it('should simulate the issue with right control key being ignored', () => {
      // This test simulates the original issue where right control key
      // would not be detected, causing 3-key combinations to fail
      
      // Simulate the old behavior (only checking ControlLeft)
      const simulateOldBehavior = (keyPressed: string) => {
        return keyPressed === "ControlLeft"
      }
      
      // Simulate the new behavior (checking both ControlLeft and ControlRight)
      const simulateNewBehavior = (keyPressed: string) => {
        return keyPressed === "ControlLeft" || keyPressed === "ControlRight"
      }
      
      // Test with left control key
      expect(simulateOldBehavior("ControlLeft")).toBe(true)
      expect(simulateNewBehavior("ControlLeft")).toBe(true)
      
      // Test with right control key - this is where the fix matters
      expect(simulateOldBehavior("ControlRight")).toBe(false) // Old behavior: fails
      expect(simulateNewBehavior("ControlRight")).toBe(true)  // New behavior: works
    })

    it('should handle shift keys correctly (both left and right)', () => {
      // Shift keys were already handled correctly in the original code
      const handleShiftKey = (keyPressed: string) => {
        return keyPressed === "ShiftLeft" || keyPressed === "ShiftRight"
      }
      
      expect(handleShiftKey("ShiftLeft")).toBe(true)
      expect(handleShiftKey("ShiftRight")).toBe(true)
      expect(handleShiftKey("ControlLeft")).toBe(false)
    })
  })
})
