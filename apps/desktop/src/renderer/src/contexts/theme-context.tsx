import React, { createContext, useContext, useEffect, useState, ReactNode } from "react"

export type ThemeMode = "light" | "dark" | "system"

interface ThemeContextType {
  /** Current resolved theme (always "light" or "dark") */
  theme: "light" | "dark"
  /** User's theme preference setting */
  themeMode: ThemeMode
  /** Whether the current theme is dark */
  isDark: boolean
  /** Whether the current theme is light */
  isLight: boolean
  /** Set the theme preference */
  setThemeMode: (mode: ThemeMode) => void
  /** Toggle between light and dark (ignores system preference) */
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    // Initialize from localStorage or default to system
    try {
      const stored = localStorage.getItem("theme-preference")
      if (stored && ["light", "dark", "system"].includes(stored)) {
        return stored as ThemeMode
      }
    } catch (e) {
      // Fallback if localStorage is not available
    }
    return "system"
  })

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    // Initialize resolved theme
    if (themeMode === "light") return "light"
    if (themeMode === "dark") return "dark"

    // System preference
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  // Function to resolve the actual theme based on mode
  const resolveTheme = (mode: ThemeMode): "light" | "dark" => {
    if (mode === "light") return "light"
    if (mode === "dark") return "dark"

    // System preference
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }

  // Update theme when themeMode changes
  useEffect(() => {
    const newTheme = resolveTheme(themeMode)
    setTheme(newTheme)

    // Update DOM class
    const root = document.documentElement
    if (newTheme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }

    // Store preference
    try {
      localStorage.setItem("theme-preference", themeMode)
    } catch (e) {
      // Ignore localStorage errors
    }

    // Dispatch event for compatibility with existing system
    window.dispatchEvent(
      new CustomEvent("theme-preference-changed", {
        detail: themeMode,
      })
    )
  }, [themeMode])

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (themeMode !== "system") return undefined

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

    const handleChange = (e: MediaQueryListEvent) => {
      const newTheme = e.matches ? "dark" : "light"
      setTheme(newTheme)

      // Update DOM class
      const root = document.documentElement
      if (newTheme === "dark") {
        root.classList.add("dark")
      } else {
        root.classList.remove("dark")
      }
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [themeMode])

  // Listen for external theme changes (from settings)
  useEffect(() => {
    const handleThemeChange = (e: CustomEvent) => {
      const newMode = e.detail as ThemeMode
      if (["light", "dark", "system"].includes(newMode)) {
        setThemeModeState(newMode)
      }
    }

    window.addEventListener("theme-preference-changed", handleThemeChange as EventListener)
    return () => window.removeEventListener("theme-preference-changed", handleThemeChange as EventListener)
  }, [])

  // Watch for DOM class changes (for compatibility with existing system)
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          const isDarkClass = document.documentElement.classList.contains("dark")
          const expectedTheme = resolveTheme(themeMode)

          // Only update if there's a mismatch (external change)
          if ((isDarkClass && expectedTheme === "light") || (!isDarkClass && expectedTheme === "dark")) {
            setTheme(isDarkClass ? "dark" : "light")
          }
        }
      })
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [themeMode])

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode)
  }

  const toggleTheme = () => {
    setThemeMode(theme === "dark" ? "light" : "dark")
  }

  const contextValue: ThemeContextType = {
    theme,
    themeMode,
    isDark: theme === "dark",
    isLight: theme === "light",
    setThemeMode,
    toggleTheme,
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

// Legacy hook for backward compatibility
export function useThemeDetection() {
  const { isDark } = useTheme()
  return { isDark }
}
