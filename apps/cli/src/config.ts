/**
 * Configuration management for SpeakMCP CLI
 * Priority: CLI flags > env vars > config file > Electron app config > auto-discovery
 */

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { CliConfig } from './types'

const DEFAULT_PORTS = [3210, 3211, 3212, 8080]

// CLI-specific config directory
const CLI_CONFIG_DIR = join(homedir(), '.speakmcp')
const CLI_CONFIG_FILE = join(CLI_CONFIG_DIR, 'cli.json')

// Electron app config paths - matches app.getPath('appData') + appId
function getElectronAppConfigPath(): string {
  const platform = process.platform
  const home = homedir()
  const appId = 'app.speakmcp' // Must match electron-builder.config.cjs appId

  switch (platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', appId, 'config.json')
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), appId, 'config.json')
    case 'linux':
    default:
      // Electron uses ~/.config on Linux
      const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config')
      return join(xdgConfig, appId, 'config.json')
  }
}

interface CliArgs {
  url?: string
  apiKey?: string
  conversationId?: string
  help?: boolean
  version?: boolean
  embedded?: boolean
  serverOnly?: boolean
  port?: number
  debug?: boolean
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = { embedded: true } // Default to embedded mode

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    switch (arg) {
      case '-h':
      case '--help':
        result.help = true
        break
      case '-v':
      case '--version':
        result.version = true
        break
      case '-u':
      case '--url':
        result.url = nextArg
        result.embedded = false // Explicit URL disables embedded mode
        i++
        break
      case '-k':
      case '--api-key':
        result.apiKey = nextArg
        i++
        break
      case '-c':
      case '--conversation':
        result.conversationId = nextArg
        i++
        break
      case '-p':
      case '--port':
        if (nextArg) {
          result.port = parseInt(nextArg, 10)
          i++
        }
        break
      case '--no-embedded':
        result.embedded = false
        break
      case '--server-only':
        result.serverOnly = true
        break
      case '-d':
      case '--debug':
        result.debug = true
        break
    }
  }

  return result
}

export function showHelp(): void {
  console.log(`
SpeakMCP CLI - AI Agent with MCP Tools

Usage: speakmcp [options]

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  -p, --port <port>       Port for embedded server (default: 3210)
  -k, --api-key <key>     API key for authentication
  -c, --conversation <id> Resume specific conversation
  -u, --url <url>         Connect to external server (disables embedded mode)
  -d, --debug             Enable debug output
  --no-embedded           Don't start embedded server, connect to existing
  --server-only           Only start the server, no TUI

Environment Variables:
  SPEAKMCP_URL            Server URL (disables embedded mode)
  SPEAKMCP_API_KEY        API key for authentication
  SPEAKMCP_PORT           Port for embedded server
  SPEAKMCP_CONVERSATION   Default conversation ID
  DEBUG                   Enable debug logging (set to "1" or "true")

Config Files (checked in order):
  ~/.speakmcp/cli.json         CLI-specific config
  <Electron App Data>/config.json  Shared config from SpeakMCP desktop app

Examples:
  speakmcp                              # Start embedded server + TUI
  speakmcp --port 8080                  # Use custom port
  speakmcp --server-only                # Server only, no TUI
  speakmcp --url http://localhost:3210  # Connect to existing server
  speakmcp --debug                      # Enable debug output

Note: The CLI automatically reads API keys and settings from the SpeakMCP
desktop app if installed. You can override any setting via CLI flags or
environment variables.
`)
}

export function showVersion(): void {
  console.log('speakmcp v1.0.0')
}

// Debug logging helper
let debugEnabled = false

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled
}

export function isDebugEnabled(): boolean {
  return debugEnabled || process.env.DEBUG === '1' || process.env.DEBUG === 'true'
}

function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.log('[debug]', ...args)
  }
}

/**
 * Load CLI-specific config file (~/.speakmcp/cli.json)
 */
function loadCliConfigFile(): Partial<CliConfig> {
  try {
    if (existsSync(CLI_CONFIG_FILE)) {
      debugLog('Found CLI config:', CLI_CONFIG_FILE)
      const content = readFileSync(CLI_CONFIG_FILE, 'utf-8')
      return JSON.parse(content)
    }
    debugLog('No CLI config file found at:', CLI_CONFIG_FILE)
  } catch (e) {
    debugLog('Error reading CLI config:', e)
  }
  return {}
}

/**
 * Load Electron app config (shared config from desktop app)
 * This extracts relevant fields from the desktop app's config
 */
function loadElectronAppConfig(): Partial<CliConfig> & { openaiApiKey?: string; groqApiKey?: string; geminiApiKey?: string } {
  const electronConfigPath = getElectronAppConfigPath()
  try {
    if (existsSync(electronConfigPath)) {
      debugLog('Found Electron app config:', electronConfigPath)
      const content = readFileSync(electronConfigPath, 'utf-8')
      const electronConfig = JSON.parse(content)

      // Extract relevant fields from the Electron app config
      return {
        // The Electron app stores API keys directly in config
        openaiApiKey: electronConfig.openaiApiKey,
        groqApiKey: electronConfig.groqApiKey,
        geminiApiKey: electronConfig.geminiApiKey,
        // Use the server API key from Electron config for authentication
        apiKey: electronConfig.remoteServerApiKey,
        // If remote server is configured in the desktop app, use it
        serverUrl: electronConfig.remoteServerEnabled
          ? `http://${electronConfig.remoteServerBindAddress || '127.0.0.1'}:${electronConfig.remoteServerPort || 3210}`
          : undefined,
      }
    }
    debugLog('No Electron app config found at:', electronConfigPath)
  } catch (e) {
    debugLog('Error reading Electron app config:', e)
  }
  return {}
}

async function probeServer(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)
    
    const response = await fetch(`${url}/v1/models`, {
      signal: controller.signal,
      headers: { 'Authorization': 'Bearer probe' }
    })
    
    clearTimeout(timeout)
    // 401 means server is there but needs auth - still valid
    return response.ok || response.status === 401
  } catch {
    return false
  }
}

async function autoDiscoverServer(): Promise<string | null> {
  for (const port of DEFAULT_PORTS) {
    const url = `http://127.0.0.1:${port}`
    if (await probeServer(url)) {
      return url
    }
  }
  return null
}

export async function loadConfig(cliArgs: CliArgs): Promise<CliConfig & { debug?: boolean }> {
  // Enable debug mode early if requested
  if (cliArgs.debug) {
    setDebugEnabled(true)
  }

  debugLog('Loading configuration...')
  debugLog('CLI args:', JSON.stringify(cliArgs, null, 2))

  // Load config files (CLI-specific first, then Electron app as fallback)
  const cliFileConfig = loadCliConfigFile()
  const electronConfig = loadElectronAppConfig()

  // Merge configs: CLI file overrides Electron app config
  const fileConfig = { ...electronConfig, ...cliFileConfig }
  debugLog('Merged file config:', JSON.stringify(fileConfig, null, 2))

  // Environment variables
  const envUrl = process.env.SPEAKMCP_URL
  const envApiKey = process.env.SPEAKMCP_API_KEY
  const envConversation = process.env.SPEAKMCP_CONVERSATION
  const envPort = process.env.SPEAKMCP_PORT ? parseInt(process.env.SPEAKMCP_PORT, 10) : undefined

  // Determine if we should use embedded mode
  // Embedded is disabled if: --no-embedded, --url provided, or SPEAKMCP_URL set
  const embedded = cliArgs.embedded !== false && !envUrl

  // Resolve port for embedded server
  const port = cliArgs.port || envPort || 3210

  // Resolve server URL
  let serverUrl: string | undefined

  if (embedded) {
    // In embedded mode, we'll start the server ourselves
    serverUrl = `http://127.0.0.1:${port}`
  } else {
    // In external mode, discover or use provided URL
    serverUrl = cliArgs.url || envUrl || fileConfig.serverUrl
    if (!serverUrl) {
      debugLog('Auto-discovering server...')
      const discovered = await autoDiscoverServer()
      if (!discovered) {
        throw new Error(
          'Could not find SpeakMCP server. Please start the server or specify --url'
        )
      }
      serverUrl = discovered
      debugLog('Discovered server at:', discovered)
    }
  }

  // Resolve API key (priority: CLI > env > file > Electron app)
  // Note: The server uses API keys from its own config which reads from the same Electron config
  const apiKey = cliArgs.apiKey || envApiKey || fileConfig.apiKey || ''

  // Report config source for debugging
  if (isDebugEnabled()) {
    if (cliArgs.apiKey) debugLog('API key source: CLI argument')
    else if (envApiKey) debugLog('API key source: environment variable')
    else if (fileConfig.apiKey) debugLog('API key source: config file')
    else debugLog('API key: not configured')

    // Report if using Electron app config
    const electronConfigPath = getElectronAppConfigPath()
    if (existsSync(electronConfigPath)) {
      debugLog('Electron app config available at:', electronConfigPath)
      if (electronConfig.openaiApiKey) debugLog('Found OpenAI API key in Electron config')
      if (electronConfig.groqApiKey) debugLog('Found Groq API key in Electron config')
      if (electronConfig.geminiApiKey) debugLog('Found Gemini API key in Electron config')
    }
  }

  const config = {
    serverUrl,
    apiKey,
    conversationId: cliArgs.conversationId || envConversation || fileConfig.conversationId,
    theme: fileConfig.theme || 'dark',
    embedded,
    serverOnly: cliArgs.serverOnly,
    port,
    debug: cliArgs.debug || isDebugEnabled(),
  }

  debugLog('Final config:', JSON.stringify({ ...config, apiKey: config.apiKey ? '***' : '' }, null, 2))

  return config
}

