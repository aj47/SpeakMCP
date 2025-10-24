import { RouterProvider } from "react-router-dom"
import { router } from "./router"
import { lazy, Suspense } from "react"
import { Toaster } from "sonner"
import { ConversationProvider } from "./contexts/conversation-context"
import { ThemeProvider } from "./contexts/theme-context"
import { TTSAudioProvider } from "./contexts/tts-audio-context"

const Updater = lazy(() => import("./components/updater"))

function App(): JSX.Element {
  return (
    <ThemeProvider>
      <TTSAudioProvider>
        <ConversationProvider>
          <RouterProvider router={router}></RouterProvider>

          <Suspense>
            <Updater />
          </Suspense>

          <Toaster />
        </ConversationProvider>
      </TTSAudioProvider>
    </ThemeProvider>
  )
}

export default App
