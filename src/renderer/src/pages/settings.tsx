import { useLocation } from "react-router-dom"
import { Outlet } from "react-router-dom"

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
    <div className="h-full overflow-auto px-6 py-4 liquid-glass-panel">
      <header className="mb-5 liquid-glass-card glass-border rounded-lg p-4 glass-shadow">
        <h2 className="text-2xl font-bold">{activeNavLink?.text}</h2>
      </header>

      <Outlet />
    </div>
  )
}
