import { createBrowserRouter } from "react-router-dom"

export const router: ReturnType<typeof createBrowserRouter> =
  createBrowserRouter([
    {
      path: "/",
      lazy: () => import("./components/app-layout"),
      children: [
        {
          path: "",
          lazy: () => import("./pages/sessions"),
        },
        {
          path: "sessions",
          lazy: () => import("./pages/sessions"),
        },
        {
          path: "settings-general",
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
          path: "settings/tools",
          lazy: () => import("./pages/settings-tools"),
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
