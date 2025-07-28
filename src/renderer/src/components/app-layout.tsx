import { rendererHandlers } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"

type NavLink = {
  text: string
  href: string
  icon: string
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
    },
    {
      text: "Providers",
      href: "/settings/providers",
      icon: "i-mingcute-plugin-2-line",
    },
    {
      text: "Agents",
      href: "/settings/tools",
      icon: "i-mingcute-android-2-line",
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
          {navLinks.map((link) => (
            <NavLink
              key={link.text}
              to={link.href}
              role="button"
              draggable={false}
              className={({ isActive }) =>
                cn(
                  "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-all duration-200",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )
              }
            >
              <span className={link.icon}></span>
              <span className="font-medium">{link.text}</span>
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex grow flex-col overflow-auto bg-background">
        <Outlet />
      </div>
    </div>
  )
}
