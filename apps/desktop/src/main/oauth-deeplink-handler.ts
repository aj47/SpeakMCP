import { app } from "electron"
import { URL } from "url"

export interface OAuthCallbackResult {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

/**
 * Queue to store deep link URLs that arrive before OAuth flow is started.
 * This is critical for macOS where open-url events can arrive before the app is ready.
 */
let pendingDeepLinkUrls: string[] = []

/**
 * Flag to track if early open-url handler has been registered.
 * This must happen before app.whenReady() on macOS.
 */
let earlyHandlerRegistered = false

/**
 * Reference to the active deep link handler instance for processing queued URLs
 */
let activeHandler: OAuthDeepLinkHandler | null = null

/**
 * Early open-url handler that queues URLs before OAuth flow is started.
 * This handler is registered at module load time (before app.whenReady()).
 */
function earlyOpenUrlHandler(event: Electron.Event, url: string): void {
  event.preventDefault()

  // If there's an active handler waiting for callbacks, let it handle directly
  if (activeHandler && activeHandler.isActive()) {
    activeHandler.processDeepLink(url)
  } else {
    // Queue the URL for later processing
    pendingDeepLinkUrls.push(url)
  }
}

/**
 * Register early open-url handler for macOS.
 * This MUST be called before app.whenReady() to catch deep links
 * that arrive when the app is launched via protocol handler.
 */
function registerEarlyOpenUrlHandler(): void {
  if (earlyHandlerRegistered) {
    return
  }

  earlyHandlerRegistered = true

  // On macOS, register open-url handler immediately at module load time
  // This ensures we catch deep links even when the app is cold-started via protocol
  if (process.platform === 'darwin') {
    app.on('open-url', earlyOpenUrlHandler)
  }
}

// Register early handler at module load time (before app.whenReady())
registerEarlyOpenUrlHandler()

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

      // Process any queued deep link URLs that arrived before we started listening
      this.processQueuedUrls()
    })
  }

  /**
   * Process any deep link URLs that were queued before OAuth flow started
   */
  private processQueuedUrls(): void {
    const urls = [...pendingDeepLinkUrls]
    pendingDeepLinkUrls = []

    for (const url of urls) {
      this.processDeepLink(url)
    }
  }

  /**
   * Process a deep link URL (public method for early handler to use)
   */
  processDeepLink(url: string): void {
    this.handleDeepLink(null, url)
  }

  private startListening(): void {
    if (this.isListening) {
      return
    }

    this.isListening = true

    // Set this instance as the active handler for the early open-url handler
    activeHandler = this

    // For Windows/Linux, handle command line arguments and second-instance events
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
      // Clear the active handler reference so early handler queues URLs again
      if (activeHandler === this) {
        activeHandler = null
      }

      // Only remove second-instance handler (open-url is handled by early handler)
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
