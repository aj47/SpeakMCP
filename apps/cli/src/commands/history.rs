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
use crate::types::ConversationsResponse;

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

/// Placeholder - show_conversation will be implemented in task 4.2.1
pub async fn show_conversation(_config: &Config, _id: &str, _json: bool) -> Result<()> {
    todo!("show_conversation not yet implemented")
}

/// Placeholder - delete_conversation will be implemented in task 4.3.1
pub async fn delete_conversation(_config: &Config, _id: &str) -> Result<()> {
    todo!("delete_conversation not yet implemented")
}

/// Placeholder - export_conversation will be implemented in task 4.4.1
pub async fn export_conversation(
    _config: &Config,
    _id: &str,
    _output: Option<&str>,
    _json: bool,
) -> Result<()> {
    todo!("export_conversation not yet implemented")
}

/// Placeholder - continue_conversation will be implemented in task 4.5.1
pub async fn continue_conversation(_config: &Config, _id: &str) -> Result<()> {
    todo!("continue_conversation not yet implemented")
}
