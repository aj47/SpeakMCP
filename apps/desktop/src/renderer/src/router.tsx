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
          path: ":id",
          lazy: () => import("./pages/sessions"),
        },
        {
          path: "history",
          lazy: () => import("./pages/sessions"),
        },
        {
          path: "history/:id",
          lazy: () => import("./pages/sessions"),
        },
        {
          path: "settings",
          lazy: () => import("./pages/settings-general"),
        },
        {
          path: "settings/general",
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
        {
          path: "settings/skills",
          lazy: () => import("./pages/settings-skills"),
        },
        {
          path: "settings/whatsapp",
          lazy: () => import("./pages/settings-whatsapp"),
        },
        {
          path: "memories",
          lazy: () => import("./pages/memories"),
        },
      ],
    },
    {
      path: "/setup",
      lazy: () => import("./pages/setup"),
    },
    {
      path: "/onboarding",
      lazy: () => import("./pages/onboarding"),
    },
    {
      path: "/panel",
      lazy: () => import("./pages/panel"),
    },
  ])
