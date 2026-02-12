#!/usr/bin/env node
/**
 * ACP Remote CLI
 *
 * Terminal-based configuration and server management for SSH/VM environments.
 */
import { Command } from "commander";
import chalk from "chalk";
import QRCode from "qrcode";
import { loadConfig, setConfigValue, generateApiKey, listAgentProfiles, upsertAgentProfile, configPath, dataFolder, } from "./config-file.js";
import { runSetup } from "./setup.js";
const program = new Command();
program
    .name("acp-remote")
    .description("ACP Remote CLI - Configure and manage ACP Remote from the terminal")
    .version("1.0.0");
// Setup command
program
    .command("setup")
    .description("Interactive setup wizard for first-time configuration")
    .action(async () => {
    await runSetup();
});
// Config commands
const configCmd = program
    .command("config")
    .description("Manage configuration");
configCmd
    .command("get [key]")
    .description("Get configuration value(s)")
    .action((key) => {
    const config = loadConfig();
    if (key) {
        const value = config[key];
        if (value === undefined) {
            console.log(chalk.yellow(`Key "${key}" not found`));
        }
        else {
            // Redact sensitive values
            const sensitiveKeys = ["groqApiKey", "openaiApiKey", "geminiApiKey", "remoteServerApiKey"];
            if (sensitiveKeys.includes(key) && typeof value === "string") {
                console.log(`${key}=${value.slice(0, 8)}...${value.slice(-4)}`);
            }
            else {
                console.log(`${key}=${JSON.stringify(value)}`);
            }
        }
    }
    else {
        // Show all config (redacted)
        const sensitiveKeys = ["groqApiKey", "openaiApiKey", "geminiApiKey", "remoteServerApiKey"];
        for (const [k, v] of Object.entries(config)) {
            if (sensitiveKeys.includes(k) && typeof v === "string" && v) {
                console.log(`${k}=${v.slice(0, 8)}...${v.slice(-4)}`);
            }
            else {
                console.log(`${k}=${JSON.stringify(v)}`);
            }
        }
    }
});
configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key, value) => {
    // Parse value (handle booleans, numbers, JSON)
    let parsedValue = value;
    if (value === "true")
        parsedValue = true;
    else if (value === "false")
        parsedValue = false;
    else if (!isNaN(Number(value)) && value !== "")
        parsedValue = Number(value);
    else {
        try {
            parsedValue = JSON.parse(value);
        }
        catch { /* keep as string */ }
    }
    setConfigValue(key, parsedValue);
    console.log(chalk.green(`✓ Set ${key}=${JSON.stringify(parsedValue)}`));
});
configCmd
    .command("path")
    .description("Show configuration file path")
    .action(() => {
    console.log(chalk.gray("Config file:"), configPath);
    console.log(chalk.gray("Data folder:"), dataFolder);
});
// Agent commands
const agentCmd = program
    .command("agent")
    .description("Manage agent profiles");
agentCmd
    .command("list")
    .description("List all agent profiles")
    .action(() => {
    const profiles = listAgentProfiles();
    const config = loadConfig();
    const mainAgent = config.mainAgentName;
    if (profiles.length === 0) {
        console.log(chalk.yellow("No agent profiles configured"));
        console.log(chalk.gray("Run 'acp-remote setup' to configure an agent"));
        return;
    }
    console.log(chalk.bold("Agent Profiles:"));
    for (const profile of profiles) {
        const isMain = profile.name === mainAgent;
        const marker = isMain ? chalk.green("★") : " ";
        const type = profile.connection?.type || "internal";
        console.log(`${marker} ${chalk.cyan(profile.name)} (${type})${isMain ? chalk.green(" [main]") : ""}`);
        if (profile.description) {
            console.log(chalk.gray(`    ${profile.description}`));
        }
    }
});
agentCmd
    .command("add <name>")
    .description("Add a new agent profile")
    .option("-c, --command <cmd>", "Command to run the agent")
    .option("-a, --args <args>", "Arguments (comma-separated)", "")
    .option("-d, --description <desc>", "Agent description")
    .action((name, options) => {
    const args = options.args ? options.args.split(",").map((a) => a.trim()) : [];
    upsertAgentProfile({
        name,
        displayName: name,
        description: options.description || "",
        connection: {
            type: "acp",
            command: options.command || name,
            args,
        },
        role: "external-agent",
        enabled: true,
        isBuiltIn: false,
        isUserProfile: false,
        isAgentTarget: true,
    });
    console.log(chalk.green(`✓ Added agent: ${name}`));
});
agentCmd
    .command("set-main <name>")
    .description("Set the main agent")
    .action((name) => {
    setConfigValue("mainAgentName", name);
    console.log(chalk.green(`✓ Main agent set to: ${name}`));
});
// QR command
program
    .command("qr")
    .description("Show QR code for mobile/web connection")
    .action(async () => {
    const config = loadConfig();
    if (!config.remoteServerEnabled) {
        console.log(chalk.yellow("Remote server is not enabled"));
        console.log(chalk.gray("Run: acp-remote config set remoteServerEnabled true"));
        return;
    }
    if (!config.remoteServerApiKey) {
        console.log(chalk.yellow("No API key configured"));
        const apiKey = generateApiKey();
        setConfigValue("remoteServerApiKey", apiKey);
        config.remoteServerApiKey = apiKey;
        console.log(chalk.green(`✓ Generated API key: ${apiKey.slice(0, 8)}...`));
    }
    // Build deep link URL (localhost - user needs to set up tunnel or use IP)
    const port = config.remoteServerPort || 3210;
    const baseUrl = `http://localhost:${port}/v1`;
    const deepLink = `acpremote://config?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(config.remoteServerApiKey)}`;
    const qr = await QRCode.toString(deepLink, { type: "terminal", small: true });
    console.log();
    console.log(chalk.bold("📱 Scan to connect:"));
    console.log(qr);
    console.log(chalk.gray("Base URL:"), baseUrl);
    console.log(chalk.gray("API Key:"), config.remoteServerApiKey.slice(0, 8) + "...");
    console.log();
    console.log(chalk.yellow("Note: For remote access, set up a tunnel or use your VM's IP address"));
});
// Status command
program
    .command("status")
    .description("Show current configuration status")
    .action(() => {
    const config = loadConfig();
    const profiles = listAgentProfiles();
    console.log(chalk.bold("\n📊 ACP Remote Status\n"));
    console.log(chalk.gray("Onboarding:"), config.onboardingCompleted ? chalk.green("Complete") : chalk.yellow("Not complete"));
    console.log(chalk.gray("Main Agent:"), chalk.cyan(config.mainAgentName || "Not set"));
    console.log(chalk.gray("Agent Profiles:"), profiles.length);
    console.log();
    console.log(chalk.gray("Remote Server:"), config.remoteServerEnabled ? chalk.green("Enabled") : chalk.gray("Disabled"));
    if (config.remoteServerEnabled) {
        console.log(chalk.gray("  Port:"), config.remoteServerPort || 3210);
        console.log(chalk.gray("  API Key:"), config.remoteServerApiKey ? chalk.green("Configured") : chalk.yellow("Not set"));
    }
    console.log();
    console.log(chalk.gray("Config:"), configPath);
    console.log();
});
// Run if called directly
program.parse(process.argv);
