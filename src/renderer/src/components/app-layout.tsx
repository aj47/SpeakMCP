import { rendererHandlers } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import { LoadingSpinner } from "@renderer/components/ui/loading-spinner"
import { SettingsDragBar } from "@renderer/components/settings-drag-bar"
import { ActiveAgentsSidebar } from "@renderer/components/active-agents-sidebar"

type NavLink = {
  text: string
  href: string
  icon: string
}

export const Component = () => {
  const navigate = useNavigate()
  const location = useLocation()

  // Primary navigation - Sessions as first-class UI
  const primaryNavLinks: NavLink[] = [
    {
      text: "Sessions",
      href: "/",
      icon: "i-mingcute-chat-2-line",
    },
    {
      text: "History",
      href: "/history",
      icon: "i-mingcute-message-3-line",
    },
  ]

  // Settings navigation - Secondary
  const settingsNavLinks: NavLink[] = [
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

  return (
    <div className="flex h-dvh">
      <div className="flex w-44 shrink-0 flex-col border-r bg-background">
        <header
          className={process.env.IS_MAC ? "h-10" : "h-2"}
          aria-hidden
        ></header>

        {/* Primary Navigation - Sessions & History */}
        <div className="grid gap-0.5 px-2 text-sm">
          {primaryNavLinks.map((link) => (
            <NavLink
              key={link.text}
              to={link.href}
              role="button"
              draggable={false}
              className={({ isActive: _isActive }) => {
                // For "/" route, only match exactly. For others, check exact match
                const isExactMatch = link.href === "/"
                  ? location.pathname === "/" || location.pathname === "/sessions"
                  : location.pathname === link.href
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

        {/* Active Agents Section */}
        <div className="mt-3">
          <ActiveAgentsSidebar />
        </div>

        {/* Settings Navigation - Secondary */}
        <div className="mt-4 border-t pt-3">
          <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Settings
          </div>
          <div className="grid gap-0.5 px-2 text-sm">
            {settingsNavLinks.map((link) => (
              <NavLink
                key={link.text}
                to={link.href}
                role="button"
                draggable={false}
                className={({ isActive: _isActive }) => {
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
