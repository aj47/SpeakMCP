import { createClient, createEventHandlers } from "@egoist/tipc/renderer"
import type { Router } from "../../../main/tipc"
import type { RendererHandlers } from "../../../main/renderer-handlers"

const rawClient = createClient<Router>({
  // pass ipcRenderer.invoke function to the client
  // you can expose it from preload.js in BrowserWindow
  ipcInvoke: window.electron.ipcRenderer.invoke,
})

// Relax types so zero-input procedures can be called without args and results are usable in JSX
export const tipcClient = rawClient as any as {
  [K in keyof Router]: (input?: any) => Promise<any>
}

export const rendererHandlers = createEventHandlers<RendererHandlers>({
  on: window.electron.ipcRenderer.on,

  send: window.electron.ipcRenderer.send,
})
