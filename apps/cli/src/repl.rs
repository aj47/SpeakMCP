//! Interactive REPL (Read-Eval-Print Loop) for SpeakMCP CLI
//!
//! Provides a terminal-based chat interface for interacting with the agent.

use anyhow::Result;
use colored::Colorize;
use std::io::{self, Write};

use crate::api::{ApiClient, ChatResponse};
use crate::config::Config;

/// Run the interactive REPL
pub async fn run(config: &Config) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let mut conversation_id: Option<String> = config.default_conversation_id.clone();

    println!();
    print_header();
    print_help();
    println!();

    loop {
        // Print prompt
        print!("{} ", "you>".cyan().bold());
        io::stdout().flush()?;

        // Read input
        let input = read_line()?;
        let input = input.trim();

        if input.is_empty() {
            continue;
        }

        // Handle special commands
        match input {
            "/exit" | "/quit" | "/q" => {
                println!("{}", "Goodbye!".dimmed());
                break;
            }
            "/new" | "/clear" => {
                conversation_id = None;
                println!("{}", "Started new conversation.".yellow());
                continue;
            }
            "/help" | "/?" => {
                print_help();
                continue;
            }
            "/status" => {
                print_status(config, &conversation_id);
                continue;
            }
            _ if input.starts_with("/") => {
                println!("{}", format!("Unknown command: {}", input).red());
                continue;
            }
            _ => {}
        }

        // Send message to API
        print!("{} ", "agent>".green().bold());
        io::stdout().flush()?;

        match client.chat(input, conversation_id.as_deref()).await {
            Ok(response) => {
                // Update conversation ID for continuing the conversation
                if let Some(id) = &response.conversation_id {
                    conversation_id = Some(id.clone());
                }

                // Print tool calls if enabled
                if config.show_tool_calls {
                    print_tool_calls(&response);
                }

                // Print the response
                println!("{}", response.content);

                if response.queued.unwrap_or(false) {
                    println!("{}", "(message was queued for processing)".dimmed());
                }
            }
            Err(e) => {
                println!("{}", format!("Error: {}", e).red());
            }
        }

        println!();
    }

    Ok(())
}

fn print_header() {
    println!("{}", "╔════════════════════════════════════════╗".cyan());
    println!("{}", "║          SpeakMCP CLI v1.0.0           ║".cyan());
    println!("{}", "╚════════════════════════════════════════╝".cyan());
}

fn print_help() {
    println!();
    println!("{}", "Commands:".bold());
    println!("  {}       - Start a new conversation", "/new".cyan());
    println!("  {}    - Show connection status", "/status".cyan());
    println!("  {}      - Show this help", "/help".cyan());
    println!("  {}      - Exit the CLI", "/quit".cyan());
    println!();
    println!("{}", "Tips:".bold());
    println!("  • Press Ctrl+C to cancel a request");
    println!("  • Press Ctrl+D to exit");
}

fn print_status(config: &Config, conversation_id: &Option<String>) {
    println!();
    println!("{}", "Status:".bold());
    println!("  Server: {}", config.server_url.cyan());
    println!(
        "  Conversation: {}",
        conversation_id
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("(none)")
            .dimmed()
    );
    println!();
}

fn print_tool_calls(response: &ChatResponse) {
    if let Some(history) = &response.conversation_history {
        for msg in history.iter().rev().take(5) {
            if let Some(tool_calls) = &msg.tool_calls {
                for tc in tool_calls {
                    println!("{} {}", "⚙".yellow(), format!("{}()", tc.name).dimmed());
                }
            }
        }
    }
}

/// Read a line of input, handling Ctrl+C and Ctrl+D
fn read_line() -> Result<String> {
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input)
}

