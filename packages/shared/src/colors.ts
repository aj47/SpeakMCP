/**
 * SpeakMCP Shared Color Tokens
 *
 * Design system colors aligned with shadcn/ui "new-york" style, "neutral" base.
 * These tokens are platform-agnostic and can be used by both desktop (Tailwind CSS)
 * and mobile (React Native StyleSheet) apps.
 *
 * Color values are in hex format for maximum compatibility.
 */

/**
 * Light mode color palette
 * Matches SpeakMCP desktop :root CSS variables
 */
export const lightColors = {
  background: '#FFFFFF',        // --background: 0 0% 100%
  foreground: '#0A0A0A',        // --foreground: 0 0% 3.9%
  card: '#FFFFFF',              // --card: 0 0% 100%
  cardForeground: '#0A0A0A',    // --card-foreground: 0 0% 3.9%
  popover: '#FFFFFF',           // --popover: 0 0% 100%
  popoverForeground: '#0A0A0A', // --popover-foreground: 0 0% 3.9%
  primary: '#171717',           // --primary: 0 0% 9%
  primaryForeground: '#FAFAFA', // --primary-foreground: 0 0% 98%
  secondary: '#F5F5F5',         // --secondary: 0 0% 96.1%
  secondaryForeground: '#171717', // --secondary-foreground: 0 0% 9%
  muted: '#F5F5F5',             // --muted: 0 0% 96.1%
  mutedForeground: '#737373',   // --muted-foreground: 0 0% 45.1%
  accent: '#F5F5F5',            // --accent: 0 0% 96.1%
  accentForeground: '#171717',  // --accent-foreground: 0 0% 9%
  destructive: '#EF4444',       // --destructive: 0 84.2% 60.2%
  destructiveForeground: '#FAFAFA', // --destructive-foreground: 0 0% 98%
  border: '#F2F2F2',            // --border: 0 0% 95%
  input: '#E5E5E5',             // --input: 0 0% 89.8%
  ring: '#3B82F6',              // --ring: 217 91% 60%
  success: '#22c55e',           // green-500 - for success states
  successForeground: '#FFFFFF', // white text on success
  warning: '#f59e0b',           // amber-500 - for warning states
  warningForeground: '#000000', // black text on warning
  info: '#3b82f6',              // blue-500 - for info/pending states
  infoForeground: '#FFFFFF',    // white text on info
} as const;

/**
 * Dark mode color palette
 * Matches SpeakMCP desktop .dark CSS variables
 */
export const darkColors = {
  background: '#000000',        // --background: 0 0% 0%
  foreground: '#FCFCFC',        // --foreground: 0 0% 99%
  card: '#0A0A0A',              // --card: 0 0% 3.9%
  cardForeground: '#FAFAFA',    // --card-foreground: 0 0% 98%
  popover: '#0A0A0A',           // --popover: 0 0% 3.9%
  popoverForeground: '#FAFAFA', // --popover-foreground: 0 0% 98%
  primary: '#FAFAFA',           // --primary: 0 0% 98%
  primaryForeground: '#171717', // --primary-foreground: 0 0% 9%
  secondary: '#262626',         // --secondary: 0 0% 14.9%
  secondaryForeground: '#FAFAFA', // --secondary-foreground: 0 0% 98%
  muted: '#262626',             // --muted: 0 0% 14.9%
  mutedForeground: '#A3A3A3',   // --muted-foreground: 0 0% 63.9%
  accent: '#262626',            // --accent: 0 0% 14.9%
  accentForeground: '#FAFAFA',  // --accent-foreground: 0 0% 98%
  destructive: '#7F1D1D',       // --destructive: 0 62.8% 30.6%
  destructiveForeground: '#FAFAFA', // --destructive-foreground: 0 0% 98%
  border: '#262626',            // --border: 0 0% 14.9%
  input: '#262626',             // --input: 0 0% 14.9%
  ring: '#3B82F6',              // --ring: 221 83% 53%
  success: '#22c55e',           // green-500 - works in both modes
  successForeground: '#FFFFFF', // white text on success
  warning: '#f59e0b',           // amber-500 - works in both modes
  warningForeground: '#000000', // black text on warning
  info: '#3b82f6',              // blue-500 - works in both modes
  infoForeground: '#FFFFFF',    // white text on info
} as const;

/**
 * Type for color palette keys
 */
export type ColorKey = keyof typeof lightColors;

/**
 * Type for color palette (mutable version for runtime use)
 */
export type ColorPalette = {
  [K in ColorKey]: string;
};

/**
 * Get colors for a specific color scheme
 */
export function getColors(colorScheme: 'light' | 'dark'): ColorPalette {
  return colorScheme === 'dark' ? { ...darkColors } : { ...lightColors };
}

/**
 * Convert hex color to rgba with opacity
 * Useful for creating semi-transparent versions of theme colors
 */
export function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Spacing scale (in pixels)
 * Consistent across platforms
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  '3xl': 32,
} as const;

/**
 * Border radius scale (in pixels)
 * Base radius is 8px (--radius: 0.5rem)
 */
export const radius = {
  sm: 4,   // calc(var(--radius) - 4px)
  md: 6,   // calc(var(--radius) - 2px)
  lg: 8,   // var(--radius)
  xl: 12,
  full: 9999,
} as const;

/**
 * Typography scale
 * Font sizes and line heights in pixels
 */
export const typography = {
  h1: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  h2: { fontSize: 18, lineHeight: 26, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
} as const;

