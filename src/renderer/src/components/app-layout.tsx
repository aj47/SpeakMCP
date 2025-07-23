import { rendererHandlers } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"

type NavLink = {
  text: string
  href: string
  icon: string
  subItems?: Array<{
    text: string
    href: string
  }>
}

export const Component = () => {
  const navigate = useNavigate()
  const location = useLocation()

  const navLinks: NavLink[] = [
    {
      text: "History",
      href: "/",
      icon: "i-mingcute-history-anticlockwise-line",
    },
    {
      text: "Settings",
      href: "/settings",
      icon: "i-mingcute-settings-3-line",
      subItems: [
        {
          text: "General",
          href: "/settings",
        },
        {
          text: "Providers",
          href: "/settings/providers",
        },
        {
          text: "Tools",
          href: "/settings/tools",
        },
        {
          text: "Data",
          href: "/settings/data",
        },
        {
          text: "About",
          href: "/settings/about",
        },
      ],
    },
  ]

  useEffect(() => {
    return rendererHandlers.navigate.listen((url) => {
      navigate(url)
    })
  }, [])

  return (
    <div className="flex h-dvh">
      <div className="app-drag-region flex w-44 shrink-0 flex-col liquid-glass-nav glass-border-r glass-shine">
        <header
          className={process.env.IS_MAC ? "h-10" : "h-2"}
          aria-hidden
        ></header>

        <div className="grid gap-0.5 px-2 text-sm">
          {navLinks.map((link) => {
            const isSettingsSection = location.pathname.startsWith('/settings')
            const showSubItems = link.subItems && isSettingsSection

            return (
              <div key={link.text}>
                <NavLink
                  to={link.href}
                  role="button"
                  draggable={false}
                  className={({ isActive }) =>
                    cn(
                      "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-all duration-200",
                      isActive || (link.href === "/settings" && isSettingsSection)
                        ? "liquid-glass-button text-foreground"
                        : "hover:liquid-glass-subtle text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  <span className={link.icon}></span>
                  <span className="font-medium">{link.text}</span>
                </NavLink>

                {showSubItems && (
                  <div className="ml-6 mt-1 grid gap-0.5">
                    {link.subItems.map((subItem) => (
                      <NavLink
                        key={subItem.href}
                        to={subItem.href}
                        role="button"
                        draggable={false}
                        className={cn(
                          "flex h-6 items-center gap-2 rounded-md px-2 text-xs font-medium transition-all duration-200",
                          location.pathname === subItem.href
                            ? "liquid-glass-button text-foreground"
                            : "hover:liquid-glass-subtle text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {subItem.text}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex grow flex-col overflow-auto liquid-glass-panel glass-blur-medium">
        <Outlet />
      </div>
    </div>
  )
}
