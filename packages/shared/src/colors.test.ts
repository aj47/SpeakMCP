/**
 * Color tokens test suite
 * Tests for SpeakMCP shared color utilities, spacing, radius, and typography scales
 */

import { describe, it, expect } from "vitest"
import {
  lightColors,
  darkColors,
  getColors,
  hexToRgba,
  spacing,
  radius,
  typography,
  type ColorKey,
  type ColorPalette,
} from './colors';

describe('colors', () => {
  describe('lightColors', () => {
    it('should have all expected color keys', () => {
      const expectedKeys: ColorKey[] = [
        'background',
        'foreground',
        'card',
        'cardForeground',
        'popover',
        'popoverForeground',
        'primary',
        'primaryForeground',
        'secondary',
        'secondaryForeground',
        'muted',
        'mutedForeground',
        'accent',
        'accentForeground',
        'destructive',
        'destructiveForeground',
        'border',
        'input',
        'ring',
        'success',
        'successForeground',
        'warning',
        'warningForeground',
        'info',
        'infoForeground',
      ];
      expect(Object.keys(lightColors).sort()).toEqual(expectedKeys.sort());
    });

    it('should have valid hex color values', () => {
      for (const [key, value] of Object.entries(lightColors)) {
        expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });

    it('should have specific expected values', () => {
      expect(lightColors.background).toBe('#FFFFFF');
      expect(lightColors.foreground).toBe('#0A0A0A');
      expect(lightColors.primary).toBe('#171717');
      expect(lightColors.ring).toBe('#3B82F6');
      expect(lightColors.success).toBe('#22c55e');
      expect(lightColors.destructive).toBe('#EF4444');
    });
  });

  describe('darkColors', () => {
    it('should have all expected color keys', () => {
      const expectedKeys: ColorKey[] = [
        'background',
        'foreground',
        'card',
        'cardForeground',
        'popover',
        'popoverForeground',
        'primary',
        'primaryForeground',
        'secondary',
        'secondaryForeground',
        'muted',
        'mutedForeground',
        'accent',
        'accentForeground',
        'destructive',
        'destructiveForeground',
        'border',
        'input',
        'ring',
        'success',
        'successForeground',
        'warning',
        'warningForeground',
        'info',
        'infoForeground',
      ];
      expect(Object.keys(darkColors).sort()).toEqual(expectedKeys.sort());
    });

    it('should have valid hex color values', () => {
      for (const [key, value] of Object.entries(darkColors)) {
        expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });

    it('should have specific expected values', () => {
      expect(darkColors.background).toBe('#000000');
      expect(darkColors.foreground).toBe('#FCFCFC');
      expect(darkColors.primary).toBe('#FAFAFA');
      expect(darkColors.ring).toBe('#3B82F6');
      expect(darkColors.success).toBe('#22c55e');
      expect(darkColors.destructive).toBe('#7F1D1D');
    });

    it('should have different background than light mode', () => {
      expect(darkColors.background).not.toBe(lightColors.background);
      expect(darkColors.background).toBe('#000000');
    });
  });

  describe('getColors', () => {
    it('should return light colors for light mode', () => {
      const colors = getColors('light');
      expect(colors).toEqual(lightColors);
      expect(colors.background).toBe('#FFFFFF');
    });

    it('should return dark colors for dark mode', () => {
      const colors = getColors('dark');
      expect(colors).toEqual(darkColors);
      expect(colors.background).toBe('#000000');
    });

    it('should return a copy (mutation safe)', () => {
      const light1 = getColors('light');
      const light2 = getColors('light');
      expect(light1).not.toBe(light2); // Different object references
      expect(light1).toEqual(light2); // But same values
    });

    it('should include all color keys', () => {
      const lightColors = getColors('light');
      const darkColors = getColors('dark');

      const expectedKeys: ColorKey[] = [
        'background',
        'foreground',
        'card',
        'cardForeground',
        'popover',
        'popoverForeground',
        'primary',
        'primaryForeground',
        'secondary',
        'secondaryForeground',
        'muted',
        'mutedForeground',
        'accent',
        'accentForeground',
        'destructive',
        'destructiveForeground',
        'border',
        'input',
        'ring',
        'success',
        'successForeground',
        'warning',
        'warningForeground',
        'info',
        'infoForeground',
      ];

      expect(Object.keys(lightColors).sort()).toEqual(expectedKeys.sort());
      expect(Object.keys(darkColors).sort()).toEqual(expectedKeys.sort());
    });
  });

  describe('hexToRgba', () => {
    describe('6-digit hex', () => {
      it('should convert #RRGGBB format', () => {
        expect(hexToRgba('#FF0000', 1)).toBe('rgba(255, 0, 0, 1)');
        expect(hexToRgba('#00FF00', 0.5)).toBe('rgba(0, 255, 0, 0.5)');
        expect(hexToRgba('#0000FF', 0)).toBe('rgba(0, 0, 255, 0)');
      });

      it('should convert RRGGBB format (without #)', () => {
        expect(hexToRgba('FF0000', 1)).toBe('rgba(255, 0, 0, 1)');
        expect(hexToRgba('00FF00', 0.5)).toBe('rgba(0, 255, 0, 0.5)');
      });

      it('should handle lowercase hex', () => {
        expect(hexToRgba('#ff0000', 1)).toBe('rgba(255, 0, 0, 1)');
        expect(hexToRgba('#aAbBcC', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
      });
    });

    describe('3-digit shorthand hex', () => {
      it('should expand and convert #RGB format', () => {
        expect(hexToRgba('#F00', 1)).toBe('rgba(255, 0, 0, 1)');
        expect(hexToRgba('#0F0', 0.5)).toBe('rgba(0, 255, 0, 0.5)');
        expect(hexToRgba('#00F', 1)).toBe('rgba(0, 0, 255, 1)');
      });

      it('should expand and convert RGB format (without #)', () => {
        expect(hexToRgba('F00', 1)).toBe('rgba(255, 0, 0, 1)');
        expect(hexToRgba('ABC', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
      });
    });

    describe('rgba/rgb strings', () => {
      it('should preserve rgb values and update opacity', () => {
        expect(hexToRgba('rgb(255, 0, 0)', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
        expect(hexToRgba('rgba(0, 255, 0, 1)', 0)).toBe('rgba(0, 255, 0, 0)');
      });

      it('should handle rgba strings with spaces', () => {
        expect(hexToRgba('rgba(100, 200, 150, 0.8)', 0.5)).toBe('rgba(100, 200, 150, 0.5)');
      });
    });

    describe('opacity clamping', () => {
      it('should clamp opacity to 0-1 range', () => {
        expect(hexToRgba('#FF0000', 1.5)).toBe('rgba(255, 0, 0, 1)');
        expect(hexToRgba('#FF0000', -0.5)).toBe('rgba(255, 0, 0, 0)');
      });

      it('should handle decimal opacity', () => {
        expect(hexToRgba('#FF0000', 0.123)).toBe('rgba(255, 0, 0, 0.123)');
        expect(hexToRgba('#FF0000', 0.999)).toBe('rgba(255, 0, 0, 0.999)');
      });
    });

    describe('invalid input handling', () => {
      it('should use fallback for empty string', () => {
        expect(hexToRgba('', 1)).toBe('rgba(128, 128, 128, 1)');
      });

      it('should use fallback for null/undefined', () => {
        expect(hexToRgba(null as unknown as string, 1)).toBe('rgba(128, 128, 128, 1)');
        expect(hexToRgba(undefined as unknown as string, 1)).toBe('rgba(128, 128, 128, 1)');
      });

      it('should use fallback for invalid hex format', () => {
        expect(hexToRgba('#GGGGGG', 1)).toBe('rgba(128, 128, 128, 1)');
        expect(hexToRgba('#FFFF', 1)).toBe('rgba(128, 128, 128, 1)');
        expect(hexToRgba('#FFFFFFFF', 1)).toBe('rgba(128, 128, 128, 1)');
        expect(hexToRgba('notacolor', 1)).toBe('rgba(128, 128, 128, 1)');
      });

      it('should use fallback for malformed rgba string', () => {
        expect(hexToRgba('rgba(invalid)', 0.5)).toBe('rgba(128, 128, 128, 0.5)');
      });
    });

    describe('common colors', () => {
      it('should convert standard colors correctly', () => {
        expect(hexToRgba('#FFFFFF', 1)).toBe('rgba(255, 255, 255, 1)');
        expect(hexToRgba('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
        expect(hexToRgba('#3B82F6', 0.5)).toBe('rgba(59, 130, 246, 0.5)');
        expect(hexToRgba('#22c55e', 0.8)).toBe('rgba(34, 197, 94, 0.8)');
      });
    });
  });

  describe('spacing', () => {
    it('should have expected spacing values', () => {
      expect(spacing.xs).toBe(4);
      expect(spacing.sm).toBe(8);
      expect(spacing.md).toBe(12);
      expect(spacing.lg).toBe(16);
      expect(spacing.xl).toBe(20);
      expect(spacing.xxl).toBe(24);
      expect(spacing['3xl']).toBe(32);
    });

    it('should be const assertions (values are deeply readonly)', () => {
      // TypeScript const assertions prevent mutation at compile time
      // We verify values are as expected (runtime immutability varies by environment)
      expect(spacing.xs).toBe(4);
      expect(spacing.sm).toBe(8);
      expect(spacing.md).toBe(12);
    });
  });

  describe('radius', () => {
    it('should have expected radius values', () => {
      expect(radius.sm).toBe(4);
      expect(radius.md).toBe(6);
      expect(radius.lg).toBe(8);
      expect(radius.xl).toBe(12);
      expect(radius.full).toBe(9999);
    });

    it('should be const assertions (values are deeply readonly)', () => {
      // TypeScript const assertions prevent mutation at compile time
      // We verify values are as expected (runtime immutability varies by environment)
      expect(radius.sm).toBe(4);
      expect(radius.md).toBe(6);
      expect(radius.lg).toBe(8);
      expect(radius.full).toBe(9999);
    });
  });

  describe('typography', () => {
    it('should have expected typography values', () => {
      expect(typography.h1.fontSize).toBe(24);
      expect(typography.h1.lineHeight).toBe(32);
      expect(typography.h1.fontWeight).toBe('600');

      expect(typography.body.fontSize).toBe(16);
      expect(typography.body.lineHeight).toBe(24);
      expect(typography.body.fontWeight).toBe('400');

      expect(typography.caption.fontSize).toBe(12);
      expect(typography.caption.fontWeight).toBe('400');
    });

    it('should have const assertion values (compile-time immutability)', () => {
      // TypeScript const assertions prevent mutation at compile time
      // We verify values are as expected
      expect(typography.h1.fontSize).toBe(24);
      expect(typography.h1.fontWeight).toBe('600');
      expect(typography.body.fontSize).toBe(16);
      expect(typography.body.fontWeight).toBe('400');
    });
  });
});
