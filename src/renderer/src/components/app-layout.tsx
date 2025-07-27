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
      text: "About",
      href: "/",
      icon: "i-mingcute-information-line",
    },
    {
      text: "Conversations",
      href: "/conversations",
      icon: "i-mingcute-message-3-line",
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
      <div className="app-drag-region flex w-44 shrink-0 flex-col bg-background border-r">
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
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
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
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
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
      <div className="flex grow flex-col overflow-auto bg-background">
        <Outlet />
      </div>
    </div>
  )
}
