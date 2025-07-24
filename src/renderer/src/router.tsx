import { createBrowserRouter } from "react-router-dom"

export const router: ReturnType<typeof createBrowserRouter> =
  createBrowserRouter([
    {
      path: "/",
      lazy: () => import("./components/app-layout"),
      children: [
        {
          path: "settings",
          lazy: () => import("./pages/settings"),
          children: [
            {
              path: "",
              lazy: () => import("./pages/settings-general"),
            },
            {
              path: "about",
              lazy: () => import("./pages/settings-about"),
            },
            {
              path: "providers",
              lazy: () => import("./pages/settings-providers"),
            },
            {
              path: "tools",
              lazy: () => import("./pages/settings-tools"),
            },
          ],
        },
        {
          path: "",
          lazy: () => import("./pages/settings-about"),
        },
        {
          path: "history",
          lazy: () => import("./pages/index"),
        },
        {
          path: "conversations",
          lazy: () => import("./pages/conversations"),
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
