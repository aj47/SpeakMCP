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

        console.log('🔗 OAuth deeplink callback received:')
        console.log('  🌐 Full callback URL:', url)
        console.log('  🎯 Protocol:', parsedUrl.protocol)
        console.log('  📍 Path:', parsedUrl.pathname)
        console.log('  📋 Query parameters:')
        console.log('    🔑 Code:', code)
        console.log('    🆔 State:', state)
        console.log('    ❌ Error:', error)
        console.log('    📖 Error description:', errorDescription)
        console.log('  🔍 Raw URL:', url)

        // If there's an active callback waiting, resolve it
        if (this.resolveCallback) {
          this.cleanup()
          this.resolveCallback(result)
        } else {
          // No active callback waiting - this means the OAuth flow was initiated
          // but not through completeAuthorizationFlow. We need to handle it automatically.
          console.log('🔄 No active OAuth callback listener - attempting automatic completion...')
          this.handleAutomaticOAuthCompletion(result)
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
   * Handle OAuth callback when no active listener is waiting
   */
  private async handleAutomaticOAuthCompletion(result: OAuthCallbackResult): Promise<void> {
    try {
      if (result.error) {
        console.error('❌ OAuth callback contains error:', result.error, result.error_description)
        return
      }

      if (!result.code || !result.state) {
        console.error('❌ OAuth callback missing required parameters')
        return
      }

      // Import mcpService to complete the OAuth flow
      const { mcpService } = await import('./mcp-service')

      // We need to find which server this OAuth callback is for
      // We can do this by checking which server has a pending auth with matching state
      const serverName = await mcpService.findServerByOAuthState(result.state)

      if (!serverName) {
        console.error('❌ No server found with matching OAuth state:', result.state)
        return
      }

      console.log(`🔄 Completing OAuth flow for server: ${serverName}`)
      const completionResult = await mcpService.completeOAuthFlow(serverName, result.code, result.state)

      if (completionResult.success) {
        console.log('✅ OAuth flow completed successfully for server:', serverName)

        // Notify the UI that OAuth was completed
        const { WINDOWS } = await import('./window')

        const mainWindow = WINDOWS.get('main')
        if (mainWindow) {
          // You could add a custom handler to refresh OAuth status in the UI
          // For now, we'll just log success
          console.log('📢 OAuth completion notification sent to UI')
        }
      } else {
        console.error('❌ OAuth flow completion failed:', completionResult.error)
      }
    } catch (error) {
      console.error('❌ Failed to handle automatic OAuth completion:', error)
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
        const success = app.setAsDefaultProtocolClient('speakmcp')
        if (success) {
          console.log('✅ Registered speakmcp:// protocol handler')
        } else {
          console.warn('⚠️ Failed to register speakmcp:// protocol handler')
        }
      } else {
        console.log('✅ speakmcp:// protocol handler already registered')
      }
    } catch (error) {
      console.warn('⚠️ Could not register protocol handler:', error)
    }
  } else {
    console.log('🔧 Development mode: skipping protocol registration (deep links will use localhost fallback)')
  }

  // Handle deep links when app is not running (Windows/Linux)
  if (process.platform === 'win32' || process.platform === 'linux') {
    // Only request single instance lock in production
    if (process.env.NODE_ENV === 'production' || !process.env.ELECTRON_RENDERER_URL) {
      try {
        const gotTheLock = app.requestSingleInstanceLock()

        if (!gotTheLock) {
          console.log('Another instance is already running, quitting...')
          app.quit()
          return
        } else {
          app.on('second-instance', (_event, commandLine, _workingDirectory) => {
            // Someone tried to run a second instance, focus our window instead
            // and handle any deep link arguments
            console.log('Second instance launched with args:', commandLine)

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
        console.warn('⚠️ Could not request single instance lock:', error)
      }
    }
  }

  console.log('🔗 Deep link handling initialized')
}
