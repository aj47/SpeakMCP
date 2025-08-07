#!/usr/bin/env node

/**
 * Test script to verify MCP PATH resolution works correctly
 * This simulates the Electron environment where PATH might be limited
 */

import { spawn } from "child_process"
import path from "path"
import os from "os"
import { access, constants } from "fs"
import { promisify } from "util"

const accessAsync = promisify(access)

async function resolveCommandPath(command) {
  // If it's already an absolute path, return as-is
  if (path.isAbsolute(command)) {
    return command
  }

  // Get the system PATH
  const systemPath = process.env.PATH || ""
  const pathSeparator = process.platform === "win32" ? ";" : ":"
  const pathExtensions =
    process.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""]

  // Split PATH and search for the command
  const pathDirs = systemPath.split(pathSeparator)

  // Add common Node.js paths that might be missing in Electron
  const additionalPaths = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(os.homedir(), ".npm-global", "bin"),
    path.join(os.homedir(), "node_modules", ".bin"),
  ]

  pathDirs.push(...additionalPaths)

  for (const dir of pathDirs) {
    if (!dir) continue

    for (const ext of pathExtensions) {
      const fullPath = path.join(dir, command + ext)
      try {
        await accessAsync(fullPath, constants.F_OK | constants.X_OK)
        return fullPath
      } catch {
        // Continue searching
      }
    }
  }

  // If not found, check if npx is available and this might be an npm package
  if (command === "npx" || command.startsWith("@")) {
    throw new Error(
      `npx not found in PATH. Please ensure Node.js is properly installed.`,
    )
  }

  // Return original command and let the system handle it
  return command
}

async function prepareEnvironment(serverEnv = {}) {
  // Create a clean environment with only string values
  const environment = {}

  // Copy process.env, filtering out undefined values
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[key] = value
    }
  }

  // Ensure PATH is properly set for finding npm/npx
  if (!environment.PATH) {
    environment.PATH = "/usr/local/bin:/usr/bin:/bin"
  }

  // Add common Node.js paths to PATH if not already present
  const additionalPaths = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(os.homedir(), ".npm-global", "bin"),
    path.join(os.homedir(), "node_modules", ".bin"),
  ]

  const pathSeparator = process.platform === "win32" ? ";" : ":"
  const currentPaths = environment.PATH.split(pathSeparator)

  for (const additionalPath of additionalPaths) {
    if (!currentPaths.includes(additionalPath)) {
      environment.PATH += pathSeparator + additionalPath
    }
  }

  // Add server-specific environment variables
  Object.assign(environment, serverEnv)

  return environment
}

async function testMCPServerSpawn() {
  console.log("🧪 Testing MCP Server PATH Resolution...\n")

  // Test 1: Resolve npx path
  console.log("1. Testing npx path resolution:")
  try {
    const npxPath = await resolveCommandPath("npx")
    console.log(`   ✅ Found npx at: ${npxPath}`)
  } catch (error) {
    console.log(`   ❌ Failed to find npx: ${error.message}`)
  }

  // Test 2: Test environment preparation
  console.log("\n2. Testing environment preparation:")
  try {
    const env = await prepareEnvironment({ TEST_VAR: "test_value" })
    console.log(
      `   ✅ Environment prepared with PATH: ${env.PATH.substring(0, 100)}...`,
    )
    console.log(`   ✅ Custom environment variable: ${env.TEST_VAR}`)
  } catch (error) {
    console.log(`   ❌ Failed to prepare environment: ${error.message}`)
  }

  // Test 3: Test spawning our mock MCP server
  console.log("\n3. Testing mock MCP server spawn:")
  try {
    const mockServerPath = path.join(
      process.cwd(),
      "scripts",
      "mock-mcp-server.mjs",
    )

    // Check if mock server exists
    await accessAsync(mockServerPath)

    const resolvedCommand = await resolveCommandPath("node")
    const environment = await prepareEnvironment()

    console.log(`   ✅ Mock server exists at: ${mockServerPath}`)
    console.log(`   ✅ Node.js resolved to: ${resolvedCommand}`)

    // Test spawning the mock server
    const child = spawn(resolvedCommand, [mockServerPath], {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let output = ""
    let errorOutput = ""

    child.stdout.on("data", (data) => {
      output += data.toString()
    })

    child.stderr.on("data", (data) => {
      errorOutput += data.toString()
    })

    // Send a test message to the mock server
    const testMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      },
    }

    child.stdin.write(JSON.stringify(testMessage) + "\n")

    // Wait for response or timeout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error("Timeout waiting for mock server response"))
      }, 5000)

      child.on("exit", (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Mock server exited with code ${code}`))
        }
      })

      // Check for ready signal
      const checkReady = () => {
        if (errorOutput.includes("[MOCK-MCP] Ready")) {
          clearTimeout(timeout)
          child.kill()
          resolve()
        }
      }

      child.stderr.on("data", checkReady)
    })

    console.log(`   ✅ Mock server spawned and responded successfully`)
    if (errorOutput) {
      console.log(`   📝 Server output: ${errorOutput.trim()}`)
    }
  } catch (error) {
    console.log(`   ❌ Failed to spawn mock server: ${error.message}`)
  }

  // Test 4: Test with limited PATH (simulating Electron environment)
  console.log("\n4. Testing with limited PATH (simulating Electron):")
  try {
    const originalPath = process.env.PATH
    process.env.PATH = "/usr/bin:/bin" // Limited PATH like in Electron

    const npxPath = await resolveCommandPath("npx")
    console.log(`   ✅ Found npx even with limited PATH: ${npxPath}`)

    process.env.PATH = originalPath // Restore original PATH
  } catch (error) {
    console.log(`   ❌ Failed with limited PATH: ${error.message}`)
    process.env.PATH = process.env.PATH // Restore just in case
  }

  console.log("\n🎉 MCP PATH resolution test completed!")
}

// Run the test
testMCPServerSpawn().catch((error) => {
  console.error("Test failed:", error)
  process.exit(1)
})
