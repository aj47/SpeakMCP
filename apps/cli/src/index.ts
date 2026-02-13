#!/usr/bin/env bun
/**
 * SpeakMCP CLI - Entry Point
 * Terminal UI client for SpeakMCP
 *
 * Supports two modes:
 * 1. Embedded server (default): starts @speakmcp/server in-process
 * 2. External server: connects to a running server via --url
 */

import { parseArgs, showHelp, showVersion, loadConfig, autoDiscoverServer, resetConfig, deleteConfig, exportConfig, getConfigPath, type CliArgs } from './config'
import { SpeakMcpClient } from './client'
import { App } from './app'
import crypto from 'crypto'

let embeddedServerRunning = false

/**
 * Start the embedded server in-process.
 * Returns { url, apiKey } for the CLI to connect to.
 */
async function startEmbeddedServer(args: CliArgs): Promise<{ url: string; apiKey: string }> {
  // Dynamic import to avoid loading server code unless needed
  const { startServer } = await import('@speakmcp/server/server')
  const { ensureDataDirs } = await import('@speakmcp/server/config')

  // Ensure data directories exist
  ensureDataDirs()

  const port = args.port || 3211
  const apiKey = args.apiKey || crypto.randomBytes(16).toString('hex')

  console.log(`🚀 Starting embedded server on port ${port}...`)

  const result = await startServer({
    port,
    bind: '127.0.0.1',
    apiKey,
    logLevel: args.debug ? 'debug' : 'silent',
  })

  if (!result.running) {
    throw new Error(`Failed to start embedded server: ${result.error || 'unknown error'}`)
  }

  embeddedServerRunning = true
  const url = `http://127.0.0.1:${result.port}`
  console.log(`✅ Embedded server running at ${url}`)
  return { url, apiKey }
}

/**
 * Stop the embedded server if it was started.
 */
async function stopEmbeddedServer(): Promise<void> {
  if (!embeddedServerRunning) return
  try {
    const { stopServer } = await import('@speakmcp/server/server')
    await stopServer()
    embeddedServerRunning = false
  } catch {
    // Best effort cleanup
  }
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

  // Handle config management commands
  if (args.showConfigPath) {
    console.log(getConfigPath())
    process.exit(0)
  }

  if (args.exportConfig) {
    console.log(exportConfig())
    process.exit(0)
  }

  if (args.deleteConfig) {
    deleteConfig()
    console.log('✅ Config deleted')
    process.exit(0)
  }

  if (args.resetConfig) {
    resetConfig()
    console.log('✅ Config reset to defaults')
    process.exit(0)
  }

  try {
    // Load configuration (CLI flags > env > config file — no auto-discover yet)
    console.log('🔍 Looking for SpeakMCP server...')
    const config = await loadConfig(args)

    // Phase 1: Check for explicit URL (from --url, env var, or config file)
    const hasExplicitUrl = !!config.serverUrl

    if (hasExplicitUrl) {
      // User explicitly configured a server — try connecting, fail hard if unreachable
      console.log(`🔗 Connecting to ${config.serverUrl}...`)
      const client = new SpeakMcpClient(config)
      const isHealthy = await client.isHealthy()
      if (!isHealthy) {
        console.error('❌ Cannot connect to SpeakMCP server at', config.serverUrl)
        console.error('   Check the URL and API key are correct, or omit --url to use embedded mode.')
        process.exit(1)
      }
      console.log('✅ Connected to', config.serverUrl)
      const app = new App(client, config)
      await app.run()
      return
    }

    // Phase 2: No explicit URL — try auto-discover
    const discovered = await autoDiscoverServer()
    if (discovered) {
      console.log(`🔗 Found server at ${discovered}, trying to connect...`)
      config.serverUrl = discovered
      const client = new SpeakMcpClient(config)
      const isHealthy = await client.isHealthy()
      if (isHealthy) {
        // Auto-discovered server works!
        console.log('✅ Connected to', config.serverUrl)
        const app = new App(client, config)
        await app.run()
        return
      }
      // Auto-discovered server failed health check — fall through to embedded
      console.log(`⚠️  Server at ${discovered} found but not accessible (wrong API key?)`)
      config.serverUrl = ''
      config.apiKey = ''
    }

    // Phase 3: No working server — start embedded (unless --no-server)
    if (args.noServer) {
      console.error('❌ No accessible server found and --no-server was specified.')
      console.error('   Start a server manually, provide --api-key, or remove --no-server.')
      process.exit(1)
    }

    const embedded = await startEmbeddedServer(args)
    config.serverUrl = embedded.url
    config.apiKey = embedded.apiKey

    // Verify embedded server is healthy
    const client = new SpeakMcpClient(config)
    const isHealthy = await client.isHealthy()
    if (!isHealthy) {
      console.error('❌ Embedded server started but health check failed')
      await stopEmbeddedServer()
      process.exit(1)
    }

    console.log('✅ Connected to', config.serverUrl)
    const app = new App(client, config)
    await app.run()

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error)
    await stopEmbeddedServer()
    process.exit(1)
  }
}

// Register cleanup handlers for embedded server shutdown
const cleanup = async () => {
  await stopEmbeddedServer()
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

main()

