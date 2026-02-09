import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process'
import { configStore } from '../config'
import { getActualListeningPort, getActualListeningBind } from './server-runtime'

interface StartTunnelOptions {
  mode?: 'quick' | 'named'
  tunnelId?: string
  hostname?: string
  credentialsPath?: string
  localUrl?: string
}

interface TunnelListItem {
  id?: string
  name?: string
  createdAt?: string
  connections?: number
  status?: string
  [key: string]: unknown
}

interface TunnelState {
  process: ChildProcessWithoutNullStreams | null
  mode: 'quick' | 'named' | null
  tunnelId: string | null
  hostname: string | null
  url: string | null
  startedAt: number | null
  starting: boolean
  lastError: string | null
  logs: string[]
}

const tunnelState: TunnelState = {
  process: null,
  mode: null,
  tunnelId: null,
  hostname: null,
  url: null,
  startedAt: null,
  starting: false,
  lastError: null,
  logs: [],
}

const MAX_LOG_LINES = 300

function pushLog(line: string): void {
  const clean = line.trim()
  if (!clean) return
  tunnelState.logs.push(`[${new Date().toISOString()}] ${clean}`)
  if (tunnelState.logs.length > MAX_LOG_LINES) {
    tunnelState.logs.splice(0, tunnelState.logs.length - MAX_LOG_LINES)
  }
}

function extractQuickTunnelUrl(text: string): string | null {
  const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/)
  return match ? match[0] : null
}

function getDefaultLocalUrl(): string {
  // Prefer the server's actual listening port/bind (set after fastify.listen() succeeds)
  // over the config values (which may differ when using --port flag)
  const actualPort = getActualListeningPort()
  const actualBind = getActualListeningBind()

  if (actualPort !== null) {
    // Server is running, use its actual port
    const bind = actualBind === '0.0.0.0' || actualBind === '::' || actualBind === null
      ? '127.0.0.1'
      : actualBind
    return `http://${bind}:${actualPort}`
  }

  // Fallback to config values (server not yet started)
  const cfg = configStore.get() as Record<string, unknown>
  const port = typeof cfg.remoteServerPort === 'number' ? cfg.remoteServerPort : 3210
  const bindAddress = typeof cfg.remoteServerBindAddress === 'string' ? cfg.remoteServerBindAddress : '127.0.0.1'
  const bind = bindAddress === '0.0.0.0' || bindAddress === '::' ? '127.0.0.1' : bindAddress
  return `http://${bind}:${port}`
}

function isTunnelRunning(): boolean {
  const proc = tunnelState.process
  return !!proc && !proc.killed && proc.exitCode === null
}

function getProcessCommands(mode: 'quick' | 'named', localUrl: string, tunnelId?: string): string[] {
  if (mode === 'named' && tunnelId) {
    return ['tunnel', 'run', tunnelId]
  }
  return ['tunnel', '--url', localUrl]
}

function attachProcessListeners(process: ChildProcessWithoutNullStreams): void {
  process.stdout.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString()
    for (const line of text.split('\n')) {
      pushLog(line)
      const quickUrl = extractQuickTunnelUrl(line)
      if (quickUrl) {
        tunnelState.url = quickUrl
        tunnelState.starting = false
      }
    }
  })

  process.stderr.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString()
    for (const line of text.split('\n')) {
      pushLog(line)
      const quickUrl = extractQuickTunnelUrl(line)
      if (quickUrl) {
        tunnelState.url = quickUrl
        tunnelState.starting = false
      }
      if (/error/i.test(line)) {
        tunnelState.lastError = line.trim()
      }
    }
  })

  process.on('exit', (code, signal) => {
    pushLog(`cloudflared exited (code=${String(code)}, signal=${String(signal)})`)
    tunnelState.process = null
    tunnelState.starting = false
    tunnelState.mode = null
    tunnelState.tunnelId = null
    tunnelState.hostname = null
    tunnelState.startedAt = null
  })

  process.on('error', (error: Error) => {
    pushLog(`cloudflared process error: ${error.message}`)
    tunnelState.lastError = error.message
    tunnelState.process = null
    tunnelState.starting = false
  })
}

export function checkCloudflaredInstalled(): { installed: boolean; version?: string; error?: string } {
  try {
    const result = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' })
    if (result.status === 0) {
      const version = (result.stdout || result.stderr || '').trim()
      return { installed: true, version }
    }
    return {
      installed: false,
      error: (result.stderr || result.stdout || 'cloudflared command failed').trim(),
    }
  } catch (error: unknown) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function startTunnel(options?: StartTunnelOptions): {
  success: boolean
  running: boolean
  starting: boolean
  mode?: 'quick' | 'named'
  url?: string | null
  tunnelId?: string | null
  hostname?: string | null
  error?: string
} {
  if (isTunnelRunning()) {
    return {
      success: true,
      running: true,
      starting: tunnelState.starting,
      mode: tunnelState.mode || 'quick',
      url: tunnelState.url,
      tunnelId: tunnelState.tunnelId,
      hostname: tunnelState.hostname,
    }
  }

  const installed = checkCloudflaredInstalled()
  if (!installed.installed) {
    return {
      success: false,
      running: false,
      starting: false,
      error: installed.error || 'cloudflared is not installed',
    }
  }

  const mode = options?.mode === 'named' ? 'named' : 'quick'
  const localUrl = options?.localUrl || getDefaultLocalUrl()

  if (mode === 'named' && !options?.tunnelId) {
    return {
      success: false,
      running: false,
      starting: false,
      error: 'Named tunnel mode requires tunnelId',
    }
  }

  try {
    const args = getProcessCommands(mode, localUrl, options?.tunnelId)
    pushLog(`Starting cloudflared ${args.join(' ')}`)

    const proc = spawn('cloudflared', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    tunnelState.process = proc
    tunnelState.mode = mode
    tunnelState.tunnelId = options?.tunnelId || null
    tunnelState.hostname = options?.hostname || null
    tunnelState.url = null
    tunnelState.startedAt = Date.now()
    tunnelState.starting = true
    tunnelState.lastError = null

    attachProcessListeners(proc)

    return {
      success: true,
      running: true,
      starting: true,
      mode,
      url: null,
      tunnelId: tunnelState.tunnelId,
      hostname: tunnelState.hostname,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    tunnelState.lastError = message
    return {
      success: false,
      running: false,
      starting: false,
      error: message,
    }
  }
}

export async function stopTunnel(): Promise<{ success: boolean; running: boolean; error?: string }> {
  const proc = tunnelState.process
  if (!proc || proc.killed || proc.exitCode !== null) {
    tunnelState.process = null
    tunnelState.starting = false
    return { success: true, running: false }
  }

  try {
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          if (!proc.killed && proc.exitCode === null) {
            proc.kill('SIGKILL')
          }
        } catch {
          // Ignore force-kill errors.
        }
        resolve()
      }, 1500)

      proc.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    tunnelState.process = null
    tunnelState.starting = false
    tunnelState.mode = null
    tunnelState.tunnelId = null
    tunnelState.hostname = null
    tunnelState.url = null
    tunnelState.startedAt = null

    return { success: true, running: false }
  } catch (error: unknown) {
    return {
      success: false,
      running: isTunnelRunning(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function getTunnelStatus(): {
  running: boolean
  starting: boolean
  mode?: 'quick' | 'named' | null
  url?: string | null
  tunnelId?: string | null
  hostname?: string | null
  uptimeMs?: number
  pid?: number
  lastError?: string | null
  logs: string[]
} {
  const running = isTunnelRunning()
  return {
    running,
    starting: tunnelState.starting,
    mode: tunnelState.mode,
    url: tunnelState.url,
    tunnelId: tunnelState.tunnelId,
    hostname: tunnelState.hostname,
    uptimeMs: tunnelState.startedAt ? Date.now() - tunnelState.startedAt : 0,
    pid: tunnelState.process?.pid,
    lastError: tunnelState.lastError,
    logs: tunnelState.logs.slice(-80),
  }
}

export function listTunnels(): { success: boolean; tunnels: TunnelListItem[]; error?: string } {
  const installed = checkCloudflaredInstalled()
  if (!installed.installed) {
    return {
      success: false,
      tunnels: [],
      error: installed.error || 'cloudflared is not installed',
    }
  }

  try {
    const result = spawnSync('cloudflared', ['tunnel', 'list', '--output', 'json'], { encoding: 'utf8' })
    if (result.status !== 0) {
      return {
        success: false,
        tunnels: [],
        error: (result.stderr || result.stdout || 'Failed to list tunnels').trim(),
      }
    }

    const parsed = JSON.parse((result.stdout || '[]').trim()) as TunnelListItem[]
    return { success: true, tunnels: Array.isArray(parsed) ? parsed : [] }
  } catch (error: unknown) {
    return {
      success: false,
      tunnels: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
