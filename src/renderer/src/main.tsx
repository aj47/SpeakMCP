import "./css/tailwind.css"
import "./css/spinner.css"
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { tipcClient } from "./lib/tipc-client"
import { QueryClientProvider } from "@tanstack/react-query"
import { queryClient } from "./lib/query-client"



ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)

document.addEventListener("contextmenu", (e) => {
  // Check if the context menu event was already handled by a specific component
  if (e.defaultPrevented) {
    return
  }

  e.preventDefault()

  const selectedText = window.getSelection()?.toString()

  tipcClient.showContextMenu({
    x: e.clientX,
    y: e.clientY,
    selectedText,
  })
})
