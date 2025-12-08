/**
 * Theme Provider for SpeakMCPMobile
 * 
 * Provides reactive theme context similar to SpeakMCP's ThemeProvider.
 * Supports light, dark, and system (auto) modes.
 */
import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { Appearance, ColorSchemeName, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme, Theme } from './theme';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'speakmcp-theme-preference';

interface ThemeContextType {
  /** Current theme object with colors, spacing, etc. */
  theme: Theme;
  /** Current resolved theme name (always "light" or "dark") */
  colorScheme: 'light' | 'dark';
  /** User's theme preference setting */
  themeMode: ThemeMode;
  /** Whether the current theme is dark */
  isDark: boolean;
  /** Whether the current theme is light */
  isLight: boolean;
  /** Set the theme preference */
  setThemeMode: (mode: ThemeMode) => void;
  /** Toggle between light and dark (ignores system preference) */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  /** Initial theme mode (optional, defaults to 'system') */
  initialMode?: ThemeMode;
}

export function ThemeProvider({ children, initialMode = 'system' }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialMode);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved theme preference on mount
  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (stored && ['light', 'dark', 'system'].includes(stored)) {
          setThemeModeState(stored as ThemeMode);
        }
      })
      .catch(() => {
        // Ignore storage errors
      })
      .finally(() => {
        setIsLoaded(true);
      });
  }, []);

  // Resolve the actual color scheme based on themeMode and system preference
  const resolvedColorScheme: 'light' | 'dark' = 
    themeMode === 'system' 
      ? (systemColorScheme === 'dark' ? 'dark' : 'light')
      : themeMode;

  const currentTheme = resolvedColorScheme === 'dark' ? darkTheme : lightTheme;

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => {
      // Ignore storage errors
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeMode(resolvedColorScheme === 'dark' ? 'light' : 'dark');
  }, [resolvedColorScheme, setThemeMode]);

  const contextValue: ThemeContextType = {
    theme: currentTheme,
    colorScheme: resolvedColorScheme,
    themeMode,
    isDark: resolvedColorScheme === 'dark',
    isLight: resolvedColorScheme === 'light',
    setThemeMode,
    toggleTheme,
  };

  // Don't render children until we've loaded the saved preference
  // to prevent flash of wrong theme
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context
 * @throws Error if used outside ThemeProvider
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Legacy hook for backward compatibility
 * Returns just the isDark boolean
 */
export function useThemeDetection() {
  const { isDark } = useTheme();
  return { isDark };
}

