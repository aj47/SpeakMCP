/**
 * SpeakMCP Server - Standalone CLI Entry Point
 * Run with: npx @speakmcp/server or speakmcp-server
 */

import { initDebugFlags, isDebugServer, logServer } from './services/debug'
import { startServer, stopServer, ServerOptions } from './server'
import { configStore, ensureDataDirs } from './config'

// Initialize debug flags from CLI args and environment
initDebugFlags()

// Parse command line arguments
function parseArgs(): ServerOptions & { help?: boolean; version?: boolean; configPath?: string } {
  const args = process.argv.slice(2)
  const options: ServerOptions & { help?: boolean; version?: boolean; configPath?: string } = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true
        break
      case '-v':
      case '--version':
        options.version = true
        break
      case '-p':
      case '--port':
        if (nextArg && !nextArg.startsWith('-')) {
          const port = parseInt(nextArg, 10)
          if (!isNaN(port) && port > 0 && port < 65536) {
            options.port = port
          }
          i++
        }
        break
      case '-b':
      case '--bind':
        if (nextArg && !nextArg.startsWith('-')) {
          options.bind = nextArg
          i++
        }
        break
      case '-k':
      case '--api-key':
        if (nextArg && !nextArg.startsWith('-')) {
          options.apiKey = nextArg
          i++
        }
        break
      case '-c':
      case '--config':
        if (nextArg && !nextArg.startsWith('-')) {
          options.configPath = nextArg
          i++
        }
        break
      case '-l':
      case '--log-level':
        if (nextArg && !nextArg.startsWith('-')) {
          const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']
          if (validLevels.includes(nextArg)) {
            options.logLevel = nextArg as ServerOptions['logLevel']
          }
          i++
        }
        break
      case '--cors':
        if (nextArg && !nextArg.startsWith('-')) {
          options.corsOrigins = nextArg.split(',').map(s => s.trim())
          i++
        }
        break
    }
  }

  return options
}

function showHelp(): void {
  console.log(`
SpeakMCP Server - Standalone HTTP API Server

Usage: speakmcp-server [options]

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  -p, --port <port>       Port to listen on (default: 3210)
  -b, --bind <address>    Address to bind to (default: 127.0.0.1)
  -k, --api-key <key>     API key for authentication
  -c, --config <path>     Path to config file
  -l, --log-level <level> Log level: fatal, error, warn, info, debug, trace, silent
  --cors <origins>        Comma-separated list of allowed CORS origins

Debug options:
  -d, --debug             Enable all debug logging
  -dl, --debug-llm        Enable LLM debug logging
  -dt, --debug-tools      Enable tools debug logging
  -dmcp, --debug-mcp      Enable MCP debug logging
  -ds, --debug-server     Enable server debug logging

Environment variables:
  SPEAKMCP_DATA_DIR       Data directory path
  SPEAKMCP_CONFIG_PATH    Config file path
  SPEAKMCP_PORT           Server port
  SPEAKMCP_BIND           Bind address
  SPEAKMCP_API_KEY        API key
  DEBUG                   Debug flags (e.g., "llm,tools,mcp")

Examples:
  speakmcp-server --port 8080 --bind 0.0.0.0
  speakmcp-server --api-key mySecretKey
  speakmcp-server --debug --log-level debug
  DEBUG=llm,mcp speakmcp-server
`)
}

function showVersion(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../package.json')
    console.log(`speakmcp-server v${pkg.version}`)
  } catch {
    console.log('speakmcp-server v0.0.1')
  }
}

async function main(): Promise<void> {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    process.exit(0)
  }

  if (options.version) {
    showVersion()
    process.exit(0)
  }

  // Apply environment variable overrides
  if (process.env.SPEAKMCP_PORT && !options.port) {
    const port = parseInt(process.env.SPEAKMCP_PORT, 10)
    if (!isNaN(port)) options.port = port
  }
  if (process.env.SPEAKMCP_BIND && !options.bind) {
    options.bind = process.env.SPEAKMCP_BIND
  }
  if (process.env.SPEAKMCP_API_KEY && !options.apiKey) {
    options.apiKey = process.env.SPEAKMCP_API_KEY
  }

  console.log('╔════════════════════════════════════════╗')
  console.log('║        SpeakMCP Server Starting        ║')
  console.log('╚════════════════════════════════════════╝')

  // Ensure data directories exist
  try {
    ensureDataDirs()
    logServer('Data directories initialized')
  } catch (error) {
    console.error('[server] Failed to initialize data directories:', error)
    process.exit(1)
  }

  // Start the server
  const result = await startServer({
    port: options.port,
    bind: options.bind,
    apiKey: options.apiKey,
    corsOrigins: options.corsOrigins,
    logLevel: options.logLevel,
  })

  if (!result.running) {
    console.error(`[server] Failed to start: ${result.error}`)
    process.exit(1)
  }

  console.log(`[server] Server running at http://${result.bind}:${result.port}/v1`)
  console.log('[server] Press Ctrl+C to stop')

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[server] Received ${signal}, shutting down...`)
    await stopServer()
    console.log('[server] Goodbye!')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('[server] Uncaught exception:', error)
    shutdown('uncaughtException').catch(() => process.exit(1))
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[server] Unhandled rejection:', reason)
  })
}

// Run the main function
main().catch((error) => {
  console.error('[server] Fatal error:', error)
  process.exit(1)
})

