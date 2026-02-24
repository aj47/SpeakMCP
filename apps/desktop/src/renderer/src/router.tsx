import { createBrowserRouter, redirect } from "react-router-dom"

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
          path: "settings/capabilities",
          lazy: () => import("./pages/settings-capabilities"),
        },
        {
          path: "settings/mcp-tools",
          loader: () => redirect("/settings/capabilities"),
        },
        {
          path: "settings/skills",
          loader: () => redirect("/settings/capabilities"),
        },
        {
          path: "settings/remote-server",
          lazy: () => import("./pages/settings-remote-server"),
        },
        {
          path: "settings/whatsapp",
          lazy: () => import("./pages/settings-whatsapp"),
        },
        {
          path: "settings/agents",
          lazy: () => import("./pages/settings-agents"),
        },
        {
          path: "settings/loops",
          lazy: () => import("./pages/settings-loops"),
        },
        {
          path: "settings/agent-personas",
          loader: () => redirect("/settings/agents"),
        },
        {
          path: "settings/external-agents",
          loader: () => redirect("/settings/agents"),
        },
        {
          path: "settings/agent-profiles",
          loader: () => redirect("/settings/agents"),
        },
        {
          path: "settings/langfuse",
          loader: () => redirect("/settings"),
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
  ], {
    future: {
	      // React Router future flags are version-dependent. Keep this enabled when
	      // supported, but don't fail typechecking on versions that don't include it.
	      v7_startTransition: true,
	    } as any,
  })
