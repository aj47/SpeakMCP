#!/usr/bin/env node
/**
 * SpeakMCP CLI
 * 
 * Terminal-based configuration and server management for SpeakMCP.
 */

import { Command } from "commander"
import chalk from "chalk"
import QRCode from "qrcode"
import {
  loadConfig,
  saveConfig,
  getConfigValue,
  setConfigValue,
  generateApiKey,
  configPath,
  dataFolder,
  configExists,
  getDataFolder,
  getConfigPath,
} from "./config-file.js"
import { runSetup } from "./setup.js"

const program = new Command()

program
  .name("speakmcp")
  .description("SpeakMCP CLI - Configure and manage SpeakMCP from the terminal")
  .version("1.0.0")

// Setup command
program
  .command("setup")
  .description("Interactive setup wizard for first-time configuration")
  .action(async () => {
    await runSetup()
  })

// Config commands
const configCmd = program
  .command("config")
  .description("Manage configuration")

configCmd
  .command("get [key]")
  .description("Get configuration value(s)")
  .action((key?: string) => {
    const config = loadConfig()
    if (key) {
      const value = config[key]
      if (value === undefined) {
        console.log(chalk.yellow(`Key "${key}" not found`))
      } else {
        // Redact sensitive values
        const sensitiveKeys = ["groqApiKey", "openaiApiKey", "geminiApiKey", "remoteServerApiKey"]
        if (sensitiveKeys.includes(key) && typeof value === "string") {
          console.log(`${key}=${value.slice(0, 8)}...${value.slice(-4)}`)
        } else {
          console.log(`${key}=${JSON.stringify(value)}`)
        }
      }
    } else {
      // Show all config (redacted)
      const sensitiveKeys = ["groqApiKey", "openaiApiKey", "geminiApiKey", "remoteServerApiKey"]
      for (const [k, v] of Object.entries(config)) {
        if (sensitiveKeys.includes(k) && typeof v === "string" && v) {
          console.log(`${k}=${v.slice(0, 8)}...${v.slice(-4)}`)
        } else {
          console.log(`${k}=${JSON.stringify(v)}`)
        }
      }
    }
  })

configCmd
  .command("set <key> <value>")
  .description("Set a configuration value")
  .action((key: string, value: string) => {
    // Parse value (handle booleans, numbers, JSON)
    let parsedValue: any = value
    if (value === "true") parsedValue = true
    else if (value === "false") parsedValue = false
    else if (!isNaN(Number(value)) && value !== "") parsedValue = Number(value)
    else {
      try { parsedValue = JSON.parse(value) } catch { /* keep as string */ }
    }
    
    setConfigValue(key, parsedValue)
    console.log(chalk.green(`✓ Set ${key}=${JSON.stringify(parsedValue)}`))
  })

configCmd
  .command("path")
  .description("Show configuration file path")
  .action(() => {
    console.log(chalk.gray("Config file:"), configPath)
    console.log(chalk.gray("Data folder:"), dataFolder)
  })

// QR command
program
  .command("qr")
  .description("Show QR code for mobile/web connection")
  .action(async () => {
    const config = loadConfig()
    
    if (!config.remoteServerEnabled) {
      console.log(chalk.yellow("Remote server is not enabled"))
      console.log(chalk.gray("Run: speakmcp config set remoteServerEnabled true"))
      return
    }
    
    if (!config.remoteServerApiKey) {
      console.log(chalk.yellow("No API key configured"))
      const apiKey = generateApiKey()
      setConfigValue("remoteServerApiKey", apiKey)
      config.remoteServerApiKey = apiKey
      console.log(chalk.green(`✓ Generated API key: ${apiKey.slice(0, 8)}...`))
    }
    
    // Build deep link URL (localhost - user needs to set up tunnel or use IP)
    const port = config.remoteServerPort || 3210
    const baseUrl = `http://localhost:${port}/v1`
    const deepLink = `speakmcp://config?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(config.remoteServerApiKey)}`
    
    const qr = await QRCode.toString(deepLink, { type: "terminal", small: true })
    console.log()
    console.log(chalk.bold("📱 Scan to connect:"))
    console.log(qr)
    console.log(chalk.gray("Base URL:"), baseUrl)
    console.log(chalk.gray("API Key:"), config.remoteServerApiKey.slice(0, 8) + "...")
    console.log()
    console.log(chalk.yellow("Note: For remote access, set up a tunnel or use your VM's IP address"))
  })

// Status command
program
  .command("status")
  .description("Show current configuration status")
  .action(() => {
    const config = loadConfig()
    
    console.log(chalk.bold("\n📊 SpeakMCP Status\n"))
    
    console.log(chalk.gray("Onboarding:"), config.onboardingCompleted ? chalk.green("Complete") : chalk.yellow("Not complete"))
    console.log(chalk.gray("TTS Provider:"), chalk.cyan(config.ttsProviderId || "Not set"))
    console.log(chalk.gray("TTS Enabled:"), config.ttsEnabled ? chalk.green("Yes") : chalk.gray("No"))
    console.log()
    console.log(chalk.gray("Remote Server:"), config.remoteServerEnabled ? chalk.green("Enabled") : chalk.gray("Disabled"))
    if (config.remoteServerEnabled) {
      console.log(chalk.gray("  Port:"), config.remoteServerPort || 3210)
      console.log(chalk.gray("  API Key:"), config.remoteServerApiKey ? chalk.green("Configured") : chalk.yellow("Not set"))
    }
    console.log()
    console.log(chalk.gray("Config:"), configPath)
    console.log(chalk.gray("Data:"), dataFolder)
    console.log()
  })

// Run if called directly
program.parse(process.argv)
