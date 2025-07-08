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
              path: "data",
              lazy: () => import("./pages/settings-data"),
            },
          ],
        },
        {
          path: "",
          lazy: () => import("./pages/index"),
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
