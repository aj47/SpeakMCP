import { rendererHandlers } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect, useState } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import { LoadingSpinner } from "@renderer/components/ui/loading-spinner"
import { SettingsDragBar } from "@renderer/components/settings-drag-bar"
import { ActiveAgentsSidebar } from "@renderer/components/active-agents-sidebar"

type NavLinkItem = {
  text: string
  href: string
  icon: string
}

export const Component = () => {
  const navigate = useNavigate()
  const location = useLocation()
  // Settings dropdown is expanded by default for better discoverability
  const [settingsExpanded, setSettingsExpanded] = useState(true)

  // Primary navigation - always visible
  const primaryNavLinks: NavLinkItem[] = [
    {
      text: "Sessions",
      href: "/",
      icon: "i-mingcute-grid-line",
    },
    {
      text: "History",
      href: "/history",
      icon: "i-mingcute-message-3-line",
    },
  ]

  // Settings navigation - collapsible
  const settingsNavLinks: NavLinkItem[] = [
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

  useEffect(() => {
    return rendererHandlers.navigate.listen((url) => {
      navigate(url)
    })
  }, [])

  // Helper component for rendering nav links
  const renderNavLink = (link: NavLinkItem) => (
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
  )

  return (
    <div className="flex h-dvh">
      <div className="flex w-44 shrink-0 flex-col border-r bg-background">
        <header
          className={process.env.IS_MAC ? "h-10" : "h-2"}
          aria-hidden
        ></header>

        {/* Primary Navigation */}
        <div className="grid gap-0.5 px-2 text-sm">
          {primaryNavLinks.map(renderNavLink)}
        </div>

        {/* Active Agents Section - with max-height and scroll to prevent overflow into macOS traffic lights */}
        <div className="mt-4 max-h-[40vh] overflow-y-auto">
          <ActiveAgentsSidebar />
        </div>

        {/* Settings Section - Collapsible */}
        <div className="mt-4 px-2">
          <button
            onClick={() => setSettingsExpanded(!settingsExpanded)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-all duration-200",
              "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <span className={cn(
              "transition-transform duration-200",
              settingsExpanded ? "i-mingcute-down-line" : "i-mingcute-right-line"
            )}></span>
            <span className="i-mingcute-settings-3-line"></span>
            <span>Settings</span>
          </button>

          {settingsExpanded && (
            <div className="mt-1 grid gap-0.5 pl-2 text-sm">
              {settingsNavLinks.map(renderNavLink)}
            </div>
          )}
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
