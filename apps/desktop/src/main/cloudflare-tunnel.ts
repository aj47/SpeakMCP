import { spawn, ChildProcess } from "child_process"
import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"
import { access, constants } from "fs/promises"
import path from "path"
import os from "os"
import { isPrintQR } from "./debug"

// Helper to log to both diagnostics service and console for easier debugging
function debugLog(message: string): void {
  diagnosticsService.logInfo("cloudflare-tunnel", message)
  // eslint-disable-next-line no-console
  console.log(`[cloudflare-tunnel] ${message}`)
}

/**
 * Print a QR code for the tunnel URL to the terminal when --qr flag is set
 */
async function printTunnelQR(url: string): Promise<void> {
  if (!isPrintQR()) return
  try {
    const QRCode = await import("qrcode")
    const qr = await QRCode.toString(url, { type: "terminal", small: true })
    // eslint-disable-next-line no-console
    console.log("\n📱 Scan QR code to connect:\n")
    // eslint-disable-next-line no-console
    console.log(qr)
    // eslint-disable-next-line no-console
    console.log(`🔗 Tunnel URL: ${url}\n`)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[cloudflare-tunnel] Failed to print QR code:", err)
  }
}

let tunnelProcess: ChildProcess | null = null
let tunnelUrl: string | null = null
let tunnelError: string | null = null
let isStarting = false
let currentTunnelMode: "quick" | "named" | null = null

// Regex to extract the tunnel URL from cloudflared output
// Example: "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): https://xxx-xxx-xxx.trycloudflare.com"
const TUNNEL_URL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/

// Regex to detect when named tunnel is connected (from cloudflared logs)
// Example: "Connection established" or "Registered tunnel connection"
const NAMED_TUNNEL_CONNECTED_REGEX = /Connection [a-f0-9-]+ registered|Registered tunnel connection|INF Connection [a-f0-9-]+ registered/i

/**
 * Expand tilde (~) in file paths to the user's home directory
 * Handles both "~" alone and "~/path" format
 */
function expandTilde(filePath: string): string {
  if (filePath === "~") {
    return os.homedir()
  }
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2))
  }
  return filePath
}

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
  // Filter out empty strings to avoid PATH starting with separator when process.env.PATH is empty
  const currentPaths = currentPath.split(pathSeparator).filter(Boolean)

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

  for (const dir of searchPaths) {
    const fullPath = path.join(dir, binaryName)
    try {
      await access(fullPath, constants.F_OK | constants.X_OK)
      debugLog(`Found cloudflared binary`)
      return fullPath
    } catch {
      // Binary not found in this path, continue searching
    }
  }

  debugLog(`cloudflared binary not found`)
  return null
}

/**
 * Check if cloudflared is installed and available
 */
export async function checkCloudflaredInstalled(): Promise<boolean> {
  // First try to find the binary directly
  const cloudflaredPath = await findCloudflaredPath()
  if (cloudflaredPath) {
    return true
  }

  // Fallback: try spawning with enhanced PATH
  const enhancedPath = getEnhancedPath()

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
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv as NodeJS.ProcessEnv,
    })

    proc.on("error", () => {
      resolve(false)
    })
    proc.on("close", (code: number | null) => {
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
  currentTunnelMode = "quick"

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

  debugLog(`Starting tunnel on port ${port}`)

  return new Promise<{ success: boolean; url?: string; error?: string }>((resolve) => {
    try {
      // Spawn cloudflared with quick tunnel using resolved path and enhanced environment
      const proc = spawn(command, ["tunnel", "--url", `http://127.0.0.1:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
        env: enhancedEnv as NodeJS.ProcessEnv,
      })

      tunnelProcess = proc

      // Handle stdout - look for the tunnel URL
      proc.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        const match = output.match(TUNNEL_URL_REGEX)
        if (match && !tunnelUrl) {
          tunnelUrl = match[0]
          isStarting = false
          debugLog(`Tunnel URL established`)
          printTunnelQR(tunnelUrl)
          resolve({ success: true, url: tunnelUrl })
        }
      })

      // Handle stderr - cloudflared outputs most info to stderr
      proc.stderr?.on("data", (data: Buffer) => {
        const output = data.toString()
        const match = output.match(TUNNEL_URL_REGEX)
        if (match && !tunnelUrl) {
          tunnelUrl = match[0]
          isStarting = false
          debugLog(`Tunnel URL established`)
          printTunnelQR(tunnelUrl)
          resolve({ success: true, url: tunnelUrl })
        }
      })

      proc.on("error", (err: Error) => {
        tunnelError = err.message
        tunnelProcess = null
        isStarting = false
        currentTunnelMode = null
        diagnosticsService.logError("cloudflare-tunnel", "Process error", err)
        resolve({ success: false, error: tunnelError || undefined })
      })

      proc.on("close", (code: number | null) => {
        tunnelProcess = null
        isStarting = false

        if (!tunnelUrl) {
          tunnelError = `cloudflared exited with code ${code}`
          currentTunnelMode = null
          debugLog(`Tunnel failed with exit code ${code}`)
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
      currentTunnelMode = null
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
      currentTunnelMode = null
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
  mode: "quick" | "named" | null
} {
  return {
    running: tunnelProcess !== null && !isStarting,
    starting: isStarting,
    url: tunnelUrl,
    error: tunnelError,
    mode: currentTunnelMode,
  }
}

/**
 * Get the default credentials path for a named tunnel
 */
function getDefaultCredentialsPath(tunnelId: string): string {
  return path.join(os.homedir(), ".cloudflared", `${tunnelId}.json`)
}

/**
 * Ensure DNS route exists for a named tunnel hostname.
 * Runs `cloudflared tunnel route dns <tunnel-id> <hostname>` to create a CNAME record.
 * Uses --overwrite-dns flag to update existing records if needed.
 *
 * @returns Promise<{ success: boolean; error?: string }>
 */
async function ensureDnsRoute(options: {
  tunnelId: string
  hostname: string
  cloudflaredPath: string | null
}): Promise<{ success: boolean; error?: string }> {
  const { tunnelId, hostname, cloudflaredPath } = options
  const command = cloudflaredPath || "cloudflared"

  // Create enhanced environment for spawn
  const enhancedEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      enhancedEnv[key] = value
    }
  }
  enhancedEnv.PATH = getEnhancedPath()

  debugLog(`Ensuring DNS route: ${hostname} -> tunnel ${tunnelId}`)

  return new Promise((resolve) => {
    const proc = spawn(command, [
      "tunnel",
      "route",
      "dns",
      "--overwrite-dns",
      tunnelId,
      hostname,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: enhancedEnv as NodeJS.ProcessEnv,
    })

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("error", (err: Error) => {
      diagnosticsService.logError("cloudflare-tunnel", "DNS route error", err)
      resolve({ success: false, error: `Failed to configure DNS route: ${err.message}` })
    })

    proc.on("close", (code: number | null) => {
      const output = stdout + stderr
      if (code === 0) {
        debugLog(`DNS route configured successfully: ${hostname}`)
        resolve({ success: true })
      } else {
        // Check if it's just a "record already exists" situation (not an error)
        if (output.includes("already exists") || output.includes("CNAME")) {
          debugLog(`DNS route already exists for ${hostname}`)
          resolve({ success: true })
        } else {
          const errorMsg = `DNS route configuration failed (exit ${code}): ${output.trim()}`
          diagnosticsService.logError("cloudflare-tunnel", errorMsg)
          resolve({ success: false, error: errorMsg })
        }
      }
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      proc.kill()
      resolve({ success: false, error: "Timeout configuring DNS route" })
    }, 30000)
  })
}

/**
 * Start a Named Cloudflare Tunnel for persistent URLs
 * Requires prior setup: cloudflared tunnel login && cloudflared tunnel create <name>
 */
export async function startNamedCloudflareTunnel(options: {
  tunnelId: string
  hostname: string
  credentialsPath?: string
}): Promise<{
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

  const { tunnelId, hostname, credentialsPath } = options
  const cfg = configStore.get()
  const port = cfg.remoteServerPort || 3210

  // Try to find cloudflared binary path
  const cloudflaredPath = await findCloudflaredPath()
  if (!cloudflaredPath) {
    const installed = await checkCloudflaredInstalled()
    if (!installed) {
      tunnelError = "cloudflared is not installed. Please install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
      diagnosticsService.logError("cloudflare-tunnel", tunnelError)
      return { success: false, error: tunnelError }
    }
  }

  // Verify credentials file exists
  const credsPath = expandTilde(credentialsPath || getDefaultCredentialsPath(tunnelId))
  try {
    await access(credsPath, constants.F_OK | constants.R_OK)
  } catch {
    tunnelError = `Tunnel credentials file not found: ${credsPath}. Please run 'cloudflared tunnel login' and 'cloudflared tunnel create <name>' first.`
    diagnosticsService.logError("cloudflare-tunnel", tunnelError)
    return { success: false, error: tunnelError }
  }

  // Ensure DNS route is configured before starting the tunnel
  // This creates a CNAME record pointing the hostname to the tunnel
  const dnsResult = await ensureDnsRoute({
    tunnelId,
    hostname,
    cloudflaredPath,
  })
  if (!dnsResult.success) {
    tunnelError = dnsResult.error || "Failed to configure DNS route"
    diagnosticsService.logError("cloudflare-tunnel", tunnelError)
    return { success: false, error: tunnelError }
  }

  isStarting = true
  tunnelError = null
  tunnelUrl = null
  currentTunnelMode = "named"

  const command = cloudflaredPath || "cloudflared"

  // Create a clean env object with only string values for spawn
  const enhancedEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      enhancedEnv[key] = value
    }
  }
  enhancedEnv.PATH = getEnhancedPath()

  debugLog(`Starting named tunnel ${tunnelId} on port ${port}`)

  // Build the URL based on hostname
  const publicUrl = `https://${hostname}`

  return new Promise<{ success: boolean; url?: string; error?: string }>((resolve) => {
    try {
      // For named tunnels, we use: cloudflared tunnel --credentials-file <path> run --url http://localhost:<port> <tunnel-id>
      //
      // Note about --url flag: While Cloudflare's official docs recommend using a config.yml file
      // with ingress rules for locally-managed tunnels, the --url flag is supported by cloudflared
      // as a convenience for simple single-service tunnels. This approach is used by quick tunnels
      // and works reliably across cloudflared versions. For complex multi-service setups, users
      // should create a config.yml manually.
      // See: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/
      const args = [
        "tunnel",
        "--credentials-file", credsPath,
        "run",
        "--url", `http://127.0.0.1:${port}`,
        tunnelId,
      ]

      const proc = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: enhancedEnv as NodeJS.ProcessEnv,
      })

      tunnelProcess = proc

      let hasResolved = false

      // Handle stdout
      proc.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        debugLog(`[stdout] ${output.trim()}`)
        if (NAMED_TUNNEL_CONNECTED_REGEX.test(output) && !hasResolved) {
          tunnelUrl = publicUrl
          isStarting = false
          hasResolved = true
          debugLog(`Named tunnel connected: ${publicUrl}`)
          printTunnelQR(publicUrl)
          resolve({ success: true, url: tunnelUrl })
        }
      })

      // Handle stderr - cloudflared outputs most info to stderr
      proc.stderr?.on("data", (data: Buffer) => {
        const output = data.toString()
        debugLog(`[stderr] ${output.trim()}`)
        if (NAMED_TUNNEL_CONNECTED_REGEX.test(output) && !hasResolved) {
          tunnelUrl = publicUrl
          isStarting = false
          hasResolved = true
          debugLog(`Named tunnel connected: ${publicUrl}`)
          printTunnelQR(publicUrl)
          resolve({ success: true, url: tunnelUrl })
        }
      })

      proc.on("error", (err: Error) => {
        tunnelError = err.message
        tunnelProcess = null
        isStarting = false
        currentTunnelMode = null
        diagnosticsService.logError("cloudflare-tunnel", "Process error", err)
        if (!hasResolved) {
          hasResolved = true
          resolve({ success: false, error: tunnelError || undefined })
        }
      })

      proc.on("close", (code: number | null) => {
        tunnelProcess = null
        isStarting = false

        if (!tunnelUrl && !hasResolved) {
          tunnelError = `cloudflared exited with code ${code}`
          currentTunnelMode = null
          debugLog(`Named tunnel failed with exit code ${code}`)
          hasResolved = true
          resolve({ success: false, error: tunnelError })
        }
      })

      // Timeout after 30 seconds if no connection is established
      setTimeout(() => {
        if (isStarting && !tunnelUrl && !hasResolved) {
          isStarting = false
          tunnelError = "Timeout waiting for named tunnel to connect"
          stopCloudflareTunnel({ preserveError: true })
          hasResolved = true
          resolve({ success: false, error: tunnelError })
        }
      }, 30000)
    } catch (err) {
      isStarting = false
      currentTunnelMode = null
      tunnelError = err instanceof Error ? err.message : String(err)
      diagnosticsService.logError("cloudflare-tunnel", "Failed to start named tunnel", err)
      resolve({ success: false, error: tunnelError })
    }
  })
}

/**
 * List available tunnels (requires cloudflared to be logged in)
 */
export async function listCloudflareTunnels(): Promise<{
  success: boolean
  tunnels?: Array<{ id: string; name: string; created_at: string }>
  error?: string
}> {
  const cloudflaredPath = await findCloudflaredPath()
  if (!cloudflaredPath) {
    const installed = await checkCloudflaredInstalled()
    if (!installed) {
      return { success: false, error: "cloudflared is not installed" }
    }
  }

  const command = cloudflaredPath || "cloudflared"

  const enhancedEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      enhancedEnv[key] = value
    }
  }
  enhancedEnv.PATH = getEnhancedPath()

  return new Promise((resolve) => {
    const proc = spawn(command, ["tunnel", "list", "--output", "json"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: enhancedEnv as NodeJS.ProcessEnv,
    })

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("error", (err: Error) => {
      resolve({ success: false, error: err.message })
    })

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        try {
          const tunnels = JSON.parse(stdout)
          resolve({ success: true, tunnels })
        } catch {
          resolve({ success: false, error: "Failed to parse tunnel list" })
        }
      } else {
        resolve({
          success: false,
          error: stderr.trim() || `cloudflared exited with code ${code}`,
        })
      }
    })
  })
}

/**
 * Check if the user is logged into cloudflared
 */
export async function checkCloudflaredLoggedIn(): Promise<boolean> {
  const certPath = path.join(os.homedir(), ".cloudflared", "cert.pem")
  try {
    await access(certPath, constants.F_OK | constants.R_OK)
    return true
  } catch {
    return false
  }
}

