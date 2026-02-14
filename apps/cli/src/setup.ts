/**
 * SpeakMCP Interactive Setup Wizard
 *
 * Terminal-based onboarding for SSH/VM environments.
 */

// @ts-ignore - @inquirer/prompts types may not be installed
import { select, input, confirm } from "@inquirer/prompts"
import chalk from "chalk"
import {
  loadConfig,
  saveConfig,
  generateApiKey,
  configPath,
} from "./config-file.js"

export async function runSetup(): Promise<void> {
  console.log()
  console.log(chalk.bold.cyan("🚀 SpeakMCP Setup"))
  console.log(chalk.gray("━".repeat(40)))
  console.log()

  const config = loadConfig()

  // Step 1: Select TTS Provider
  const providerChoices = [
    { name: "OpenAI (Cloud)", value: "openai", description: "Use OpenAI's TTS API" },
    { name: "Groq (Fast)", value: "groq", description: "Use Groq for fast inference" },
    { name: "Gemini (Google)", value: "gemini", description: "Use Google's Gemini TTS" },
    { name: "Local/Orpheus", value: "local", description: "Use local Orpheus TTS model" },
  ]

  const providerId = await select({
    message: "Select TTS provider:",
    choices: providerChoices,
  })

  config.ttsProviderId = providerId
  console.log(chalk.green(`✓ Selected provider: ${providerId}`))
  console.log()

  // Step 2: API Key configuration based on provider
  if (providerId !== "local") {
    const providerName = providerChoices.find(p => p.value === providerId)?.name || providerId
    console.log(chalk.yellow(`The ${providerName} provider requires an API key.`))
    
    const apiKeyMessage = `Enter your ${providerName} API key:`
    const apiKey = await input({
      message: apiKeyMessage,
      transformer: (value: string) => value ? "•".repeat(value.length) : "",
    })

    if (apiKey) {
      // Set provider-specific API key
      const apiKeyField = `${providerId}ApiKey`
      config[apiKeyField] = apiKey
      console.log(chalk.green("✓ API key configured"))
    } else {
      console.log(chalk.yellow("⚠ Skipped API key - configure later in Settings"))
    }
    console.log()
  }

  // Step 3: Remote Server
  const enableRemote = await confirm({
    message: "Enable remote server for mobile/web access?",
    default: false,
  })

  if (enableRemote) {
    config.remoteServerEnabled = true
    console.log(chalk.green(`✓ Remote server enabled on port ${config.remoteServerPort || 3210}`))

    // Generate API key if not exists
    if (!config.remoteServerApiKey) {
      const generateKey = await confirm({
        message: "Generate API key for remote access?",
        default: true,
      })

      if (generateKey) {
        config.remoteServerApiKey = generateApiKey()
        console.log(chalk.green(`✓ API key generated: ${config.remoteServerApiKey.slice(0, 8)}...`))
      }
    } else {
      console.log(chalk.gray(`  Using existing API key: ${config.remoteServerApiKey.slice(0, 8)}...`))
    }
  }
  console.log()

  // Mark onboarding as complete
  config.onboardingCompleted = true

  // Save config
  saveConfig(config)

  // Summary
  console.log(chalk.gray("━".repeat(40)))
  console.log(chalk.bold.green("✅ Setup complete!"))
  console.log()
  console.log(chalk.gray("To start the app:"))
  console.log(chalk.cyan("  speakmcp serve"))
  console.log()
  console.log(chalk.gray("To show connection QR code:"))
  console.log(chalk.cyan("  speakmcp qr"))
  console.log()
  console.log(chalk.gray(`Config saved to: ${configPath}`))
  console.log()
}
