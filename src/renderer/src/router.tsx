import { createBrowserRouter } from "react-router-dom"

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
          path: "conversations",
          lazy: () => import("./pages/conversations"),
        },
        {
          path: "conversations/:id",
          lazy: () => import("./pages/conversations"),
        },
        {
          path: "settings",
          lazy: () => import("./pages/settings-general"),
        },
        {
          path: "settings/providers",
          lazy: () => import("./pages/settings-providers"),
        },
        {
          path: "settings/models",
          lazy: () => import("./pages/settings-models"),
        },
        {
          path: "settings/tools",
          lazy: () => import("./pages/settings-tools"),
        },
        {
          path: "settings/mcp-tools",
          lazy: () => import("./pages/settings-mcp-tools"),
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
