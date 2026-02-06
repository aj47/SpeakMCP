/**
 * PTY Driver for CLI E2E testing
 * Spawns the CLI in a pseudo-terminal and provides methods for interaction
 */
import * as pty from 'node-pty'
import stripAnsi from 'strip-ansi'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { KEYS, KeyName } from './keys'

// Get the monorepo root from the helpers directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MONOREPO_ROOT = resolve(__dirname, '..', '..', '..', '..')

// Test API key - must match the one in setup.ts
const TEST_API_KEY = 'e2e-test-api-key-12345'

/**
 * Find the bun binary path
 * node-pty requires full path as it doesn't use shell PATH
 */
function findBunPath(): string {
  // Check common locations
  const candidates = [
    resolve(homedir(), '.bun/bin/bun'),
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
    'bun', // fallback to PATH lookup (may not work)
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  // If BUN_INSTALL is set, check there
  if (process.env.BUN_INSTALL) {
    const bunInstallPath = resolve(process.env.BUN_INSTALL, 'bin/bun')
    if (existsSync(bunInstallPath)) {
      return bunInstallPath
    }
  }

  throw new Error('Could not find bun binary. Please install bun: https://bun.sh')
}

const BUN_PATH = findBunPath()

export interface PtyDriverOptions {
  serverUrl?: string
  apiKey?: string
  cols?: number
  rows?: number
}

const DEFAULT_OPTIONS: Required<PtyDriverOptions> = {
  serverUrl: 'http://localhost:3299',
  apiKey: TEST_API_KEY,
  cols: 120,
  rows: 40,
}

export class PtyDriver {
  private ptyProcess: pty.IPty | null = null
  private output: string = ''
  private options: Required<PtyDriverOptions>

  constructor(options: PtyDriverOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Spawn the CLI process in a PTY
   */
  async spawn(): Promise<void> {
    const args = [
      'run',
      'apps/cli/src/index.ts',
      '--',
      '--url',
      this.options.serverUrl,
      '--api-key',
      this.options.apiKey,
    ]

    this.ptyProcess = pty.spawn(BUN_PATH, args, {
      name: 'xterm-256color',
      cols: this.options.cols,
      rows: this.options.rows,
      cwd: MONOREPO_ROOT,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
    })

    this.output = ''

    this.ptyProcess.onData((data) => {
      this.output += data
    })

    // Wait for initial render
    await this.waitForText('F1', 5000).catch(() => {
      // OK if help text not found, CLI might have different layout
    })
  }

  /**
   * Write text to the PTY stdin
   */
  write(text: string): void {
    if (!this.ptyProcess) {
      throw new Error('PTY not spawned. Call spawn() first.')
    }
    this.ptyProcess.write(text)
  }

  /**
   * Send a key by name
   */
  pressKey(key: KeyName): void {
    this.write(KEYS[key])
  }

  /**
   * Type text followed by Enter
   */
  typeAndEnter(text: string): void {
    this.write(text)
    this.pressKey('ENTER')
  }

  /**
   * Get raw terminal output (with ANSI codes)
   */
  getRawOutput(): string {
    return this.output
  }

  /**
   * Get cleaned terminal output (ANSI codes stripped)
   */
  getOutput(): string {
    return stripAnsi(this.output)
  }

  /**
   * Clear the output buffer
   */
  clearOutput(): void {
    this.output = ''
  }

  /**
   * Wait for text pattern to appear in output (polling-based)
   */
  async waitForText(
    pattern: string | RegExp,
    timeout: number = 30000,
    pollInterval: number = 100
  ): Promise<string> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const output = this.getOutput()
      const matches =
        typeof pattern === 'string' ? output.includes(pattern) : pattern.test(output)

      if (matches) {
        return output
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    const output = this.getOutput()
    throw new Error(
      `Timeout waiting for pattern "${pattern}" after ${timeout}ms.\n` +
        `Current output (last 500 chars):\n${output.slice(-500)}`
    )
  }

  /**
   * Wait for output to stabilize (no new output for duration)
   */
  async waitForStable(duration: number = 500, timeout: number = 30000): Promise<string> {
    const startTime = Date.now()
    let lastOutput = this.getOutput()
    let stableStart = Date.now()

    while (Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const currentOutput = this.getOutput()

      if (currentOutput !== lastOutput) {
        lastOutput = currentOutput
        stableStart = Date.now()
      } else if (Date.now() - stableStart >= duration) {
        return currentOutput
      }
    }

    return this.getOutput()
  }

  /**
   * Kill the PTY process
   */
  kill(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill()
      this.ptyProcess = null
    }
  }

  /**
   * Check if PTY is running
   */
  isRunning(): boolean {
    return this.ptyProcess !== null
  }
}

