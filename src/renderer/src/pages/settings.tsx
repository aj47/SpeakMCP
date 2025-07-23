import { cn } from "@renderer/lib/utils"
import { NavLink, Outlet, useLocation } from "react-router-dom"

export function Component() {
  const navLinks = [
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
  ]

  const location = useLocation()

  const activeNavLink = navLinks.find((item) => item.href === location.pathname)

  return (
    <div className="flex h-full">
      <div className="h-full w-36 shrink-0 liquid-glass-nav glass-border-r p-3 text-sm">
        <div className="grid gap-0.5">
          {navLinks.map((link) => {
            return (
              <NavLink
                key={link.href}
                to={link.href}
                role="button"
                draggable={false}
                className={cn(
                  "flex h-7 items-center gap-2 rounded-md px-2 font-medium transition-all duration-200",
                  location.pathname === link.href
                    ? "liquid-glass-button text-foreground"
                    : "hover:liquid-glass-subtle text-muted-foreground hover:text-foreground",
                )}
              >
                {link.text}
              </NavLink>
            )
          })}
        </div>
      </div>
      <div className="h-full grow overflow-auto px-6 py-4 liquid-glass-panel">
        <header className="mb-5 liquid-glass-card glass-border rounded-lg p-4 glass-shadow">
          <h2 className="text-2xl font-bold">{activeNavLink?.text}</h2>
        </header>

        <Outlet />
      </div>
    </div>
  )
}
