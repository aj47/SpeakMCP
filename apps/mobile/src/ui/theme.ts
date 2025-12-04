/**
 * SpeakMCPMobile Design Tokens
 *
 * Aligned with SpeakMCP desktop app's design system (shadcn/ui "new-york" style, "neutral" base).
 * Uses the same neutral color palette for consistency across platforms.
 *
 * Color Reference (from SpeakMCP tailwind.css):
 * Light mode: background white, foreground near-black
 * Dark mode: background black, foreground white
 * Primary follows foreground (dark in light mode, light in dark mode)
 */
import { Platform, Appearance, ColorSchemeName } from 'react-native';

// Light mode colors - matches SpeakMCP :root CSS variables
const lightColors = {
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
  // Legacy aliases for backward compatibility
  surface: '#FFFFFF',
  text: '#0A0A0A',
  danger: '#EF4444',
  primarySoft: '#F5F5F5',
  textSecondary: '#737373',
};

// Dark mode colors - matches SpeakMCP .dark CSS variables
const darkColors = {
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
  // Legacy aliases for backward compatibility
  surface: '#0A0A0A',
  text: '#FCFCFC',
  danger: '#7F1D1D',
  primarySoft: '#262626',
  textSecondary: '#A3A3A3',
};

export type ThemeColors = typeof lightColors;

// Spacing scale - consistent with SpeakMCP design
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  '3xl': 32,
} as const;

// Border radius - matches --radius: 0.5rem (8px)
export const radius = {
  sm: 4,   // calc(var(--radius) - 4px)
  md: 6,   // calc(var(--radius) - 2px)
  lg: 8,   // var(--radius)
  xl: 12,
  full: 9999,
} as const;

// Typography - base styles without color (color added dynamically)
export const typographyBase = {
  h1: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  h2: { fontSize: 18, lineHeight: 26, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24 },
  bodyMuted: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 12, lineHeight: 16 },
} as const;

// Create a theme object with colors for a specific color scheme
function createTheme(colorScheme: 'light' | 'dark') {
  const colors = colorScheme === 'dark' ? darkColors : lightColors;

  return {
    colors,
    spacing,
    radius,
    typography: {
      h1: { ...typographyBase.h1, color: colors.foreground },
      h2: { ...typographyBase.h2, color: colors.foreground },
      body: { ...typographyBase.body, color: colors.foreground },
      bodyMuted: { ...typographyBase.bodyMuted, color: colors.mutedForeground },
      label: { ...typographyBase.label, color: colors.foreground },
      caption: { ...typographyBase.caption, color: colors.mutedForeground },
    },
    hairline: Platform.select({ ios: 0.5, default: 1 }) as number,
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      shadowColor: '#000',
      shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: colorScheme === 'dark' ? 3 : 1,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.input,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.select({ ios: 10, android: 8, default: 10 }),
      backgroundColor: colors.background,
      color: colors.foreground,
      fontSize: 16,
    },
    // Modern panel style matching SpeakMCP's .modern-panel
    modernPanel: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: colorScheme === 'dark' ? 3 : 1,
    },
    isDark: colorScheme === 'dark',
  } as const;
}

// Get current color scheme from system
function getColorScheme(): 'light' | 'dark' {
  const scheme = Appearance.getColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}

// Export themes for both modes
export const lightTheme = createTheme('light');
export const darkTheme = createTheme('dark');

// Default export - uses system preference (for backward compatibility)
// Components should prefer using useTheme() hook for reactive updates
export const theme = createTheme(getColorScheme());

// Re-export types
export type Theme = ReturnType<typeof createTheme>;

