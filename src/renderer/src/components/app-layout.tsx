import { rendererHandlers } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect, useState } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import { LoadingSpinner } from "@renderer/components/ui/loading-spinner"
import { SettingsDragBar } from "@renderer/components/settings-drag-bar"
import { ActiveAgentsSidebar } from "@renderer/components/active-agents-sidebar"
import { ChevronDown, ChevronRight } from "lucide-react"

type NavLinkItem = {
  text: string
  href: string
  icon: string
}

export const Component = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [settingsExpanded, setSettingsExpanded] = useState(() => {
    // Expand settings by default if user is on a settings page
    return location.pathname.startsWith("/settings")
  })

  // Primary navigation - Agent Sessions is the main view
  const primaryLinks: NavLinkItem[] = [
    {
      text: "Sessions",
      href: "/",
      icon: "i-mingcute-robot-2-line",
    },
    {
      text: "History",
      href: "/history",
      icon: "i-mingcute-message-3-line",
    },
  ]

  // Settings sub-navigation
  const settingsLinks: NavLinkItem[] = [
    {
      text: "General",
      href: "/settings",
      icon: "i-mingcute-settings-3-line",
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
    {
      text: "Remote Server",
      href: "/settings/remote-server",
      icon: "i-mingcute-server-line",
    },
  ]

  // Expand settings when navigating to a settings page
  useEffect(() => {
    if (location.pathname.startsWith("/settings")) {
      setSettingsExpanded(true)
    }
  }, [location.pathname])

  useEffect(() => {
    return rendererHandlers.navigate.listen((url) => {
      navigate(url)
    })
  }, [])

  // Check if a route is active (exact match or starts with for nested routes)
  const isRouteActive = (href: string) => {
    if (href === "/") {
      return location.pathname === "/" || location.pathname === "/sessions"
    }
    return location.pathname === href || location.pathname.startsWith(href + "/")
  }

  return (
    <div className="flex h-dvh">
      <div className="flex w-44 shrink-0 flex-col border-r bg-background">
        <header
          className={process.env.IS_MAC ? "h-10" : "h-2"}
          aria-hidden
        ></header>

        <div className="grid gap-0.5 px-2 text-sm">
          {/* Primary Navigation */}
          {primaryLinks.map((link) => (
            <NavLink
              key={link.text}
              to={link.href}
              role="button"
              draggable={false}
              className={() => cn(
                "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-all duration-200",
                isRouteActive(link.href)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className={link.icon}></span>
              <span className="font-medium">{link.text}</span>
            </NavLink>
          ))}

          {/* Settings Section - Collapsible */}
          <button
            onClick={() => setSettingsExpanded(!settingsExpanded)}
            className={cn(
              "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-all duration-200",
              location.pathname.startsWith("/settings")
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {settingsExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <span className="i-mingcute-settings-3-line"></span>
            <span className="font-medium">Settings</span>
          </button>

          {/* Settings Sub-navigation */}
          {settingsExpanded && (
            <div className="ml-4 grid gap-0.5 border-l pl-2">
              {settingsLinks.map((link) => (
                <NavLink
                  key={link.text}
                  to={link.href}
                  role="button"
                  draggable={false}
                  className={() => cn(
                    "flex h-6 items-center gap-2 rounded-md px-2 text-xs font-medium transition-all duration-200",
                    isRouteActive(link.href)
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className={cn(link.icon, "text-xs")}></span>
                  <span>{link.text}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>

        {/* Active Agents Section */}
        <div className="mt-4">
          <ActiveAgentsSidebar />
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
      <div className="flex min-w-0 grow flex-col bg-background">
        {/* Draggable top bar for Mac - allows window dragging while content scrolls */}
        {process.env.IS_MAC && <SettingsDragBar />}

        {/* Scrollable content area */}
        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
