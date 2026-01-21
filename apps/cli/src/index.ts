#!/usr/bin/env bun
/**
 * SpeakMCP CLI - Entry Point
 * Terminal UI client for SpeakMCP with embedded server
 */

import { parseArgs, showHelp, showVersion, loadConfig } from './config'
import { SpeakMcpClient } from './client'
import { App } from './app'
import crypto from 'crypto'

// Dynamic import for server (only when needed)
async function startEmbeddedServer(port: number, apiKey: string): Promise<void> {
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
    logLevel: 'warn', // Quiet mode for embedded
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

  try {
    // Load configuration
    const config = await loadConfig(args)

    // Generate API key if embedded mode and no key provided
    let apiKey = config.apiKey
    if (config.embedded && !apiKey) {
      apiKey = crypto.randomBytes(16).toString('hex')
      config.apiKey = apiKey
    }

    // Start embedded server if needed
    if (config.embedded) {
      console.log('🚀 Starting SpeakMCP server...')
      await startEmbeddedServer(config.port || 3210, apiKey)

      // Wait for server to be ready
      const isReady = await waitForServer(config.serverUrl, apiKey)
      if (!isReady) {
        console.error('❌ Server failed to start in time')
        process.exit(1)
      }
      console.log(`✅ Server running at ${config.serverUrl}`)

      // Server-only mode: just keep running
      if (config.serverOnly) {
        console.log('📡 Server-only mode. Press Ctrl+C to stop.')
        // Keep process alive
        await new Promise(() => {})
        return
      }
    } else {
      console.log('🔍 Connecting to SpeakMCP server...')
    }

    // Create API client
    const client = new SpeakMcpClient(config)

    // Verify server connectivity
    const isHealthy = await client.isHealthy()
    if (!isHealthy) {
      console.error('❌ Cannot connect to SpeakMCP server at', config.serverUrl)
      if (!config.embedded) {
        console.error('   Make sure the server is running or use embedded mode')
      }
      process.exit(1)
    }

    if (!config.embedded) {
      console.log('✅ Connected to', config.serverUrl)
    }

    // Start the TUI application
    const app = new App(client, config)
    await app.run()

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()

