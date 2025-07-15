import { rendererHandlers } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useEffect } from "react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"

export const Component = () => {
  const navigate = useNavigate()
  const navLinks = [
    {
      text: "History",
      href: "/",
      icon: "i-mingcute-history-anticlockwise-line",
    },
    {
      text: "Settings",
      href: "/settings",
      icon: "i-mingcute-settings-3-line",
    },
  ]

  useEffect(() => {
    return rendererHandlers.navigate.listen((url) => {
      navigate(url)
    })
  }, [])

  return (
    <div className="flex h-dvh">
      <div className="app-drag-region flex w-44 shrink-0 flex-col border-r">
        <header
          className={process.env.IS_MAC ? "h-10" : "h-2"}
          aria-hidden
        ></header>

        <div className="grid gap-0.5 px-2 text-sm">
          {navLinks.map((link) => {
            return (
              <NavLink
                key={link.text}
                to={link.href}
                role="button"
                draggable={false}
                className={({ isActive }) =>
                  cn(
                    "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-colors",
                    isActive
                      ? "bg-neutral-100 dark:bg-neutral-800 dark:text-white"
                      : "hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800",
                  )
                }
              >
                <span className={link.icon}></span>
                <span className="font-medium">{link.text}</span>
              </NavLink>
            )
          })}
        </div>
      </div>
      <div className="flex grow flex-col overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
