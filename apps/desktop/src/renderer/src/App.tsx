import { RouterProvider } from "react-router-dom"
import { router } from "./router"
import { lazy, Suspense } from "react"
import { Toaster } from "sonner"
import { ThemeProvider } from "./contexts/theme-context"
import { useStoreSync } from "./hooks/use-store-sync"
import { ErrorBoundary } from "./components/error-boundary"

const Updater = lazy(() => import("./components/updater"))
const McpElicitationDialog = lazy(() => import("./components/mcp-elicitation-dialog"))
const McpSamplingDialog = lazy(() => import("./components/mcp-sampling-dialog"))

function StoreInitializer({ children }: { children: React.ReactNode }) {
  useStoreSync()
  return <>{children}</>
}

function App(): JSX.Element {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // Log errors for debugging - in production, send to error tracking service
        if (import.meta.env.DEV) {
          console.error("[App ErrorBoundary]", error, errorInfo.componentStack)
        }
      }}
    >
      <ThemeProvider>
        <StoreInitializer>
          <ErrorBoundary>
            <RouterProvider router={router}></RouterProvider>
          </ErrorBoundary>

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
    </ErrorBoundary>
  )
}

export default App
