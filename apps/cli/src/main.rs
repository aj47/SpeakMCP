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
mod sse;
mod types;

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser, Subcommand};
use clap_complete::generate;
use colored::Colorize;
use std::io::{self, Write};

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

        /// Enable streaming response (prints tokens as they arrive)
        #[arg(long)]
        stream: bool,
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

    /// Manage MCP tools
    Tools {
        #[command(subcommand)]
        command: ToolsCommand,
    },

    /// Manage conversation history
    History {
        #[command(subcommand)]
        command: HistoryCommand,
    },

    /// Manage application settings
    Settings {
        #[command(subcommand)]
        command: SettingsCommand,
    },

    /// Emergency stop - halt all running operations
    Stop,

    /// Generate shell completions for bash, zsh, fish, powershell, or elvish
    Completions {
        /// Shell to generate completions for (bash, zsh, fish, powershell, elvish)
        #[arg(value_enum)]
        shell: clap_complete::Shell,
    },

    /// Manage memories (long-term context storage)
    Memories {
        #[command(subcommand)]
        command: MemoriesCommand,
    },

    /// Manage model presets
    Presets {
        #[command(subcommand)]
        command: PresetsCommand,
    },

    /// Manage skills (custom automation workflows)
    Skills {
        #[command(subcommand)]
        command: SkillsCommand,
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

/// Subcommands for tool management
#[derive(Subcommand)]
enum ToolsCommand {
    /// List all available tools from connected MCP servers
    List,

    /// Call a specific tool
    Call {
        /// Name of the tool to call (format: server_name::tool_name or just tool_name)
        name: String,

        /// Arguments to pass to the tool as JSON
        #[arg(short, long)]
        args: Option<String>,
    },
}

/// Subcommands for conversation history management
#[derive(Subcommand)]
enum HistoryCommand {
    /// List all conversations
    List,

    /// Show details of a specific conversation
    Show {
        /// Conversation ID
        id: String,
    },

    /// Delete a conversation
    Delete {
        /// Conversation ID
        id: String,
    },

    /// Export a conversation to a file
    Export {
        /// Conversation ID
        id: String,

        /// Output file path (defaults to stdout if not specified)
        #[arg(short, long)]
        output: Option<String>,
    },

    /// Continue a past conversation in interactive mode
    Continue {
        /// Conversation ID
        id: String,
    },
}

/// Subcommands for settings management
#[derive(Subcommand)]
enum SettingsCommand {
    /// Show current settings
    Show,

    /// Set a setting value
    Set {
        /// Setting key (e.g., mcp_tools_provider, agent_mode_enabled)
        key: String,

        /// Value to set
        value: String,
    },
}

/// Subcommands for memories management
#[derive(Subcommand)]
enum MemoriesCommand {
    /// List all memories
    List,

    /// Show details of a specific memory
    Show {
        /// Memory ID
        id: String,
    },

    /// Delete a memory
    Delete {
        /// Memory ID
        id: String,
    },
}

/// Subcommands for model presets management
#[derive(Subcommand)]
enum PresetsCommand {
    /// List all model presets
    List,

    /// Show current preset
    Current,

    /// Switch to a different preset
    Switch {
        /// ID of the preset to switch to
        id: String,
    },
}

/// Subcommands for skills management
#[derive(Subcommand)]
enum SkillsCommand {
    /// List all available skills
    List,
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
            stream,
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
            send_message(&config, &message_text, conversation.as_deref(), stream).await?;
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
            ProfilesCommand::Switch { name } => {
                commands::profiles::switch_profile(&config, &name, cli.json).await?;
            }
        },

        Some(Commands::Tools { command }) => match command {
            ToolsCommand::List => {
                commands::tools::list_tools(&config, cli.json).await?;
            }
            ToolsCommand::Call { name, args } => {
                commands::tools::call_tool(&config, &name, args.as_deref(), cli.json).await?;
            }
        },

        Some(Commands::History { command }) => match command {
            HistoryCommand::List => {
                commands::history::list_conversations(&config, cli.json).await?;
            }
            HistoryCommand::Show { id } => {
                commands::history::show_conversation(&config, &id, cli.json).await?;
            }
            HistoryCommand::Delete { id } => {
                commands::history::delete_conversation(&config, &id).await?;
            }
            HistoryCommand::Export { id, output } => {
                commands::history::export_conversation(&config, &id, output.as_deref(), cli.json)
                    .await?;
            }
            HistoryCommand::Continue { id } => {
                // Verify the conversation exists and get its ID
                let conversation_id = commands::history::continue_conversation(&config, &id).await?;
                // Update config with conversation ID for REPL
                let mut repl_config = config.clone();
                repl_config.default_conversation_id = Some(conversation_id);
                // Start REPL with the conversation context
                repl::run(&repl_config).await?;
            }
        },

        Some(Commands::Settings { command }) => match command {
            SettingsCommand::Show => {
                // TODO: Implement show_settings in a later task
                println!("Settings show command not yet implemented");
            }
            SettingsCommand::Set { key, value } => {
                // TODO: Implement update_setting in a later task
                println!(
                    "Settings set command not yet implemented: {} = {}",
                    key, value
                );
            }
        },

        Some(Commands::Stop) => {
            commands::stop::emergency_stop(&config).await?;
        }

        Some(Commands::Completions { shell }) => {
            let mut cmd = Cli::command();
            generate(shell, &mut cmd, "speakmcp", &mut io::stdout());
        }

        Some(Commands::Memories { command }) => match command {
            MemoriesCommand::List => {
                commands::memories::list_memories(&config, cli.json).await?;
            }
            MemoriesCommand::Show { id } => {
                // TODO: Implement show_memory in a later task
                println!("Memories show command not yet implemented: {}", id);
            }
            MemoriesCommand::Delete { id } => {
                commands::memories::delete_memory(&config, &id).await?;
            }
        },

        Some(Commands::Presets { command }) => match command {
            PresetsCommand::List => {
                commands::presets::list_presets(&config, cli.json).await?;
            }
            PresetsCommand::Current => {
                // TODO: Implement get_current_preset in a later task
                println!("Presets current command not yet implemented");
            }
            PresetsCommand::Switch { id } => {
                commands::presets::switch_preset(&config, &id, cli.json).await?;
            }
        },

        Some(Commands::Skills { command }) => match command {
            SkillsCommand::List => {
                commands::skills::list_skills(&config, cli.json).await?;
            }
        },

        None => {
            // Default behavior: interactive mode or single message
            if let Some(message) = cli.message {
                send_message(&config, &message, cli.conversation.as_deref(), false).await?;
            } else {
                config.default_conversation_id = cli.conversation;
                repl::run(&config).await?;
            }
        }
    }

    Ok(())
}

/// Send a single message and print the response
async fn send_message(
    config: &Config,
    message: &str,
    conversation_id: Option<&str>,
    stream: bool,
) -> Result<()> {
    let client = api::ApiClient::from_config(config)?;

    if stream {
        // Use streaming mode - print tokens as they arrive
        let mut last_streaming_text_len = 0;

        let result = client
            .chat_streaming(message, conversation_id, |event| {
                match event {
                    sse::SseEvent::Progress(progress) => {
                        // Print tool calls if enabled
                        if config.show_tool_calls {
                            for step in &progress.steps {
                                if step.status == "running" || step.status == "complete" {
                                    if let Some(tool_call) = &step.tool_call {
                                        eprintln!("{} {}", "⚙".yellow(), tool_call.name.dimmed());
                                    }
                                }
                            }
                        }

                        // Print streaming content incrementally
                        if let Some(streaming) = &progress.streaming_content {
                            if streaming.is_streaming && streaming.text.len() > last_streaming_text_len
                            {
                                // Print only the new characters
                                let new_text = &streaming.text[last_streaming_text_len..];
                                print!("{}", new_text);
                                let _ = io::stdout().flush();
                                last_streaming_text_len = streaming.text.len();
                            }
                        }
                    }
                    sse::SseEvent::Done(done) => {
                        // Print any remaining content not yet printed
                        if last_streaming_text_len < done.content.len() {
                            let remaining = &done.content[last_streaming_text_len..];
                            print!("{}", remaining);
                        }
                        // Ensure final newline
                        println!();

                        // Print conversation ID to stderr for scripting
                        if let Some(id) = &done.conversation_id {
                            eprintln!("{}: {}", "conversation_id".dimmed(), id);
                        }
                    }
                    sse::SseEvent::Error(err) => {
                        eprintln!("\n{}: {}", "error".red(), err.message);
                    }
                    sse::SseEvent::Unknown(_) => {
                        // Ignore unknown events
                    }
                }
            })
            .await;

        if let Err(e) = result {
            eprintln!("{}: {}", "error".red(), e);
            std::process::exit(1);
        }
    } else {
        // Non-streaming mode
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
