/**
 * Configuration management for SpeakMCP CLI
 * Priority: CLI flags > env vars > config file > auto-discovery
 */

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { CliConfig } from './types'

const DEFAULT_PORTS = [3210, 3211, 3212, 8080]
const CONFIG_DIR = join(homedir(), '.speakmcp')
const CONFIG_FILE = join(CONFIG_DIR, 'cli.json')

interface CliArgs {
  url?: string
  apiKey?: string
  conversationId?: string
  help?: boolean
  version?: boolean
  embedded?: boolean
  serverOnly?: boolean
  port?: number
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
    }
  }

  return result
}

export function showHelp(): void {
  console.log(`
SpeakMCP - AI Agent with MCP Tools

Usage: speakmcp [options]

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  -p, --port <port>       Port for embedded server (default: 3210)
  -k, --api-key <key>     API key for authentication
  -c, --conversation <id> Resume specific conversation
  -u, --url <url>         Connect to external server (disables embedded mode)
  --no-embedded           Don't start embedded server, connect to existing
  --server-only           Only start the server, no TUI

Environment Variables:
  SPEAKMCP_URL            Server URL (disables embedded mode)
  SPEAKMCP_API_KEY        API key for authentication
  SPEAKMCP_PORT           Port for embedded server
  SPEAKMCP_CONVERSATION   Default conversation ID

Examples:
  speakmcp                              # Start server + TUI (default)
  speakmcp --port 8080                  # Use custom port
  speakmcp --server-only                # Server only, no TUI
  speakmcp --url http://localhost:3210  # Connect to existing server
`)
}

export function showVersion(): void {
  console.log('speakmcp v1.0.0')
}

function loadConfigFile(): Partial<CliConfig> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch {
    // Ignore config file errors
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

export async function loadConfig(cliArgs: CliArgs): Promise<CliConfig> {
  const fileConfig = loadConfigFile()

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
      const discovered = await autoDiscoverServer()
      if (!discovered) {
        throw new Error(
          'Could not find SpeakMCP server. Please start the server or specify --url'
        )
      }
      serverUrl = discovered
    }
  }

  // Resolve API key (priority: CLI > env > file)
  const apiKey = cliArgs.apiKey || envApiKey || fileConfig.apiKey || ''

  return {
    serverUrl,
    apiKey,
    conversationId: cliArgs.conversationId || envConversation || fileConfig.conversationId,
    theme: fileConfig.theme || 'dark',
    embedded,
    serverOnly: cliArgs.serverOnly,
    port
  }
}

