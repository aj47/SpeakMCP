import { rendererHandlers } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect, useState, useCallback } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import { LoadingSpinner } from "@renderer/components/ui/loading-spinner"
import { OnboardingModal } from "@renderer/components/onboarding-modal"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"

type NavLink = {
  text: string
  href: string
  icon: string
}

export const Component = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()

  const [showOnboarding, setShowOnboarding] = useState(false)

  const navLinks: NavLink[] = [
    {
      text: "General",
      href: "/settings",
      icon: "i-mingcute-settings-3-line",
    },
    {
      text: "Conversations",
      href: "/conversations",
      icon: "i-mingcute-message-3-line",
    },
    {
      text: "Providers",
      href: "/settings/providers",
      icon: "i-mingcute-cloud-line",
    },
    {
      text: "Models",
      href: "/settings/models",
      icon: "i-mingcute-brain-line",
    },
    {
      text: "Agents",
      href: "/settings/tools",
      icon: "i-mingcute-android-2-line",
    },
    {
      text: "MCP Tools",
      href: "/settings/mcp-tools",
      icon: "i-mingcute-tool-line",
    },
  ]

  useEffect(() => {
    return rendererHandlers.navigate.listen((url) => {
      navigate(url)
    })
  }, [])

  // Check if onboarding should be shown
  useEffect(() => {
    if (configQuery.data) {
      const config = configQuery.data as any
      const hasSeenOnboarding = config.hasSeenOnboarding ?? false
      const showOnboardingAgain = config.showOnboardingAgain ?? true

      // Show onboarding if user hasn't seen it or if they want to see it again
      if (!hasSeenOnboarding || showOnboardingAgain) {
        setShowOnboarding(true)
      }
    }
  }, [configQuery.data])

  const handleOnboardingComplete = useCallback((dontShowAgain: boolean) => {
    const currentConfig = configQuery.data as any
    saveConfigMutation.mutate({
      config: {
        ...currentConfig,
        hasSeenOnboarding: true,
        showOnboardingAgain: !dontShowAgain,
      },
    })
    setShowOnboarding(false)
  }, [configQuery.data, saveConfigMutation])

  const handleOnboardingClose = useCallback(() => {
    setShowOnboarding(false)
  }, [])

  return (
    <>
      <div className="flex h-dvh">
        <div className="app-drag-region flex w-44 shrink-0 flex-col border-r bg-background">
          <header
            className={process.env.IS_MAC ? "h-10" : "h-2"}
            aria-hidden
          ></header>

          <div className="grid gap-0.5 px-2 text-sm">
            {navLinks.map((link) => (
              <NavLink
                key={link.text}
                to={link.href}
                role="button"
                draggable={false}
                className={({ isActive: _isActive }) => {
                  // For exact matching, check if the current location exactly matches the link href
                  const isExactMatch = location.pathname === link.href
                  return cn(
                    "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-all duration-200",
                    isExactMatch
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )
                }}
              >
                <span className={link.icon}></span>
                <span className="font-medium">{link.text}</span>
              </NavLink>
            ))}
          </div>

          {/* Loading spinner at the bottom of the sidebar */}
          <div className="flex flex-1 flex-col justify-end">
            <div className="flex flex-col items-center space-y-2 pb-4">
              <LoadingSpinner size="lg" />
              <div>SpeakMCP</div>
              <div className="text-xs">{process.env.APP_VERSION}</div>
            </div>
          </div>
        </div>
        <div className="flex grow flex-col overflow-auto bg-background">
          <Outlet />
        </div>
      </div>

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={showOnboarding}
        onClose={handleOnboardingClose}
        onComplete={handleOnboardingComplete}
      />
    </>
  )
}
