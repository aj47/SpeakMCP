/**
 * Cross-platform Rust binary build script
 * 
 * This script builds the Rust binary for the current platform.
 * It automatically detects the platform and runs the appropriate
 * build command.
 * 
 * Issue: https://github.com/aj47/SpeakMCP/issues/595
 */

import { execSync, spawn } from "child_process"
import { existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const desktopDir = join(__dirname, "..")
const rustDir = join(desktopDir, "speakmcp-rs")
const resourcesBinDir = join(desktopDir, "resources", "bin")

const isWindows = process.platform === "win32"

console.log("🔨 Building Rust binary...")
console.log(`   Platform: ${process.platform}`)

// Ensure required directories exist
const requiredDirs = [
  resourcesBinDir,
  join(desktopDir, "dist"),
  join(desktopDir, "dist-installer"),
  join(desktopDir, "dist-installer@speakmcp"),
]

for (const dir of requiredDirs) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`   Created directory: ${dir}`)
  }
}

// Build the Rust binary
console.log("   Building with cargo...")
try {
  execSync("cargo build --release", {
    cwd: rustDir,
    stdio: "inherit",
  })
} catch (error) {
  console.error("❌ Cargo build failed")
  process.exit(1)
}

// Copy the binary to resources/bin
const srcBinary = isWindows
  ? join(rustDir, "target", "release", "speakmcp-rs.exe")
  : join(rustDir, "target", "release", "speakmcp-rs")

const destBinary = isWindows
  ? join(resourcesBinDir, "speakmcp-rs.exe")
  : join(resourcesBinDir, "speakmcp-rs")

if (!existsSync(srcBinary)) {
  console.error(`❌ Built binary not found at: ${srcBinary}`)
  process.exit(1)
}

try {
  const fs = await import("fs/promises")
  await fs.copyFile(srcBinary, destBinary)
  console.log(`✅ Copied binary to: ${destBinary}`)
} catch (error) {
  console.error("❌ Failed to copy binary:", error)
  process.exit(1)
}

// Sign the binary on macOS
if (process.platform === "darwin") {
  console.log("🔐 Signing Rust binary...")
  try {
    execSync("./scripts/sign-binary.sh", {
      cwd: desktopDir,
      stdio: "inherit",
    })
  } catch (error) {
    console.error("⚠️  Binary signing failed (continuing anyway)")
  }
}

console.log("✅ Rust binary build complete")

