import { spawn, ChildProcess } from "child_process"
import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"
import { access, constants } from "fs/promises"
import path from "path"
import os from "os"

// Helper to log to both diagnostics service and console for easier debugging
function debugLog(message: string): void {
  diagnosticsService.logInfo("cloudflare-tunnel", message)
  // eslint-disable-next-line no-console
  console.log(`[cloudflare-tunnel] ${message}`)
}

let tunnelProcess: ChildProcess | null = null
let tunnelUrl: string | null = null
let tunnelError: string | null = null
let isStarting = false

// Regex to extract the tunnel URL from cloudflared output
// Example: "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): https://xxx-xxx-xxx.trycloudflare.com"
const TUNNEL_URL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/

/**
 * Common paths where cloudflared might be installed
 */
function getCloudflaredSearchPaths(): string[] {
  const paths = [
    "/opt/homebrew/bin",           // Homebrew on Apple Silicon
    "/usr/local/bin",              // Homebrew on Intel Mac, common Linux
    "/usr/bin",                    // System binaries
    "/bin",                        // System binaries
    path.join(os.homedir(), ".cloudflared"), // User install location
    path.join(os.homedir(), "bin"),          // User bin
  ]

  // Add PATH directories
  const systemPath = process.env.PATH || ""
  const pathSeparator = process.platform === "win32" ? ";" : ":"
  paths.push(...systemPath.split(pathSeparator).filter(Boolean))

  return [...new Set(paths)] // Remove duplicates
}

/**
 * Get an enhanced PATH that includes common cloudflared installation locations
 */
function getEnhancedPath(): string {
  const pathSeparator = process.platform === "win32" ? ";" : ":"
  const searchPaths = getCloudflaredSearchPaths()
  const currentPath = process.env.PATH || ""
  const currentPaths = currentPath.split(pathSeparator)

  // Add search paths that aren't already in PATH
  for (const p of searchPaths) {
    if (!currentPaths.includes(p)) {
      currentPaths.push(p)
    }
  }

  return currentPaths.join(pathSeparator)
}

/**
 * Try to find the cloudflared binary path
 */
async function findCloudflaredPath(): Promise<string | null> {
  const searchPaths = getCloudflaredSearchPaths()
  const binaryName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared"

  debugLog(`Searching for cloudflared binary...`)
  debugLog(`Binary name: ${binaryName}`)
  debugLog(`Search paths: ${JSON.stringify(searchPaths, null, 2)}`)
  debugLog(`Current process.env.PATH: ${process.env.PATH}`)

  for (const dir of searchPaths) {
    const fullPath = path.join(dir, binaryName)
    try {
      await access(fullPath, constants.F_OK | constants.X_OK)
      debugLog(`✅ Found cloudflared at: ${fullPath}`)
      return fullPath
    } catch (err) {
      // Only log first few misses to avoid spam
    }
  }

  debugLog(`cloudflared binary not found in any search path`)
  return null
}

/**
 * Check if cloudflared is installed and available
 */
export async function checkCloudflaredInstalled(): Promise<boolean> {
  debugLog(`checkCloudflaredInstalled called`)

  // First try to find the binary directly
  const cloudflaredPath = await findCloudflaredPath()
  if (cloudflaredPath) {
    debugLog(`checkCloudflaredInstalled: Found via direct path search`)
    return true
  }

  // Fallback: try spawning with enhanced PATH
  debugLog(`checkCloudflaredInstalled: Trying spawn fallback with enhanced PATH`)
  const enhancedPath = getEnhancedPath()
  debugLog(`Enhanced PATH for spawn: ${enhancedPath}`)

  // Create a clean env object with only string values for spawn
  const spawnEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      spawnEnv[key] = value
    }
  }
  spawnEnv.PATH = enhancedPath

  return new Promise<boolean>((resolve) => {
    const proc = spawn("cloudflared", ["--version"], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv as NodeJS.ProcessEnv,
    })

    proc.on("error", (err: Error) => {
      debugLog(`checkCloudflaredInstalled spawn error: ${err.message}`)
      resolve(false)
    })
    proc.on("close", (code: number | null) => {
      debugLog(`checkCloudflaredInstalled spawn exited with code: ${code}`)
      resolve(code === 0)
    })
  })
}

/**
 * Start a Cloudflare Quick Tunnel pointing to the remote server
 */
export async function startCloudflareTunnel(): Promise<{
  success: boolean
  url?: string
  error?: string
}> {
  if (isStarting) {
    return { success: false, error: "Tunnel is already starting" }
  }

  if (tunnelProcess) {
    return { success: true, url: tunnelUrl || undefined }
  }

  const cfg = configStore.get()
  const port = cfg.remoteServerPort || 3210

  // Try to find cloudflared binary path
  const cloudflaredPath = await findCloudflaredPath()
  if (!cloudflaredPath) {
    // Fallback check with enhanced PATH
    const installed = await checkCloudflaredInstalled()
    if (!installed) {
      tunnelError = "cloudflared is not installed. Please install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
      diagnosticsService.logError("cloudflare-tunnel", tunnelError)
      return { success: false, error: tunnelError }
    }
  }

  isStarting = true
  tunnelError = null
  tunnelUrl = null

  // Use the resolved path if found, otherwise fall back to "cloudflared" with enhanced PATH
  const command = cloudflaredPath || "cloudflared"

  // Create a clean env object with only string values for spawn
  const enhancedEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      enhancedEnv[key] = value
    }
  }
  enhancedEnv.PATH = getEnhancedPath()

  debugLog(`Starting tunnel with command: ${command}`)
  debugLog(`Target port: ${port}`)
  debugLog(`Enhanced PATH: ${enhancedEnv.PATH}`)

  return new Promise<{ success: boolean; url?: string; error?: string }>((resolve) => {
    try {
      // Spawn cloudflared with quick tunnel using resolved path and enhanced environment
      debugLog(`Spawning: ${command} tunnel --url http://localhost:${port}`)
      const proc = spawn(command, ["tunnel", "--url", `http://localhost:${port}`], {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: enhancedEnv as NodeJS.ProcessEnv,
      })

      tunnelProcess = proc
      debugLog(`Process spawned with PID: ${proc.pid}`)

      // Handle stdout - look for the tunnel URL
      proc.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        debugLog(`stdout: ${output}`)

        const match = output.match(TUNNEL_URL_REGEX)
        if (match && !tunnelUrl) {
          tunnelUrl = match[0]
          isStarting = false
          debugLog(`🎉 Tunnel URL found: ${tunnelUrl}`)
          resolve({ success: true, url: tunnelUrl })
        }
      })

      // Handle stderr - cloudflared outputs most info to stderr
      proc.stderr?.on("data", (data: Buffer) => {
        const output = data.toString()
        debugLog(`stderr: ${output}`)

        const match = output.match(TUNNEL_URL_REGEX)
        if (match && !tunnelUrl) {
          tunnelUrl = match[0]
          isStarting = false
          debugLog(`🎉 Tunnel URL found: ${tunnelUrl}`)
          resolve({ success: true, url: tunnelUrl })
        }
      })

      proc.on("error", (err: Error) => {
        tunnelError = err.message
        tunnelProcess = null
        isStarting = false
        debugLog(`❌ Process error: ${err.message}`)
        diagnosticsService.logError("cloudflare-tunnel", "Process error", err)
        resolve({ success: false, error: tunnelError || undefined })
      })

      proc.on("close", (code: number | null) => {
        debugLog(`Process exited with code ${code}`)
        tunnelProcess = null
        isStarting = false

        if (!tunnelUrl) {
          tunnelError = `cloudflared exited with code ${code}`
          debugLog(`❌ Tunnel failed: ${tunnelError}`)
          resolve({ success: false, error: tunnelError })
        }
      })

      // Timeout after 30 seconds if no URL is found
      setTimeout(() => {
        if (isStarting && !tunnelUrl) {
          isStarting = false
          tunnelError = "Timeout waiting for tunnel URL"
          stopCloudflareTunnel({ preserveError: true })
          resolve({ success: false, error: tunnelError })
        }
      }, 30000)
    } catch (err) {
      isStarting = false
      tunnelError = err instanceof Error ? err.message : String(err)
      diagnosticsService.logError("cloudflare-tunnel", "Failed to start tunnel", err)
      resolve({ success: false, error: tunnelError })
    }
  })
}

/**
 * Stop the Cloudflare Tunnel
 */
export async function stopCloudflareTunnel(options?: { preserveError?: boolean }): Promise<void> {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill("SIGTERM")
      diagnosticsService.logInfo("cloudflare-tunnel", "Tunnel stopped")
    } catch (err) {
      diagnosticsService.logError("cloudflare-tunnel", "Error stopping tunnel", err)
    } finally {
      tunnelProcess = null
      tunnelUrl = null
      if (!options?.preserveError) {
        tunnelError = null
      }
      isStarting = false
    }
  }
}

/**
 * Get the current tunnel status
 */
export function getCloudflareTunnelStatus(): {
  running: boolean
  starting: boolean
  url: string | null
  error: string | null
} {
  return {
    running: tunnelProcess !== null && !isStarting,
    starting: isStarting,
    url: tunnelUrl,
    error: tunnelError,
  }
}

