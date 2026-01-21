#!/usr/bin/env bun
/**
 * SpeakMCP CLI - Entry Point
 * Terminal UI client for SpeakMCP with embedded server
 */

import { parseArgs, showHelp, showVersion, loadConfig, isDebugEnabled, setDebugEnabled } from './config'
import { SpeakMcpClient } from './client'
import { App } from './app'
import crypto from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'

// Dynamic import for server (only when needed)
async function startEmbeddedServer(port: number, apiKey: string, debug: boolean): Promise<void> {
  const { startServer, ensureDataDirs, initDebugFlags } = await import('@speakmcp/server/lib')

  // Initialize debug flags
  initDebugFlags()

  // Ensure data directories exist
  ensureDataDirs()

  // Start the server
  const result = await startServer({
    port,
    bind: '127.0.0.1',
    apiKey,
    logLevel: debug ? 'info' : 'warn', // Verbose in debug mode
  })

  if (!result.running) {
    throw new Error(`Failed to start embedded server: ${result.error}`)
  }
}

async function waitForServer(url: string, apiKey: string, maxWaitMs = 5000): Promise<boolean> {
  const startTime = Date.now()
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`${url}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
      if (response.ok) return true
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

function getElectronAppConfigPath(): string {
  const platform = process.platform
  const home = homedir()
  const appId = 'app.speakmcp'

  switch (platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', appId, 'config.json')
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), appId, 'config.json')
    case 'linux':
    default:
      const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config')
      return join(xdgConfig, appId, 'config.json')
  }
}

function showConfigHint(): void {
  const electronConfigPath = getElectronAppConfigPath()
  const hasElectronConfig = existsSync(electronConfigPath)

  console.log('')
  console.log('💡 Tip: The CLI can share configuration with the SpeakMCP desktop app.')
  if (hasElectronConfig) {
    console.log('   ✓ Desktop app config found - API keys will be shared automatically')
  } else {
    console.log('   ✗ Desktop app not installed or not configured')
    console.log('   → Install the desktop app or set SPEAKMCP_API_KEY environment variable')
  }
  console.log('')
}

async function main(): Promise<void> {
  // Parse CLI arguments (skip first two: bun/node and script path)
  const args = parseArgs(process.argv.slice(2))

  // Handle help/version flags
  if (args.help) {
    showHelp()
    process.exit(0)
  }

  if (args.version) {
    showVersion()
    process.exit(0)
  }

  // Enable debug mode early if requested
  if (args.debug) {
    setDebugEnabled(true)
  }

  try {
    // Load configuration
    const config = await loadConfig(args)
    const debug = config.debug || false

    // Generate API key if embedded mode and no key provided
    let apiKey = config.apiKey
    if (config.embedded && !apiKey) {
      apiKey = crypto.randomBytes(16).toString('hex')
      config.apiKey = apiKey
      if (debug) {
        console.log('[debug] Generated API key for embedded server')
      }
    }

    // Start embedded server if needed
    if (config.embedded) {
      console.log('🚀 Starting SpeakMCP embedded server...')
      if (debug) {
        console.log(`[debug] Port: ${config.port || 3210}`)
        console.log(`[debug] API key: ${apiKey ? '***' : '(none)'}`)
      }

      await startEmbeddedServer(config.port || 3210, apiKey, debug)

      // Wait for server to be ready
      const isReady = await waitForServer(config.serverUrl, apiKey)
      if (!isReady) {
        console.error('❌ Server failed to start in time')
        console.error('')
        console.error('Troubleshooting:')
        console.error('  • Check if port', config.port || 3210, 'is already in use')
        console.error('  • Try a different port with --port <number>')
        console.error('  • Run with --debug for more information')
        process.exit(1)
      }
      console.log(`✅ Server running at ${config.serverUrl}`)

      // Server-only mode: just keep running
      if (config.serverOnly) {
        console.log('')
        console.log('📡 Server-only mode - API available at:')
        console.log(`   ${config.serverUrl}/v1/chat/completions`)
        console.log('')
        console.log('Press Ctrl+C to stop.')
        // Keep process alive
        await new Promise(() => {})
        return
      }
    } else {
      console.log('🔍 Connecting to SpeakMCP server at', config.serverUrl)
    }

    // Create API client
    const client = new SpeakMcpClient(config)

    // Verify server connectivity
    const isHealthy = await client.isHealthy()
    if (!isHealthy) {
      console.error('')
      console.error('❌ Cannot connect to SpeakMCP server at', config.serverUrl)
      console.error('')
      if (!config.embedded) {
        console.error('Troubleshooting:')
        console.error('  • Make sure the server is running')
        console.error('  • Check the URL is correct')
        console.error('  • Use embedded mode (default) to start a local server')
        console.error('')
        console.error('Examples:')
        console.error('  speakmcp                    # Start embedded server')
        console.error('  speakmcp --url http://...   # Connect to external server')
      }
      process.exit(1)
    }

    if (!config.embedded) {
      console.log('✅ Connected to', config.serverUrl)
    }

    // Check if API keys are configured
    if (debug) {
      showConfigHint()
    }

    // Start the TUI application
    const app = new App(client, config)
    await app.run()

  } catch (error) {
    console.error('')
    console.error('❌ Error:', error instanceof Error ? error.message : error)
    console.error('')

    // Provide helpful hints based on error type
    const errorMessage = error instanceof Error ? error.message : String(error)

    if (errorMessage.includes('Could not find SpeakMCP server')) {
      console.error('Hint: Use embedded mode (default) to start a local server:')
      console.error('  speakmcp')
      console.error('')
      console.error('Or start the server manually:')
      console.error('  speakmcp-server')
    } else if (errorMessage.includes('EADDRINUSE') || errorMessage.includes('address already in use')) {
      console.error('Hint: Port is already in use. Try a different port:')
      console.error('  speakmcp --port 3211')
    } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      console.error('Hint: Authentication failed. Check your API key:')
      console.error('  speakmcp --api-key <your-key>')
      console.error('')
      console.error('Or set the environment variable:')
      console.error('  export SPEAKMCP_API_KEY=<your-key>')
    }

    console.error('')
    console.error('Run with --debug for more information')
    process.exit(1)
  }
}

main()

