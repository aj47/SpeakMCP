#!/usr/bin/env bun
/**
 * SpeakMCP CLI - Entry Point
 * Terminal UI client for SpeakMCP
 */

import { parseArgs, showHelp, showVersion, loadConfig } from './config'
import { SpeakMcpClient } from './client'
import { App } from './app'

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
    console.log('🔍 Connecting to SpeakMCP server...')
    const config = await loadConfig(args)
    
    // Create API client
    const client = new SpeakMcpClient(config)
    
    // Verify server connectivity
    const isHealthy = await client.isHealthy()
    if (!isHealthy) {
      console.error('❌ Cannot connect to SpeakMCP server at', config.serverUrl)
      console.error('   Make sure the server is running: npx @speakmcp/server')
      process.exit(1)
    }
    
    console.log('✅ Connected to', config.serverUrl)
    
    // Start the TUI application
    const app = new App(client, config)
    await app.run()
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()

