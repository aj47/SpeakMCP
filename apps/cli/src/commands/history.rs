//! Conversation history management commands
//!
//! This module implements CLI commands for listing, viewing, deleting, exporting,
//! and continuing conversations. These commands communicate with the desktop app's remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::{Conversation, ConversationsResponse};

/// List all conversations in history
///
/// Calls GET /v1/conversations and displays the results.
pub async fn list_conversations(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: ConversationsResponse = client.get("v1/conversations").await?;

    if json {
        print_json(&response.conversations)?;
    } else {
        if response.conversations.is_empty() {
            println!("No conversations found.");
            return Ok(());
        }

        let headers = &["ID", "TITLE", "MESSAGES", "LAST UPDATED"];
        let rows: Vec<TableRow> = response
            .conversations
            .iter()
            .map(|conv| {
                let updated = format_timestamp(conv.updated_at);
                let title = truncate_string(&conv.title, 40);

                TableRow::new(vec![
                    conv.id.clone(),
                    title,
                    conv.message_count.to_string(),
                    updated,
                ])
            })
            .collect();

        print_table(headers, &rows);
    }

    Ok(())
}

/// Format a Unix timestamp (milliseconds) to a human-readable string
fn format_timestamp(ts_millis: u64) -> String {
    use std::time::{Duration, UNIX_EPOCH};

    let duration = Duration::from_millis(ts_millis);
    let datetime = UNIX_EPOCH + duration;

    // Simple formatting - just show the date and time
    match datetime.duration_since(UNIX_EPOCH) {
        Ok(d) => {
            let secs = d.as_secs();
            let days = secs / 86400;
            let years_since_1970 = days / 365;
            let year = 1970 + years_since_1970;
            let remaining_days = days % 365;
            let month = remaining_days / 30 + 1;
            let day = remaining_days % 30 + 1;
            let hours = (secs % 86400) / 3600;
            let minutes = (secs % 3600) / 60;
            format!(
                "{:04}-{:02}-{:02} {:02}:{:02}",
                year, month, day, hours, minutes
            )
        }
        Err(_) => "unknown".to_string(),
    }
}

/// Truncate a string to a maximum length, adding ellipsis if needed
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}

/// Show a specific conversation by ID
///
/// Calls GET /v1/conversations/:id and displays the full conversation with all messages.
pub async fn show_conversation(config: &Config, id: &str, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let path = format!("v1/conversations/{}", id);
    let conversation: Conversation = client.get(&path).await?;

    if json {
        print_json(&conversation)?;
    } else {
        // Print conversation header
        println!("Conversation: {}", conversation.title);
        println!("ID: {}", conversation.id);
        println!("Created: {}", format_timestamp(conversation.created_at));
        println!("Updated: {}", format_timestamp(conversation.updated_at));
        println!("Messages: {}", conversation.messages.len());

        // Print metadata if present
        if let Some(ref metadata) = conversation.metadata {
            if let Some(ref model) = metadata.model {
                println!("Model: {}", model);
            }
            if let Some(ref provider) = metadata.provider {
                println!("Provider: {}", provider);
            }
            if let Some(tokens) = metadata.total_tokens {
                println!("Total Tokens: {}", tokens);
            }
        }

        println!("\n{}", "-".repeat(60));

        // Print each message
        for message in &conversation.messages {
            let role_display = match message.role.as_str() {
                "user" => "User",
                "assistant" => "Assistant",
                "system" => "System",
                _ => &message.role,
            };

            let timestamp = format_timestamp(message.timestamp);
            println!("\n[{}] {} ({})", role_display, timestamp, message.id);
            println!("{}", message.content);

            // Show tool calls if present
            if let Some(ref tool_calls) = message.tool_calls {
                for tool_call in tool_calls {
                    println!("\n  → Tool Call: {}", tool_call.name);
                    let args_str = serde_json::to_string_pretty(&tool_call.arguments)
                        .unwrap_or_else(|_| tool_call.arguments.to_string());
                    // Indent the arguments
                    for line in args_str.lines() {
                        println!("    {}", line);
                    }
                }
            }

            // Show tool results if present
            if let Some(ref tool_results) = message.tool_results {
                for result in tool_results {
                    let status = if result.success { "✓" } else { "✗" };
                    println!("\n  ← Tool Result: {}", status);
                    let content_preview = truncate_string(&result.content, 200);
                    println!("    {}", content_preview);
                    if let Some(ref error) = result.error {
                        println!("    Error: {}", error);
                    }
                }
            }
        }

        println!("\n{}", "-".repeat(60));
    }

    Ok(())
}

/// Delete a conversation by ID
///
/// Calls DELETE /v1/conversations/:id to remove the conversation from history.
pub async fn delete_conversation(config: &Config, id: &str) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let path = format!("v1/conversations/{}", id);
    client.delete(&path).await?;

    println!("Deleted conversation: {}", id);
    Ok(())
}

/// Export a conversation to a JSON file
///
/// Calls GET /v1/conversations/:id and saves the full conversation to a file.
/// If no output path is specified, uses the conversation ID as the filename.
pub async fn export_conversation(
    config: &Config,
    id: &str,
    output: Option<&str>,
    json: bool,
) -> Result<()> {
    use std::fs;
    use std::path::PathBuf;

    let client = ApiClient::from_config(config)?;
    let path = format!("v1/conversations/{}", id);
    let conversation: Conversation = client.get(&path).await?;

    // Determine output file path
    let output_path: PathBuf = match output {
        Some(p) => PathBuf::from(p),
        None => PathBuf::from(format!("conversation-{}.json", id)),
    };

    // Serialize conversation to JSON
    let json_content = serde_json::to_string_pretty(&conversation)?;

    // Write to file
    fs::write(&output_path, &json_content)?;

    if json {
        // Print as JSON object with export details
        let result = serde_json::json!({
            "exported": true,
            "id": conversation.id,
            "title": conversation.title,
            "path": output_path.display().to_string(),
            "message_count": conversation.messages.len()
        });
        print_json(&result)?;
    } else {
        println!(
            "Exported conversation '{}' ({} messages) to {}",
            truncate_string(&conversation.title, 40),
            conversation.messages.len(),
            output_path.display()
        );
    }

    Ok(())
}

/// Continue a past conversation in REPL mode
///
/// Fetches the conversation by ID to verify it exists, then returns its ID
/// for the REPL to use. Prints a summary of the conversation being continued.
pub async fn continue_conversation(config: &Config, id: &str) -> Result<String> {
    let client = ApiClient::from_config(config)?;
    let path = format!("v1/conversations/{}", id);
    let conversation: Conversation = client.get(&path).await?;

    // Print summary of the conversation being continued
    println!(
        "Continuing conversation: {}",
        truncate_string(&conversation.title, 50)
    );
    println!(
        "  {} messages, last updated: {}",
        conversation.messages.len(),
        format_timestamp(conversation.updated_at)
    );

    // Show last few messages for context
    let recent_messages: Vec<_> = conversation.messages.iter().rev().take(3).collect();
    if !recent_messages.is_empty() {
        println!("\nRecent messages:");
        for msg in recent_messages.iter().rev() {
            let role_display = match msg.role.as_str() {
                "user" => "You",
                "assistant" => "Agent",
                "system" => "System",
                _ => &msg.role,
            };
            let content_preview = truncate_string(&msg.content, 60);
            println!("  {}: {}", role_display, content_preview);
        }
    }

    println!();

    Ok(conversation.id)
}
