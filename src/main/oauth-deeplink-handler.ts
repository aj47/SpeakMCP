/**
 * OAuth Deep Link Handler for Electron
 * 
 * Handles OAuth callbacks via custom URL scheme (speakmcp://)
 * instead of localhost HTTP server for better native app experience.
 */

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
  private timeout: NodeJS.Timeout | null = null
  private isListening = false
  private secondInstanceHandler: ((event: Electron.Event, commandLine: string[]) => void) | null = null

  /**
   * Wait for OAuth callback via deep link
   */
  async waitForCallback(timeoutMs: number = 300000): Promise<OAuthCallbackResult> {
    return new Promise((resolve, reject) => {
      this.resolveCallback = resolve
      this.rejectCallback = reject

      // Set up timeout
      this.timeout = setTimeout(() => {
        this.cleanup()
        reject(new Error('OAuth callback timeout'))
      }, timeoutMs)

      // Start listening for deep link events
      this.startListening()
    })
  }

  /**
   * Start listening for deep link events
   */
  private startListening(): void {
    if (this.isListening) {
      return
    }

    this.isListening = true

    // Handle deep link when app is already running
    app.on('open-url', this.handleDeepLink)

    // Handle deep link when app is launched by the URL (macOS)
    if (process.platform === 'darwin') {
      app.on('will-finish-launching', () => {
        app.on('open-url', this.handleDeepLink)
      })
    }

    // Handle deep link on Windows/Linux via command line arguments
    if (process.platform === 'win32' || process.platform === 'linux') {
      // Check if app was launched with a deep link
      const args = process.argv
      for (const arg of args) {
        if (arg.startsWith('speakmcp://')) {
          this.handleDeepLink(null as any, arg)
          break
        }
      }

      // Listen for second instance (when app is already running)
      this.secondInstanceHandler = (event: Electron.Event, commandLine: string[]) => {
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

  /**
   * Handle deep link URL
   */
  private handleDeepLink = (event: Electron.Event | null, url: string): void => {
    if (event) {
      event.preventDefault()
    }

    console.log('Received deep link:', url)

    try {
      const parsedUrl = new URL(url)
      
      // Check if this is an OAuth callback
      if (parsedUrl.protocol === 'speakmcp:' && parsedUrl.pathname === '/oauth/callback') {
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

        console.log('OAuth callback received:', { 
          hasCode: !!code, 
          hasState: !!state, 
          hasError: !!error 
        })

        this.cleanup()
        
        if (this.resolveCallback) {
          this.resolveCallback(result)
        }
      }
    } catch (error) {
      console.error('Failed to parse deep link URL:', error)
      this.cleanup()
      
      if (this.rejectCallback) {
        this.rejectCallback(new Error(`Invalid deep link URL: ${url}`))
      }
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
  // Ensure app is set as default protocol handler
  if (!app.isDefaultProtocolClient('speakmcp')) {
    app.setAsDefaultProtocolClient('speakmcp')
  }

  // Handle deep links when app is not running (Windows/Linux)
  if (process.platform === 'win32' || process.platform === 'linux') {
    // Make sure only one instance of the app runs
    const gotTheLock = app.requestSingleInstanceLock()

    if (!gotTheLock) {
      app.quit()
    } else {
      app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, focus our window instead
        // and handle any deep link arguments
        console.log('Second instance launched with args:', commandLine)
      })
    }
  }

  console.log('Deep link handling initialized for speakmcp:// protocol')
}
