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

// Typography - base styles without color (color added dynamically)
export const typographyBase = {
  h1: { fontSize: sharedTypography.h1.fontSize, lineHeight: sharedTypography.h1.lineHeight, fontWeight: sharedTypography.h1.fontWeight },
  h2: { fontSize: sharedTypography.h2.fontSize, lineHeight: sharedTypography.h2.lineHeight, fontWeight: sharedTypography.h2.fontWeight },
  body: { fontSize: sharedTypography.body.fontSize, lineHeight: sharedTypography.body.lineHeight },
  bodyMuted: { fontSize: sharedTypography.body.fontSize, lineHeight: sharedTypography.body.lineHeight },
  label: { fontSize: sharedTypography.label.fontSize, lineHeight: sharedTypography.label.lineHeight, fontWeight: sharedTypography.label.fontWeight },
  caption: { fontSize: sharedTypography.caption.fontSize, lineHeight: sharedTypography.caption.lineHeight },
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

