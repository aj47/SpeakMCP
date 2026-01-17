//! Memory management commands
//!
//! This module implements CLI commands for listing and deleting memories.
//! Memories are stored context/knowledge that the LLM can reference across conversations.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::{MemoriesResponse, Memory};

/// List all memories
///
/// Calls GET /v1/memories and displays the results.
pub async fn list_memories(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: MemoriesResponse = client.get("v1/memories").await?;

    if json {
        print_json(&response.memories)?;
    } else {
        if response.memories.is_empty() {
            println!("No memories found.");
            return Ok(());
        }

        let headers = &["ID", "CONTENT", "IMPORTANCE", "TAGS", "CREATED"];
        let rows: Vec<TableRow> = response
            .memories
            .iter()
            .map(|memory| {
                let content_preview = truncate_string(&memory.content, 40);
                let tags = memory.tags.join(", ");
                let tags_display = truncate_string(&tags, 20);
                let created = format_timestamp(memory.created_at);

                TableRow::new(vec![
                    memory.id.clone(),
                    content_preview,
                    memory.importance.to_string(),
                    tags_display,
                    created,
                ])
            })
            .collect();

        print_table(headers, &rows);
    }

    Ok(())
}

/// Delete a memory by ID
///
/// Calls DELETE /v1/memories/:id to remove the memory.
pub async fn delete_memory(config: &Config, id: &str) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let path = format!("v1/memories/{}", id);
    client.delete(&path).await?;

    println!("Deleted memory: {}", id);
    Ok(())
}

/// Format a Unix timestamp (milliseconds) to a human-readable string
fn format_timestamp(ts_millis: u64) -> String {
    use std::time::{Duration, UNIX_EPOCH};

    let duration = Duration::from_millis(ts_millis);
    let datetime = UNIX_EPOCH + duration;

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
