#!/usr/bin/env npx tsx
/**
 * Development launcher that configures environment for sherpa-onnx native module.
 *
 * The sherpa-onnx-node package requires platform-specific native libraries.
 * On macOS, DYLD_LIBRARY_PATH must be set before the process starts.
 * On Linux, LD_LIBRARY_PATH must be set before the process starts.
 *
 * This script finds the sherpa-onnx libraries and launches electron-vite with
 * the correct environment variables.
 */

import { spawn } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

function findSherpaLibraryPath(): string | null {
  const platform = os.platform() === "win32" ? "win" : os.platform()
  const arch = os.arch()
  const platformPackage = `sherpa-onnx-${platform}-${arch}`

  // Check pnpm virtual store first (most common in monorepo)
  const pnpmBase = path.join(process.cwd(), "node_modules", ".pnpm")
  if (fs.existsSync(pnpmBase)) {
    try {
      const dirs = fs.readdirSync(pnpmBase)
      const platformDir = dirs.find((d) => d.startsWith(`${platformPackage}@`))
      if (platformDir) {
        const libPath = path.join(pnpmBase, platformDir, "node_modules", platformPackage)
        if (fs.existsSync(libPath)) {
          return libPath
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Check standard node_modules
  const standardPath = path.join(process.cwd(), "node_modules", platformPackage)
  if (fs.existsSync(standardPath)) {
    return standardPath
  }

  // Check root monorepo node_modules
  const rootPnpmBase = path.join(process.cwd(), "..", "..", "node_modules", ".pnpm")
  if (fs.existsSync(rootPnpmBase)) {
    try {
      const dirs = fs.readdirSync(rootPnpmBase)
      const platformDir = dirs.find((d) => d.startsWith(`${platformPackage}@`))
      if (platformDir) {
        const libPath = path.join(rootPnpmBase, platformDir, "node_modules", platformPackage)
        if (fs.existsSync(libPath)) {
          return libPath
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return null
}

function main(): void {
  const sherpaPath = findSherpaLibraryPath()

  // Set up environment
  const env = { ...process.env }

  if (sherpaPath) {
    console.log(`[dev-with-sherpa] Found sherpa-onnx libraries: ${sherpaPath}`)

    if (os.platform() === "darwin") {
      const current = env.DYLD_LIBRARY_PATH || ""
      if (!current.includes(sherpaPath)) {
        env.DYLD_LIBRARY_PATH = sherpaPath + (current ? `:${current}` : "")
      }
      console.log(`[dev-with-sherpa] DYLD_LIBRARY_PATH=${env.DYLD_LIBRARY_PATH}`)
    } else if (os.platform() === "linux") {
      const current = env.LD_LIBRARY_PATH || ""
      if (!current.includes(sherpaPath)) {
        env.LD_LIBRARY_PATH = sherpaPath + (current ? `:${current}` : "")
      }
      console.log(`[dev-with-sherpa] LD_LIBRARY_PATH=${env.LD_LIBRARY_PATH}`)
    }
  } else {
    console.warn("[dev-with-sherpa] Could not find sherpa-onnx libraries.")
    console.warn("[dev-with-sherpa] Parakeet local STT may not work correctly.")
  }

  // Forward all arguments after our script to electron-vite
  const args = ["electron-vite", "dev", "--watch", "--", ...process.argv.slice(2)]

  console.log(`[dev-with-sherpa] Running: npx ${args.join(" ")}`)

  const child = spawn("npx", args, {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  })

  child.on("close", (code) => {
    process.exit(code ?? 0)
  })

  child.on("error", (err) => {
    console.error("[dev-with-sherpa] Failed to start:", err)
    process.exit(1)
  })
}

main()

