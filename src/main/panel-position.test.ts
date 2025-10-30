import { describe, it, expect, vi } from 'vitest'

// Mock electron and config before importing module under test
vi.mock('electron', () => ({
  screen: {
    getDisplayNearestPoint: vi.fn(),
    getCursorScreenPoint: vi.fn(),
  },
}))
vi.mock('./config', () => ({
  configStore: {
    get: () => ({}),
    save: vi.fn(),
  },
}))

describe('panel-position', async () => {
  const mod = await import('./panel-position')
  const { calculatePositionForPreset, constrainPositionToScreen } = mod

  const screenSize = { x: 0, y: 0, width: 1920, height: 1080 }
  const size = { width: 300, height: 200 }

  describe('calculatePositionForPreset', () => {
    it('computes each preset correctly', () => {
      expect(calculatePositionForPreset('top-left', screenSize, size)).toEqual({ x: 10, y: 10 })
      expect(calculatePositionForPreset('top-center', screenSize, size)).toEqual({ x: 810, y: 10 })
      expect(calculatePositionForPreset('top-right', screenSize, size)).toEqual({ x: 1610, y: 10 })

      expect(calculatePositionForPreset('bottom-left', screenSize, size)).toEqual({ x: 10, y: 870 })
      expect(calculatePositionForPreset('bottom-center', screenSize, size)).toEqual({ x: 810, y: 870 })
      expect(calculatePositionForPreset('bottom-right', screenSize, size)).toEqual({ x: 1610, y: 870 })

      // default/custom falls back to top-right
      expect(calculatePositionForPreset('custom', screenSize, size)).toEqual({ x: 1610, y: 10 })
    })
  })

  describe('constrainPositionToScreen', () => {
    it('clamps position within screen bounds', () => {
      // off left/top
      expect(constrainPositionToScreen({ x: -100, y: -50 }, size, screenSize)).toEqual({ x: 0, y: 0 })
      // off right/bottom
      expect(constrainPositionToScreen({ x: 5000, y: 5000 }, size, screenSize)).toEqual({ x: 1620, y: 880 })
      // inside unchanged
      expect(constrainPositionToScreen({ x: 200, y: 300 }, size, screenSize)).toEqual({ x: 200, y: 300 })
    })
  })
})

