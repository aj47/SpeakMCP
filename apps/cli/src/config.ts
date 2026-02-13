/**
 * Configuration management for SpeakMCP CLI
 * Priority: CLI flags > env vars > config file > auto-discovery
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import type { CliConfig } from './types'

const DEFAULT_PORTS = [3210, 3211, 3212, 8080]
const CONFIG_DIR = join(homedir(), '.speakmcp')
const CONFIG_FILE = join(CONFIG_DIR, 'cli.json')

export interface CliArgs {
  url?: string
  apiKey?: string
  conversationId?: string
  port?: number
  noServer?: boolean
  debug?: boolean
  help?: boolean
  version?: boolean
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {}
  
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
        if (nextArg && !nextArg.startsWith('-')) {
          const port = parseInt(nextArg, 10)
          if (!isNaN(port) && port > 0 && port < 65536) {
            result.port = port
          }
          i++
        }
        break
      case '--no-server':
        result.noServer = true
        break
      case '--debug':
        result.debug = true
        break
    }
  }
  
  return result
}

export function showHelp(): void {
  console.log(`
SpeakMCP CLI - Terminal UI for SpeakMCP

Usage: speakmcp [options]

By default, starts an embedded server automatically. Use --url to connect
to an external server instead.

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  -u, --url <url>         Server URL (skips embedded server)
  -k, --api-key <key>     API key for authentication
  -c, --conversation <id> Resume specific conversation
  -p, --port <port>       Port for embedded server (default: 3211)
  --no-server             Don't start embedded server, only connect to external
  --debug                 Enable debug logging

Environment Variables:
  SPEAKMCP_URL            Server URL (skips embedded server)
  SPEAKMCP_API_KEY        API key for authentication
  SPEAKMCP_CONVERSATION   Default conversation ID

Examples:
  speakmcp                                          # Start with embedded server
  speakmcp --port 8080                              # Embedded server on port 8080
  speakmcp --url http://localhost:3210 --api-key k  # Connect to external server
  speakmcp --no-server                              # Only auto-discover, no embedded
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

export async function autoDiscoverServer(): Promise<string | null> {
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

  // Resolve server URL (priority: CLI > env > file)
  // Note: auto-discover is NOT done here — caller handles it with fallback logic
  const serverUrl = cliArgs.url || envUrl || fileConfig.serverUrl || ''

  // Resolve API key (priority: CLI > env > file)
  const apiKey = cliArgs.apiKey || envApiKey || fileConfig.apiKey || ''

  return {
    serverUrl,
    apiKey,
    conversationId: cliArgs.conversationId || envConversation || fileConfig.conversationId,
    theme: fileConfig.theme || 'dark'
  }
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

export function saveConfig(config: Partial<CliConfig>): void {
  ensureConfigDir()
  
  // Merge with existing config to preserve fields not in the partial
  const existing = loadConfigFile()
  const merged = { ...existing, ...config }
  
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2))
}

export function exportConfig(): string {
  const config = loadConfigFile()
  return JSON.stringify(config, null, 2)
}

export function getConfigPath(): string {
  return CONFIG_FILE
}

export function deleteConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE)
  }
}

