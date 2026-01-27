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
    }
  }
  
  return result
}

export function showHelp(): void {
  console.log(`
SpeakMCP CLI - Terminal UI for SpeakMCP

Usage: speakmcp [options]

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  -u, --url <url>         Server URL (default: auto-discover)
  -k, --api-key <key>     API key for authentication
  -c, --conversation <id> Resume specific conversation

Environment Variables:
  SPEAKMCP_URL            Server URL
  SPEAKMCP_API_KEY        API key for authentication
  SPEAKMCP_CONVERSATION   Default conversation ID

Examples:
  speakmcp
  speakmcp --url http://localhost:3210 --api-key mykey
  SPEAKMCP_API_KEY=mykey speakmcp
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
  
  // Resolve server URL (priority: CLI > env > file > auto-discover)
  let serverUrl: string | undefined = cliArgs.url || envUrl || fileConfig.serverUrl

  if (!serverUrl) {
    const discovered = await autoDiscoverServer()
    if (!discovered) {
      throw new Error(
        'Could not find SpeakMCP server. Please start the server or specify --url'
      )
    }
    serverUrl = discovered
  }
  
  // Resolve API key (priority: CLI > env > file)
  const apiKey = cliArgs.apiKey || envApiKey || fileConfig.apiKey || ''
  
  return {
    serverUrl,
    apiKey,
    conversationId: cliArgs.conversationId || envConversation || fileConfig.conversationId,
    theme: fileConfig.theme || 'dark'
  }
}

