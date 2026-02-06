/**
 * Global E2E Test Setup
 * Starts the server before tests and stops it after
 */
import { spawn, ChildProcess } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const TEST_PORT = 3299
const TEST_API_KEY = 'e2e-test-api-key-12345'
const SERVER_START_TIMEOUT = 30000

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Get the monorepo root (e2e -> cli -> apps -> root)
const MONOREPO_ROOT = resolve(__dirname, '..', '..', '..')

// Use an isolated test data directory to avoid conflicts with real config
const TEST_DATA_DIR = resolve(tmpdir(), 'speakmcp-e2e-test')

let serverProcess: ChildProcess | null = null

/**
 * Wait for the server to be ready by polling an authenticated endpoint
 */
async function waitForServer(timeout: number): Promise<void> {
  const startTime = Date.now()
  const url = `http://localhost:${TEST_PORT}/v1/settings`

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      })
      if (response.ok) {
        console.log(`[e2e-setup] Server ready on port ${TEST_PORT}`)
        return
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`Server did not start within ${timeout}ms`)
}

/**
 * Global setup - runs once before all tests
 */
export async function setup(): Promise<void> {
  console.log('[e2e-setup] Starting server...')

  // Clean up and create isolated test data directory
  console.log(`[e2e-setup] Using test data dir: ${TEST_DATA_DIR}`)
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true })
  } catch {
    // Directory may not exist
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true })

  // Get the path to the server from monorepo root
  const serverPath = resolve(MONOREPO_ROOT, 'packages/server/dist/index.js')
  console.log(`[e2e-setup] Server path: ${serverPath}`)

  // Start the server as a child process with fixed API key
  // Use SPEAKMCP_DATA_DIR to isolate config from user's real config
  serverProcess = spawn(
    'node',
    [serverPath, '--port', String(TEST_PORT), '--api-key', TEST_API_KEY],
    {
      cwd: MONOREPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // Use isolated test data directory - this ensures our API key is saved
        SPEAKMCP_DATA_DIR: TEST_DATA_DIR,
        // Disable colors in server logs for cleaner test output
        NO_COLOR: '1',
      },
    }
  )

  // Log server output for debugging
  serverProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[server] ${msg}`)
  })

  serverProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim()
    if (msg) console.error(`[server-err] ${msg}`)
  })

  serverProcess.on('error', (err) => {
    console.error('[e2e-setup] Failed to start server:', err)
  })

  serverProcess.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[e2e-setup] Server exited with code ${code}`)
    }
    if (signal) {
      console.log(`[e2e-setup] Server killed with signal ${signal}`)
    }
    serverProcess = null
  })

  // Wait for server to be ready
  await waitForServer(SERVER_START_TIMEOUT)
}

/**
 * Global teardown - runs once after all tests
 */
export async function teardown(): Promise<void> {
  console.log('[e2e-setup] Stopping server...')

  if (serverProcess) {
    // Send SIGTERM for graceful shutdown
    serverProcess.kill('SIGTERM')

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Force kill if still running
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGKILL')
    }

    serverProcess = null
  }

  // Clean up test data directory
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true })
    console.log('[e2e-setup] Cleaned up test data directory')
  } catch {
    // Ignore cleanup errors
  }

  console.log('[e2e-setup] Server stopped')
}

