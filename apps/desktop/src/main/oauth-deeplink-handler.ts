import { app } from "electron"
import { URL } from "url"

export interface OAuthCallbackResult {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

export class OAuthDeepLinkHandler {
  private resolveCallback: ((result: OAuthCallbackResult) => void) | null = null
  private rejectCallback: ((error: Error) => void) | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null
  private isListening = false
  private secondInstanceHandler: ((event: Electron.Event, commandLine: string[]) => void) | null = null

  async waitForCallback(timeoutMs: number = 300000): Promise<OAuthCallbackResult> {
    return new Promise((resolve, reject) => {
      this.resolveCallback = resolve
      this.rejectCallback = reject

      this.timeout = setTimeout(() => {
        this.cleanup()
        reject(new Error('OAuth callback timeout'))
      }, timeoutMs)

      this.startListening()
    })
  }

  private startListening(): void {
    if (this.isListening) {
      return
    }

    this.isListening = true

    app.on('open-url', this.handleDeepLink)

    if (process.platform === 'darwin') {
      app.on('will-finish-launching', () => {
        app.on('open-url', this.handleDeepLink)
      })
    }

    if (process.platform === 'win32' || process.platform === 'linux') {
      const args = process.argv
      for (const arg of args) {
        if (arg.startsWith('speakmcp://')) {
          this.handleDeepLink(null as any, arg)
          break
        }
      }

      this.secondInstanceHandler = (_event: Electron.Event, commandLine: string[]) => {
        for (const arg of commandLine) {
          if (arg.startsWith('speakmcp://')) {
            this.handleDeepLink(null as any, arg)
            break
          }
        }
      }
      app.on('second-instance', this.secondInstanceHandler)
    }
  }

  private handleDeepLink = (event: Electron.Event | null, url: string): void => {
    if (event) {
      event.preventDefault()
    }

    try {
      const parsedUrl = new URL(url)

      let fullPath = parsedUrl.pathname
      if (parsedUrl.hostname) {
        fullPath = `/${parsedUrl.hostname}${parsedUrl.pathname}`
      }
      const pathname = fullPath.replace(/^\/+/, '/')

      const isOAuthProtocol = parsedUrl.protocol.toLowerCase() === 'speakmcp:'
      const isOAuthPath = pathname === '/oauth/callback'

      if (isOAuthProtocol && isOAuthPath) {
        const code = parsedUrl.searchParams.get('code')
        const state = parsedUrl.searchParams.get('state')
        const error = parsedUrl.searchParams.get('error')
        const errorDescription = parsedUrl.searchParams.get('error_description')

        const result: OAuthCallbackResult = {
          code: code || undefined,
          state: state || undefined,
          error: error || undefined,
          error_description: errorDescription || undefined,
        }

        if (this.resolveCallback) {
          this.cleanup()
          this.resolveCallback(result)
        } else {
          this.handleAutomaticOAuthCompletion(result)
        }
      }
    } catch (error) {
      this.cleanup()

      if (this.rejectCallback) {
        this.rejectCallback(new Error(`Invalid deep link URL: ${url}`))
      }
    }
  }

  private async handleAutomaticOAuthCompletion(result: OAuthCallbackResult): Promise<void> {
    try {
      if (result.error || !result.code || !result.state) {
        return
      }

      // Import mcpService to complete the OAuth flow
      const { mcpService } = await import('./mcp-service')

      // We need to find which server this OAuth callback is for
      // We can do this by checking which server has a pending auth with matching state
      const serverName = await mcpService.findServerByOAuthState(result.state)

      if (!serverName) {
        return
      }

      await mcpService.completeOAuthFlow(serverName, result.code, result.state)
    } catch (error) {
      // Silently fail - the user can retry the OAuth flow if needed
    }
  }

  /**
   * Stop listening and clean up
   */
  stop(): void {
    this.cleanup()
  }

  /**
   * Check if currently listening for callbacks
   */
  isActive(): boolean {
    return this.isListening && this.resolveCallback !== null
  }

  /**
   * Clean up listeners and timers
   */
  private cleanup(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    if (this.isListening) {
      app.removeListener('open-url', this.handleDeepLink)
      if (this.secondInstanceHandler) {
        app.removeListener('second-instance', this.secondInstanceHandler)
        this.secondInstanceHandler = null
      }
      this.isListening = false
    }

    this.resolveCallback = null
    this.rejectCallback = null
  }
}

/**
 * Singleton deep link handler instance
 */
let deepLinkHandler: OAuthDeepLinkHandler | null = null

/**
 * Get or create the OAuth deep link handler
 */
export function getOAuthDeepLinkHandler(): OAuthDeepLinkHandler {
  if (!deepLinkHandler) {
    deepLinkHandler = new OAuthDeepLinkHandler()
  }
  return deepLinkHandler
}

/**
 * Handle OAuth callback with automatic deep link management
 */
export async function handleOAuthCallback(timeoutMs?: number): Promise<OAuthCallbackResult> {
  const handler = getOAuthDeepLinkHandler()

  try {
    return await handler.waitForCallback(timeoutMs)
  } finally {
    handler.stop()
    deepLinkHandler = null
  }
}

/**
 * Initialize deep link handling for the app
 * Should be called once during app initialization
 */
export function initializeDeepLinkHandling(): void {
  // Only register protocol handler in production builds
  // In development, deep links won't work but we'll provide fallback
  if (process.env.NODE_ENV === 'production' || !process.env.ELECTRON_RENDERER_URL) {
    try {
      if (!app.isDefaultProtocolClient('speakmcp')) {
        app.setAsDefaultProtocolClient('speakmcp')
      }
    } catch (error) {
      // Silently fail - protocol registration is not critical
    }
  }

  // Handle deep links when app is not running (Windows/Linux)
  if (process.platform === 'win32' || process.platform === 'linux') {
    // Only request single instance lock in production
    if (process.env.NODE_ENV === 'production' || !process.env.ELECTRON_RENDERER_URL) {
      try {
        const gotTheLock = app.requestSingleInstanceLock()

        if (!gotTheLock) {
          app.quit()
          return
        } else {
          app.on('second-instance', (_event, commandLine, _workingDirectory) => {
            // Someone tried to run a second instance, focus our window instead
            // and handle any deep link arguments

            // Focus the main window if it exists
            const { WINDOWS } = require('./window')
            const mainWindow = WINDOWS.get('main')
            if (mainWindow) {
              if (mainWindow.isMinimized()) mainWindow.restore()
              mainWindow.focus()
            }
          })
        }
      } catch (error) {
        // Silently fail - single instance lock is not critical
      }
    }
  }


}
