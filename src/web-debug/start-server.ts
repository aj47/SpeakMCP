#!/usr/bin/env node

import { WebDebugServer } from './server'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface StartServerOptions {
  port?: number
  host?: string
  openBrowser?: boolean
  buildFirst?: boolean
  verbose?: boolean
}

async function startWebDebugServer(options: StartServerOptions = {}) {
  const {
    port = 3001,
    host = 'localhost',
    openBrowser = true,
    buildFirst = true,
    verbose = false
  } = options

  console.log('🚀 Starting SpeakMCP Web Debug Server...')

  try {
    // Build the web debug interface first if requested
    if (buildFirst) {
      console.log('📦 Building web debug interface...')
      await buildWebDebugInterface(verbose)
    }

    // Create and start the server
    const server = new WebDebugServer({
      port,
      host,
      enableMockTools: true,
      mockDelay: 1000,
      logLevel: verbose ? 'debug' : 'info'
    })

    await server.start()

    const url = `http://${host}:${port}`
    console.log(`✅ Web Debug Server running at ${url}`)
    console.log(`📊 Debug interface available at ${url}`)
    console.log(`🔧 API endpoints available at ${url}/api`)

    // Open browser if requested
    if (openBrowser) {
      console.log('🌐 Opening browser...')
      await openBrowserTo(url)
    }

    console.log('\n📝 Available features:')
    console.log('  • Agent tool call visualization')
    console.log('  • Conversation history inspection')
    console.log('  • Real-time progress tracking')
    console.log('  • Mock MCP service for testing')
    console.log('  • WebSocket real-time updates')
    console.log('\n⚡ Press Ctrl+C to stop the server')

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down server...')
      await server.stop()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Shutting down server...')
      await server.stop()
      process.exit(0)
    })

  } catch (error) {
    console.error('❌ Failed to start web debug server:', error)
    process.exit(1)
  }
}

async function buildWebDebugInterface(verbose: boolean = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const projectRoot = path.resolve(__dirname, '../..')
    
    // Use Vite to build the web debug interface
    const buildProcess = spawn('npx', [
      'vite', 'build',
      '--config', path.join(__dirname, 'vite.config.ts'),
      '--outDir', path.join(projectRoot, 'dist-web-debug'),
      '--emptyOutDir'
    ], {
      cwd: projectRoot,
      stdio: verbose ? 'inherit' : 'pipe'
    })

    buildProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Web debug interface built successfully')
        resolve()
      } else {
        reject(new Error(`Build process exited with code ${code}`))
      }
    })

    buildProcess.on('error', (error) => {
      reject(new Error(`Build process failed: ${error.message}`))
    })
  })
}

async function openBrowserTo(url: string): Promise<void> {
  const { default: open } = await import('open')
  try {
    await open(url)
  } catch (error) {
    console.warn('⚠️  Could not open browser automatically. Please visit:', url)
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const options: StartServerOptions = {}

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--port':
      case '-p':
        options.port = parseInt(args[++i], 10)
        break
      case '--host':
      case '-h':
        options.host = args[++i]
        break
      case '--no-browser':
        options.openBrowser = false
        break
      case '--no-build':
        options.buildFirst = false
        break
      case '--verbose':
      case '-v':
        options.verbose = true
        break
      case '--help':
        console.log(`
SpeakMCP Web Debug Server

Usage: npm run dev:web [options]

Options:
  --port, -p <port>     Port to run the server on (default: 3001)
  --host, -h <host>     Host to bind the server to (default: localhost)
  --no-browser          Don't open browser automatically
  --no-build            Skip building the web interface
  --verbose, -v         Enable verbose logging
  --help                Show this help message

Examples:
  npm run dev:web                    # Start with default settings
  npm run dev:web -- --port 3002    # Start on port 3002
  npm run dev:web -- --no-browser   # Start without opening browser
  npm run dev:web -- --verbose      # Start with verbose logging
`)
        process.exit(0)
        break
      default:
        console.warn(`Unknown argument: ${arg}`)
        break
    }
  }

  startWebDebugServer(options)
}

export { startWebDebugServer }
