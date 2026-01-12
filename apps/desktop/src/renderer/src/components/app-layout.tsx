import { rendererHandlers } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect, useState } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import { LoadingSpinner } from "@renderer/components/ui/loading-spinner"
import { SettingsDragBar } from "@renderer/components/settings-drag-bar"
import { ActiveAgentsSidebar } from "@renderer/components/active-agents-sidebar"
import { SidebarProfileSelector } from "@renderer/components/sidebar-profile-selector"
import { useSidebar, SIDEBAR_DIMENSIONS } from "@renderer/hooks/use-sidebar"
import { useConfigQuery } from "@renderer/lib/query-client"
import { PanelLeftClose, PanelLeft } from "lucide-react"

type NavLinkItem = {
  text: string
  href: string
  icon: string
}

export const Component = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [settingsExpanded, setSettingsExpanded] = useState(true)
  const { isCollapsed, width, isResizing, toggleCollapse, handleResizeStart } = useSidebar()
  const configQuery = useConfigQuery()

  const whatsappEnabled = configQuery.data?.whatsappEnabled ?? false

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
      text: "Profile",
      href: "/settings/tools",
      icon: "i-mingcute-user-setting-line",
    },
    {
      text: "MCP Tools",
      href: "/settings/mcp-tools",
      icon: "i-mingcute-tool-line",
    },
    {
      text: "Skills",
      href: "/settings/skills",
      icon: "i-mingcute-sparkles-line",
    },
    {
      text: "Remote Server",
      href: "/settings/remote-server",
      icon: "i-mingcute-server-line",
    },
    // Only show WhatsApp settings when enabled
    ...(whatsappEnabled ? [{
      text: "WhatsApp",
      href: "/settings/whatsapp",
      icon: "i-mingcute-message-4-line",
    }] : []),
    {
      text: "Langfuse",
      href: "/settings/langfuse",
      icon: "i-mingcute-chart-line-line",
    },
    {
      text: "Dual-Model",
      href: "/settings/dual-model",
      icon: "i-mingcute-brain-2-line",
    },
  ]

  // Route aliases that should highlight the same nav item
  // Maps route paths to their primary nav link href
  const routeAliases: Record<string, string> = {
    "/settings/general": "/settings",
    "/settings/providers": "/settings/models",
  }

  // Check if current path matches the nav link (including aliases)
  const isNavLinkActive = (linkHref: string): boolean => {
    const currentPath = location.pathname
    // Exact match
    if (currentPath === linkHref) return true
    // Check if current path is an alias that maps to this link
    const aliasTarget = routeAliases[currentPath]
    return aliasTarget === linkHref
  }

  useEffect(() => {
    return rendererHandlers.navigate.listen((url) => {
      navigate(url)
    })
  }, [])

  const renderNavLink = (link: NavLinkItem) => {
    const isActive = isNavLinkActive(link.href)
    return (
      <NavLink
        key={link.text}
        to={link.href}
        role="button"
        draggable={false}
        title={isCollapsed ? link.text : undefined}
        aria-label={isCollapsed ? link.text : undefined}
        aria-current={isActive ? "page" : undefined}
        className={() => {
          return cn(
            "flex h-7 items-center rounded-md px-2 font-medium transition-all duration-200",
            isCollapsed ? "justify-center" : "gap-2",
            isActive
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )
        }}
      >
        <span className={cn(link.icon, "shrink-0")}></span>
        {!isCollapsed && <span className="font-medium truncate">{link.text}</span>}
      </NavLink>
    )
  }

  const sidebarWidth = isCollapsed ? SIDEBAR_DIMENSIONS.width.collapsed : width

  return (
    <div className="flex h-dvh">
      {/* Sidebar with dynamic width */}
      <div
        className={cn(
          "relative flex shrink-0 flex-col border-r bg-background",
          !isResizing && "transition-all duration-200",
          isResizing && "select-none"
        )}
        style={{ width: sidebarWidth }}
      >
        {/* Header with collapse toggle */}
        <header
          className={cn(
            "flex items-center",
            isCollapsed ? "justify-center" : "justify-end",
            // On macOS, add extra top margin when collapsed to avoid traffic light buttons
            process.env.IS_MAC ? (isCollapsed ? "h-16 mt-6" : "h-10 pt-6") : "h-8 pt-2",
            isCollapsed ? "px-1" : "px-2"
          )}
        >
          <button
            onClick={toggleCollapse}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </header>

        {/* Profile Selector - quick access to switch profiles */}
        {!isCollapsed && (
          <div className="px-2 pb-2">
            <SidebarProfileSelector />
          </div>
        )}

        {/* Settings Section - Collapsible, collapsed by default */}
        <div className={cn("shrink-0", isCollapsed ? "px-1" : "px-2")}>
          {isCollapsed ? (
            /* Collapsed: Show all settings icons for quick navigation */
            <div className="grid gap-1">
              {settingsNavLinks.map((link) => {
                const isActive = isNavLinkActive(link.href)
                return (
                  <NavLink
                    key={link.text}
                    to={link.href}
                    className={cn(
                      "flex h-8 w-full items-center justify-center rounded-md transition-all duration-200",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                    title={link.text}
                    aria-label={link.text}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className={link.icon}></span>
                  </NavLink>
                )
              })}
            </div>
          ) : (
            /* Expanded: Show full settings menu */
            <>
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
                <span className="truncate">Settings</span>
              </button>

              {settingsExpanded && (
                <div className="mt-1 grid gap-0.5 text-sm">
                  {settingsNavLinks.map(renderNavLink)}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sessions Section - shows sessions list, scrollable to bottom */}
        {!isCollapsed && (
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto scrollbar-none">
            <ActiveAgentsSidebar />
          </div>
        )}

        {/* Sessions icon when collapsed - navigates to sessions page */}
        {isCollapsed && (
          <div className="mt-2 px-1">
            {(() => {
              const isSessionsActive = location.pathname === "/" || (!location.pathname.startsWith("/settings") && !location.pathname.startsWith("/onboarding") && !location.pathname.startsWith("/setup") && !location.pathname.startsWith("/panel"))
              return (
                <NavLink
                  to="/"
                  end
                  className={cn(
                    "flex h-8 w-full items-center justify-center rounded-md transition-all duration-200",
                    isSessionsActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                  title="Sessions"
                  aria-label="Sessions"
                  aria-current={isSessionsActive ? "page" : undefined}
                >
                  <span className="i-mingcute-chat-3-line"></span>
                </NavLink>
              )
            })()}
          </div>
        )}

        {/* Spacer to push footer down when collapsed */}
        {isCollapsed && <div className="flex-1" />}

        {/* Loading spinner at the bottom of the sidebar */}
        <div className="shrink-0">
          <div className={cn(
            "flex flex-col items-center pb-4 pt-2",
            isCollapsed ? "space-y-1" : "space-y-2"
          )}>
            <LoadingSpinner size={isCollapsed ? "sm" : "lg"} />
            {!isCollapsed && (
              <>
                <div>SpeakMCP</div>
                <div className="text-xs">{process.env.APP_VERSION}</div>
              </>
            )}
          </div>
        </div>

        {/* Resize handle - only visible when not collapsed */}
        {!isCollapsed && (
          <div
            className={cn(
              "absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors",
              "hover:bg-primary/20",
              isResizing && "bg-primary/30"
            )}
            onMouseDown={handleResizeStart}
            title="Drag to resize sidebar"
          />
        )}
      </div>

      {/* Main content area */}
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
