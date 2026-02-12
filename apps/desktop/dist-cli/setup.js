/**
 * Interactive Setup Wizard
 *
 * Terminal-based onboarding for SSH/VM environments.
 */
// @ts-ignore - @inquirer/prompts types may not be installed
import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadConfig, saveConfig, generateApiKey, upsertAgentProfile, getAgentProfileByName, configPath, } from "./config-file.js";
// Predefined ACP agents (same as onboarding.tsx)
const PREDEFINED_AGENTS = [
    {
        id: "auggie",
        name: "auggie",
        displayName: "Auggie (Augment Code)",
        description: "Augment Code's AI coding assistant with native ACP support",
        command: "auggie",
        args: ["--acp"],
        isInternal: false,
    },
    {
        id: "claude-code",
        name: "claude-code",
        displayName: "Claude Code",
        description: "Anthropic's Claude for coding tasks via ACP",
        command: "claude",
        args: ["--acp"],
        isInternal: false,
    },
    {
        id: "codex",
        name: "codex",
        displayName: "Codex CLI",
        description: "OpenAI's Codex CLI for code generation",
        command: "codex",
        args: ["--acp"],
        isInternal: false,
    },
    {
        id: "internal",
        name: "general-assistant",
        displayName: "Built-in Assistant",
        description: "Use ACP Remote's built-in AI assistant (requires API key)",
        command: "",
        args: [],
        isInternal: true,
    },
];
export async function runSetup() {
    console.log();
    console.log(chalk.bold.cyan("🚀 ACP Remote Setup"));
    console.log(chalk.gray("━".repeat(40)));
    console.log();
    const config = loadConfig();
    // Step 1: Select AI Agent
    const agentId = await select({
        message: "Select your AI agent:",
        choices: PREDEFINED_AGENTS.map((agent) => ({
            name: `${agent.displayName}${agent.isInternal ? chalk.yellow(" (requires API key)") : ""}`,
            value: agent.id,
            description: agent.description,
        })),
    });
    const selectedAgent = PREDEFINED_AGENTS.find((a) => a.id === agentId);
    console.log(chalk.green(`✓ Selected: ${selectedAgent.displayName}`));
    console.log();
    // Create agent profile for external agents
    if (!selectedAgent.isInternal) {
        // Check if profile already exists
        const existing = getAgentProfileByName(selectedAgent.name);
        if (!existing) {
            upsertAgentProfile({
                name: selectedAgent.name,
                displayName: selectedAgent.displayName,
                description: selectedAgent.description,
                connection: {
                    type: "acp",
                    command: selectedAgent.command,
                    args: selectedAgent.args,
                },
                role: "external-agent",
                enabled: true,
                isBuiltIn: false,
                isUserProfile: false,
                isAgentTarget: true,
            });
            console.log(chalk.green(`✓ Created agent profile: ${selectedAgent.name}`));
        }
        config.mainAgentName = selectedAgent.name;
    }
    else {
        config.mainAgentName = "general-assistant";
    }
    // Step 2: API Key for internal agent
    if (selectedAgent.isInternal) {
        console.log(chalk.yellow("The built-in assistant requires an API key."));
        const apiKey = await input({
            message: "Enter your Groq API key (or press Enter to skip):",
            transformer: (value) => value ? "•".repeat(value.length) : "",
        });
        if (apiKey) {
            config.groqApiKey = apiKey;
            config.sttProviderId = "groq";
            config.mcpToolsProviderId = "groq";
            config.ttsProviderId = "groq";
            console.log(chalk.green("✓ API key configured"));
        }
        else {
            console.log(chalk.yellow("⚠ Skipped API key - configure later in Settings"));
        }
        console.log();
    }
    // Step 3: Remote Server
    const enableRemote = await confirm({
        message: "Enable remote server for mobile/web access?",
        default: true,
    });
    if (enableRemote) {
        config.remoteServerEnabled = true;
        console.log(chalk.green(`✓ Remote server enabled on port ${config.remoteServerPort || 3210}`));
        // Generate API key if not exists
        if (!config.remoteServerApiKey) {
            const generateKey = await confirm({
                message: "Generate API key for remote access?",
                default: true,
            });
            if (generateKey) {
                config.remoteServerApiKey = generateApiKey();
                console.log(chalk.green(`✓ API key generated: ${config.remoteServerApiKey.slice(0, 8)}...`));
            }
        }
        else {
            console.log(chalk.gray(`  Using existing API key: ${config.remoteServerApiKey.slice(0, 8)}...`));
        }
    }
    console.log();
    // Mark onboarding as complete
    config.onboardingCompleted = true;
    // Save config
    saveConfig(config);
    // Summary
    console.log(chalk.gray("━".repeat(40)));
    console.log(chalk.bold.green("✅ Setup complete!"));
    console.log();
    console.log(chalk.gray("To start the app:"));
    console.log(chalk.cyan("  acp-remote serve"));
    console.log();
    console.log(chalk.gray("To show connection QR code:"));
    console.log(chalk.cyan("  acp-remote qr"));
    console.log();
    console.log(chalk.gray(`Config saved to: ${configPath}`));
    console.log();
}
