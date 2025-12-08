/**
 * SpeakMCPMobile Design Tokens
 *
 * Uses shared design tokens from @speakmcp/shared for consistency
 * with the desktop app (shadcn/ui "new-york" style, "neutral" base).
 */
import { Platform, Appearance } from 'react-native';
import {
  lightColors as sharedLightColors,
  darkColors as sharedDarkColors,
  spacing,
  radius,
  typography as sharedTypography,
} from '@speakmcp/shared';

// Re-export shared tokens
export { spacing, radius };

// Extend shared colors with mobile-specific legacy aliases
const lightColors = {
  ...sharedLightColors,
  // Legacy aliases for backward compatibility
  surface: sharedLightColors.card,
  text: sharedLightColors.foreground,
  danger: sharedLightColors.destructive,
  primarySoft: sharedLightColors.secondary,
  textSecondary: sharedLightColors.mutedForeground,
};

const darkColors = {
  ...sharedDarkColors,
  // Legacy aliases for backward compatibility
  surface: sharedDarkColors.card,
  text: sharedDarkColors.foreground,
  danger: sharedDarkColors.destructive,
  primarySoft: sharedDarkColors.secondary,
  textSecondary: sharedDarkColors.mutedForeground,
};

export type ThemeColors = typeof lightColors;

/**
 * Mobile-specific typography scale
 *
 * Uses larger font sizes than desktop for better mobile readability.
 * Inspired by Open Interpreter 01-app's big font styling approach.
 *
 * Scale multiplier: ~1.25x larger than shared typography
 */
export const mobileTypography = {
  // Display text - hero/title use
  display: { fontSize: 36, lineHeight: 44, fontWeight: '700' as const },
  // Large headings
  h1: { fontSize: 30, lineHeight: 38, fontWeight: '600' as const },
  // Section headings
  h2: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  // Body text - primary content
  body: { fontSize: 20, lineHeight: 30, fontWeight: '400' as const },
  // Muted body text
  bodyMuted: { fontSize: 20, lineHeight: 30, fontWeight: '400' as const },
  // Form labels and buttons
  label: { fontSize: 18, lineHeight: 24, fontWeight: '500' as const },
  // Small text, hints, timestamps
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
} as const;

// Typography - base styles without color (color added dynamically)
// Using mobile-specific larger sizes for better readability
export const typographyBase = {
  display: { fontSize: mobileTypography.display.fontSize, lineHeight: mobileTypography.display.lineHeight, fontWeight: mobileTypography.display.fontWeight },
  h1: { fontSize: mobileTypography.h1.fontSize, lineHeight: mobileTypography.h1.lineHeight, fontWeight: mobileTypography.h1.fontWeight },
  h2: { fontSize: mobileTypography.h2.fontSize, lineHeight: mobileTypography.h2.lineHeight, fontWeight: mobileTypography.h2.fontWeight },
  body: { fontSize: mobileTypography.body.fontSize, lineHeight: mobileTypography.body.lineHeight },
  bodyMuted: { fontSize: mobileTypography.bodyMuted.fontSize, lineHeight: mobileTypography.bodyMuted.lineHeight },
  label: { fontSize: mobileTypography.label.fontSize, lineHeight: mobileTypography.label.lineHeight, fontWeight: mobileTypography.label.fontWeight },
  caption: { fontSize: mobileTypography.caption.fontSize, lineHeight: mobileTypography.caption.lineHeight },
} as const;

// Create a theme object with colors for a specific color scheme
function createTheme(colorScheme: 'light' | 'dark') {
  const colors = colorScheme === 'dark' ? darkColors : lightColors;

  return {
    colors,
    spacing,
    radius,
    typography: {
      display: { ...typographyBase.display, color: colors.foreground },
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
      paddingHorizontal: spacing.lg,
      paddingVertical: Platform.select({ ios: 14, android: 12, default: 14 }),
      backgroundColor: colors.background,
      color: colors.foreground,
      fontSize: mobileTypography.body.fontSize, // Use mobile body size for inputs
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

