import React, { createContext, useContext, useEffect, useState, ReactNode } from "react"

export type ThemeMode = "light" | "dark" | "system"

interface ThemeContextType {
  theme: "light" | "dark"
  themeMode: ThemeMode
  isDark: boolean
  isLight: boolean
  setThemeMode: (mode: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem("theme-preference")
      if (stored && ["light", "dark", "system"].includes(stored)) {
        return stored as ThemeMode
      }
    } catch (e) {}
    return "system"
  })

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (themeMode === "light") return "light"
    if (themeMode === "dark") return "dark"
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  const resolveTheme = (mode: ThemeMode): "light" | "dark" => {
    if (mode === "light") return "light"
    if (mode === "dark") return "dark"
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }

  // Update theme when themeMode changes
  useEffect(() => {
    const newTheme = resolveTheme(themeMode)
    setTheme(newTheme)

    const root = document.documentElement
    if (newTheme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }

    try {
      localStorage.setItem("theme-preference", themeMode)
    } catch (e) {}

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

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          const isDarkClass = document.documentElement.classList.contains("dark")
          const expectedTheme = resolveTheme(themeMode)

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

export function useThemeDetection() {
  const { isDark } = useTheme()
  return { isDark }
}
