//! SpeakMCP CLI - A lightweight command-line interface for SpeakMCP
//!
//! This CLI provides an alternative to the Electron desktop app, offering:
//! - Lower resource usage (no Chromium overhead)
//! - Faster startup times
//! - Better system integration
//! - Smaller binary size
//! - Terminal-based interface for developers who prefer CLI

mod api;
mod commands;
mod config;
mod output;
mod repl;
mod types;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use colored::Colorize;

use config::Config;

/// SpeakMCP CLI - Lightweight AI agent interface
#[derive(Parser)]
#[command(name = "speakmcp")]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Message to send (for non-interactive mode)
    #[arg(short, long)]
    message: Option<String>,

    /// Conversation ID to continue
    #[arg(short, long)]
    conversation: Option<String>,

    /// Server URL override
    #[arg(short, long, env = "SPEAKMCP_SERVER_URL")]
    server: Option<String>,

    /// API key override
    #[arg(short = 'k', long, env = "SPEAKMCP_API_KEY")]
    api_key: Option<String>,

    /// Output in JSON format for machine-readable output
    #[arg(long, global = true)]
    json: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Start interactive chat mode (default)
    Chat {
        /// Conversation ID to continue
        #[arg(short, long)]
        conversation: Option<String>,
    },

    /// Send a single message and exit
    Send {
        /// The message to send
        message: String,

        /// Conversation ID to continue
        #[arg(short, long)]
        conversation: Option<String>,
    },

    /// Manage configuration
    Config {
        /// Set the server URL
        #[arg(long)]
        server_url: Option<String>,

        /// Set the API key
        #[arg(long)]
        api_key: Option<String>,

        /// Show current configuration
        #[arg(long)]
        show: bool,

        /// Initialize config file with defaults
        #[arg(long)]
        init: bool,
    },

    /// Check connection to the server
    Status,

    /// Manage MCP servers
    Servers {
        #[command(subcommand)]
        command: ServersCommand,
    },

    /// Manage profiles
    Profiles {
        #[command(subcommand)]
        command: ProfilesCommand,
    },
}

/// Subcommands for MCP server management
#[derive(Subcommand)]
enum ServersCommand {
    /// List all MCP servers
    List,

    /// Enable an MCP server
    Enable {
        /// Name of the server to enable
        name: String,
    },

    /// Disable an MCP server
    Disable {
        /// Name of the server to disable
        name: String,
    },
}

/// Subcommands for profile management
#[derive(Subcommand)]
enum ProfilesCommand {
    /// List all profiles
    List,

    /// Show current profile
    Current,

    /// Switch to a different profile
    Switch {
        /// Name of the profile to switch to
        name: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Load configuration (fail fast on read/parse errors so users see misconfiguration)
    let mut config = Config::load().map_err(|e| {
        eprintln!("{}: Failed to load config: {}", "error".red(), e);
        e
    })?;

    // Control colored output based on config
    colored::control::set_override(config.colored_output);

    // Apply command-line overrides
    if let Some(server) = &cli.server {
        config.server_url = server.clone();
    }
    if let Some(api_key) = &cli.api_key {
        config.api_key = api_key.clone();
    }

    match cli.command {
        Some(Commands::Chat { conversation }) => {
            config.default_conversation_id = conversation;
            repl::run(&config).await?;
        }

        Some(Commands::Send {
            message,
            conversation,
        }) => {
            // Handle stdin input if message is "-"
            let message_text = if message == "-" {
                use std::io::Read;
                let mut buffer = String::new();
                std::io::stdin()
                    .read_to_string(&mut buffer)
                    .context("Failed to read from stdin")?;
                buffer
            } else {
                message
            };
            send_message(&config, &message_text, conversation.as_deref()).await?;
        }

        Some(Commands::Config {
            server_url,
            api_key,
            show,
            init,
        }) => {
            handle_config(server_url, api_key, show, init)?;
        }

        Some(Commands::Status) => {
            check_status(&config).await?;
        }

        Some(Commands::Servers { command }) => match command {
            ServersCommand::List => {
                commands::servers::list_servers(&config, cli.json).await?;
            }
            ServersCommand::Enable { name } => {
                commands::servers::toggle_server(&config, &name, true).await?;
            }
            ServersCommand::Disable { name } => {
                commands::servers::toggle_server(&config, &name, false).await?;
            }
        },

        Some(Commands::Profiles { command }) => match command {
            ProfilesCommand::List => {
                commands::profiles::list_profiles(&config, cli.json).await?;
            }
            ProfilesCommand::Current => {
                commands::profiles::get_current_profile(&config, cli.json).await?;
            }
            ProfilesCommand::Switch { name: _ } => {
                todo!("profiles switch not yet implemented")
            }
        },

        None => {
            // Default behavior: interactive mode or single message
            if let Some(message) = cli.message {
                send_message(&config, &message, cli.conversation.as_deref()).await?;
            } else {
                config.default_conversation_id = cli.conversation;
                repl::run(&config).await?;
            }
        }
    }

    Ok(())
}

/// Send a single message and print the response
async fn send_message(config: &Config, message: &str, conversation_id: Option<&str>) -> Result<()> {
    let client = api::ApiClient::from_config(config)?;

    match client.chat(message, conversation_id).await {
        Ok(response) => {
            // Print tool calls if any
            if config.show_tool_calls {
                if let Some(history) = &response.conversation_history {
                    for msg in history.iter().rev().take(5) {
                        if let Some(tool_calls) = &msg.tool_calls {
                            for tc in tool_calls {
                                eprintln!("{} {}", "⚙".yellow(), tc.name.dimmed());
                            }
                        }
                    }
                }
            }

            // Print the response to stdout (for piping)
            println!("{}", response.content);

            // Print conversation ID to stderr for scripting
            if let Some(id) = response.conversation_id {
                eprintln!("{}: {}", "conversation_id".dimmed(), id);
            }
        }
        Err(e) => {
            eprintln!("{}: {}", "error".red(), e);
            std::process::exit(1);
        }
    }

    Ok(())
}

/// Handle config subcommand
fn handle_config(
    server_url: Option<String>,
    api_key: Option<String>,
    show: bool,
    init: bool,
) -> Result<()> {
    if init {
        let path = Config::init()?;
        println!("{} {}", "Created config file:".green(), path.display());
        return Ok(());
    }

    if show {
        let config = Config::load()?;
        println!("{}", "Current configuration:".bold());
        println!("  Server URL: {}", config.server_url.cyan());
        println!(
            "  API Key: {}",
            if config.api_key.is_empty() {
                "(not set)".dimmed().to_string()
            } else {
                format!("{}...", &config.api_key[..8.min(config.api_key.len())])
                    .dimmed()
                    .to_string()
            }
        );
        println!(
            "  Colored output: {}",
            if config.colored_output { "yes" } else { "no" }
        );
        println!(
            "  Show tool calls: {}",
            if config.show_tool_calls { "yes" } else { "no" }
        );
        if let Some(path) = Config::config_path() {
            println!();
            println!("{} {}", "Config file:".dimmed(), path.display());
        }
        return Ok(());
    }

    // Update configuration
    let mut config = Config::load()?;
    let mut updated = false;

    if let Some(url) = server_url {
        config.server_url = url;
        updated = true;
        println!("{}", "Updated server URL".green());
    }

    if let Some(key) = api_key {
        config.api_key = key;
        updated = true;
        println!("{}", "Updated API key".green());
    }

    if updated {
        config.save()?;
        println!("{}", "Configuration saved.".green());
    } else {
        println!("No changes specified. Use --show to view current config or --help for options.");
    }

    Ok(())
}

/// Check connection status to the server
async fn check_status(config: &Config) -> Result<()> {
    println!("{}", "Checking connection...".dimmed());

    if config.api_key.is_empty() {
        println!("{}: API key not configured", "warning".yellow());
        println!("Run 'speakmcp config --api-key <KEY>' to set it.");
        return Ok(());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .context("Failed to create HTTP client")?;

    // Use the /v1/models endpoint for a lightweight health check
    let base = config.server_url.trim_end_matches('/');
    let url = format!("{}/models", base);

    // Try to connect using the models endpoint (lightweight, no side effects)
    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                println!("{} Connected to {}", "✓".green(), config.server_url.cyan());
                println!("{} Authentication successful", "✓".green());
            } else if response.status().as_u16() == 401 {
                println!("{} Connected to {}", "✓".green(), config.server_url.cyan());
                println!("{} Authentication failed - check your API key", "✗".red());
            } else {
                println!(
                    "{} Server returned status {}",
                    "⚠".yellow(),
                    response.status()
                );
            }
        }
        Err(e) => {
            println!("{} Could not connect to {}", "✗".red(), config.server_url);
            println!("  {}", e.to_string().dimmed());
        }
    }

    Ok(())
}
