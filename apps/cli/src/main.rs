//! SpeakMCP CLI - A lightweight command-line interface for SpeakMCP
//!
//! This CLI provides an alternative to the Electron desktop app, offering:
//! - Lower resource usage (no Chromium overhead)
//! - Faster startup times
//! - Better system integration
//! - Smaller binary size
//! - Terminal-based interface for developers who prefer CLI

mod api;
mod config;
mod repl;

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
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Load configuration
    let mut config = Config::load().unwrap_or_default();

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
            send_message(&config, &message, conversation.as_deref()).await?;
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
        println!(
            "{} {}",
            "Created config file:".green(),
            path.display()
        );
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
                format!("{}...", &config.api_key[..8.min(config.api_key.len())]).dimmed().to_string()
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
        println!(
            "{}: API key not configured",
            "warning".yellow()
        );
        println!("Run 'speakmcp config --api-key <KEY>' to set it.");
        return Ok(());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .context("Failed to create HTTP client")?;

    let url = format!("{}/chat/completions", config.server_url);

    // Try to connect (will fail auth but proves connectivity)
    match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "test",
            "messages": [{"role": "user", "content": "test"}]
        }))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() || response.status().as_u16() == 401 || response.status().as_u16() == 400 {
                println!("{} Connected to {}", "✓".green(), config.server_url.cyan());
                if response.status().is_success() {
                    println!("{} Authentication successful", "✓".green());
                } else if response.status().as_u16() == 401 {
                    println!("{} Server reachable but authentication failed", "✗".red());
                }
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
