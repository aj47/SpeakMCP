/**
 * Cross-platform script to ensure required build directories exist
 * 
 * This script creates necessary directories for the Windows build process.
 * Some versions of electron-builder require these directories to exist
 * before the build starts.
 * 
 * Issue: https://github.com/aj47/SpeakMCP/issues/595
 */

import { existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const desktopDir = join(__dirname, "..")

// Directories that need to exist before building
const requiredDirs = [
  "dist",
  "dist-installer",
  "dist-installer@speakmcp",
  "resources/bin",
]

console.log("📁 Ensuring build directories exist...")

let hasErrors = false

for (const dir of requiredDirs) {
  const fullPath = join(desktopDir, dir)

  if (!existsSync(fullPath)) {
    try {
      mkdirSync(fullPath, { recursive: true })
      console.log(`  ✅ Created: ${dir}`)
    } catch (error) {
      console.error(`  ❌ Failed to create ${dir}:`, error)
      hasErrors = true
    }
  } else {
    console.log(`  ✓ Exists: ${dir}`)
  }
}

if (hasErrors) {
  console.error("❌ Failed to create one or more required directories")
  process.exit(1)
}

console.log("📁 Build directories ready")

