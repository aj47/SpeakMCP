import { RouterProvider } from "react-router-dom"
import { router } from "./router"
import { lazy, Suspense } from "react"
import { Toaster } from "sonner"
import { ConversationProvider } from "./contexts/conversation-context"

const Updater = lazy(() => import("./components/updater"))

function App(): JSX.Element {
  return (
    <ConversationProvider>
      <RouterProvider router={router}></RouterProvider>

      <Suspense>
        <Updater />
      </Suspense>

      <Toaster />
    </ConversationProvider>
  )
}

export default App
