import { cn } from "@renderer/lib/utils"
import { NavLink, Outlet, useLocation } from "react-router-dom"

export function Component() {
  const navLinks = [
    {
      text: "General",
      href: "/settings",
    },
    {
      text: "Data",
      href: "/settings/data",
    },
    {
      text: "About",
      href: "/settings/about",
    },
  ]

  const location = useLocation()

  const activeNavLink = navLinks.find((item) => item.href === location.pathname)

  return (
    <div className="flex h-full">
      <div className="h-full w-36 shrink-0 border-r p-3 text-sm">
        <div className="grid gap-0.5">
          {navLinks.map((link) => {
            return (
              <NavLink
                key={link.href}
                to={link.href}
                role="button"
                draggable={false}
                className={cn(
                  "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-colors",
                  location.pathname === link.href
                    ? "bg-neutral-100 dark:bg-neutral-800 dark:text-white"
                    : "hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800",
                )}
              >
                {link.text}
              </NavLink>
            )
          })}
        </div>
      </div>
      <div className="h-full grow overflow-auto px-6 py-4">
        <header className="mb-5">
          <h2 className="text-2xl font-bold">{activeNavLink?.text}</h2>
        </header>

        <Outlet />
      </div>
    </div>
  )
}
