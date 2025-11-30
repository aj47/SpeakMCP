import { createBrowserRouter, redirect } from "react-router-dom"

export const router: ReturnType<typeof createBrowserRouter> =
  createBrowserRouter([
    {
      path: "/",
      lazy: () => import("./components/app-layout"),
      children: [
        {
          path: "",
          lazy: () => import("./pages/settings-general"),
        },
        {
          path: "history",
          lazy: () => import("./pages/history"),
        },
        {
          path: "history/:id",
          lazy: () => import("./pages/history"),
        },
        {
          path: "settings",
          lazy: () => import("./pages/settings-general"),
        },
        {
          path: "settings/providers",
          lazy: () => import("./pages/settings-providers-and-models"),
        },
        {
          path: "settings/models",
          lazy: () => import("./pages/settings-providers-and-models"),
        },
        {
          // Redirect old /settings/tools to /settings (agent settings are now in general settings)
          path: "settings/tools",
          loader: () => redirect("/settings"),
        },
        {
          path: "settings/mcp-tools",
          lazy: () => import("./pages/settings-mcp-tools"),
        },
        {
          path: "settings/remote-server",
          lazy: () => import("./pages/settings-remote-server"),
        },

      ],
    },
    {
      path: "/setup",
      lazy: () => import("./pages/setup"),
    },
    {
      path: "/panel",
      lazy: () => import("./pages/panel"),
    },
  ])
