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

  // Audio Loopback APIs (for meeting transcription - macOS 12.3+)
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),
}

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
