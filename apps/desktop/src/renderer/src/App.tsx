import { RouterProvider } from "react-router-dom"
import { router } from "./router"
import { lazy, Suspense } from "react"
import { Toaster } from "sonner"
import { ThemeProvider } from "./contexts/theme-context"
import { useStoreSync } from "./hooks/use-store-sync"

const Updater = lazy(() => import("./components/updater"))
const McpElicitationDialog = lazy(() => import("./components/mcp-elicitation-dialog"))
const McpSamplingDialog = lazy(() => import("./components/mcp-sampling-dialog"))

function StoreInitializer({ children }: { children: React.ReactNode }) {
  useStoreSync()
  return <>{children}</>
}

function App(): JSX.Element {
  return (
    <ThemeProvider>
      <StoreInitializer>
        <RouterProvider router={router}></RouterProvider>

        <Suspense>
          <Updater />
        </Suspense>

        {/* MCP Protocol 2025-11-25 dialogs for elicitation and sampling */}
        <Suspense>
          <McpElicitationDialog />
          <McpSamplingDialog />
        </Suspense>

        <Toaster />
      </StoreInitializer>
    </ThemeProvider>
  )
}

export default App
