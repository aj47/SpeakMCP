import { ElectronAPI } from "@electron-toolkit/preload"

interface ScreenSource {
  id: string
  name: string
  thumbnail: string  // Data URL
  display_id: string
  appIcon: string | null  // Data URL or null
}

declare global {
  interface Window {
    electron: ElectronAPI
    electronAPI: {
      initiateOAuthFlow: (serverName: string) => Promise<{ authorizationUrl: string; state: string }>
      completeOAuthFlow: (serverName: string, code: string, state: string) => Promise<{ success: boolean; error?: string }>
      getOAuthStatus: (serverName: string) => Promise<{ configured: boolean; authenticated: boolean; tokenExpiry?: number; error?: string }>
      revokeOAuthTokens: (serverName: string) => Promise<{ success: boolean; error?: string }>
      testMCPServer: (serverName: string, config: any) => Promise<{ success: boolean; error?: string }>
      getScreenSources: (options: { types: string[], thumbnailSize?: { width: number, height: number } }) => Promise<ScreenSource[]>
    }
  }
}
