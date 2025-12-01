import { spawn, ChildProcess } from "child_process"
import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"

let tunnelProcess: ChildProcess | null = null
let tunnelUrl: string | null = null
let tunnelError: string | null = null
let isStarting = false

// Regex to extract the tunnel URL from cloudflared output
// Example: "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): https://xxx-xxx-xxx.trycloudflare.com"
const TUNNEL_URL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/

/**
 * Check if cloudflared is installed and available in PATH
 */
export async function checkCloudflaredInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("cloudflared", ["--version"], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    proc.on("error", () => resolve(false))
    proc.on("close", (code) => resolve(code === 0))
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

  // Check if cloudflared is installed
  const installed = await checkCloudflaredInstalled()
  if (!installed) {
    tunnelError = "cloudflared is not installed. Please install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    diagnosticsService.logError("cloudflare-tunnel", tunnelError)
    return { success: false, error: tunnelError }
  }

  isStarting = true
  tunnelError = null
  tunnelUrl = null

  return new Promise((resolve) => {
    try {
      // Spawn cloudflared with quick tunnel
      const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      })

      tunnelProcess = proc

      // Handle stdout - look for the tunnel URL
      proc.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        diagnosticsService.logInfo("cloudflare-tunnel", `stdout: ${output}`)

        const match = output.match(TUNNEL_URL_REGEX)
        if (match && !tunnelUrl) {
          tunnelUrl = match[0]
          isStarting = false
          diagnosticsService.logInfo("cloudflare-tunnel", `Tunnel URL: ${tunnelUrl}`)
          resolve({ success: true, url: tunnelUrl })
        }
      })

      // Handle stderr - cloudflared outputs most info to stderr
      proc.stderr?.on("data", (data: Buffer) => {
        const output = data.toString()
        diagnosticsService.logInfo("cloudflare-tunnel", `stderr: ${output}`)

        const match = output.match(TUNNEL_URL_REGEX)
        if (match && !tunnelUrl) {
          tunnelUrl = match[0]
          isStarting = false
          diagnosticsService.logInfo("cloudflare-tunnel", `Tunnel URL: ${tunnelUrl}`)
          resolve({ success: true, url: tunnelUrl })
        }
      })

      proc.on("error", (err) => {
        tunnelError = err.message
        tunnelProcess = null
        isStarting = false
        diagnosticsService.logError("cloudflare-tunnel", "Process error", err)
        resolve({ success: false, error: tunnelError })
      })

      proc.on("close", (code) => {
        diagnosticsService.logInfo("cloudflare-tunnel", `Process exited with code ${code}`)
        tunnelProcess = null
        isStarting = false

        if (!tunnelUrl) {
          tunnelError = `cloudflared exited with code ${code}`
          resolve({ success: false, error: tunnelError })
        }
      })

      // Timeout after 30 seconds if no URL is found
      setTimeout(() => {
        if (isStarting && !tunnelUrl) {
          isStarting = false
          tunnelError = "Timeout waiting for tunnel URL"
          stopCloudflareTunnel()
          resolve({ success: false, error: tunnelError })
        }
      }, 30000)
    } catch (err: any) {
      isStarting = false
      tunnelError = err.message || String(err)
      diagnosticsService.logError("cloudflare-tunnel", "Failed to start tunnel", err)
      resolve({ success: false, error: tunnelError || undefined })
    }
  })
}

/**
 * Stop the Cloudflare Tunnel
 */
export async function stopCloudflareTunnel(): Promise<void> {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill("SIGTERM")
      diagnosticsService.logInfo("cloudflare-tunnel", "Tunnel stopped")
    } catch (err) {
      diagnosticsService.logError("cloudflare-tunnel", "Error stopping tunnel", err)
    } finally {
      tunnelProcess = null
      tunnelUrl = null
      tunnelError = null
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

