import { contextBridge, ipcRenderer } from "electron"
import { electronAPI } from "@electron-toolkit/preload"

// Custom APIs for renderer
const api = {
  // OAuth APIs
  initiateOAuthFlow: (serverName: string) => ipcRenderer.invoke('initiateOAuthFlow', serverName),
  completeOAuthFlow: (serverName: string, code: string, state: string) =>
    ipcRenderer.invoke('completeOAuthFlow', { serverName, code, state }),
  getOAuthStatus: (serverName: string) => ipcRenderer.invoke('getOAuthStatus', serverName),
  revokeOAuthTokens: (serverName: string) => ipcRenderer.invoke('revokeOAuthTokens', serverName),
  testMCPServer: (serverName: string, config: any) => ipcRenderer.invoke('testMCPServer', { serverName, config }),
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld("electronAPI", api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.electronAPI = api
}
